const { loadSettings } = require('../settings');
const exchanges = require('./exchanges');
const {
    withRetries,
    logWithTimestamp,
    handleError
} = require('./utils');
const {
    tableExists,
    createTable,
    insertPositionLimitsData,
    deleteOldData
} = require('./utils/db');
const {
    generateDynamicSettings,
    refetchSymbolsForExchange
} = require('./fetch-symbols');
const cron = require('node-cron');
const moment = require('moment');
const RollingRateLimiter = require('./utils/rolling-rate-limiter');

let settings;
let globalRateLimiter;

// Symbol health tracking system
const symbolHealthTracker = {};
const suspectedDelistedSymbols = new Set();

// Mutex to prevent overlapping cron cycles (per-exchange)
const fetchCycleInProgress = {};

// Delisting detection thresholds (loaded from settings)
let CONSECUTIVE_FAIL_THRESHOLD = 3;
let OTHER_SYMBOLS_SUCCESS_THRESHOLD = 0.6;
let MIN_SAMPLE_SIZE = 3;

function initializeHealthTracker(exchangeName) {
    if (!symbolHealthTracker[exchangeName]) {
        symbolHealthTracker[exchangeName] = {};
    }
}

function initializeSymbolHealth(exchangeName, symbol) {
    initializeHealthTracker(exchangeName);
    if (!symbolHealthTracker[exchangeName][symbol]) {
        symbolHealthTracker[exchangeName][symbol] = {
            consecutiveFails: 0,
            lastFailTime: null,
            lastSuccessTime: null
        };
    }
}

function updateSymbolHealth(exchangeName, symbol, success, fetchResults) {
    initializeSymbolHealth(exchangeName, symbol);
    const now = Date.now();
    const health = symbolHealthTracker[exchangeName][symbol];

    if (success) {
        health.consecutiveFails = 0;
        health.lastSuccessTime = now;

        const key = `${exchangeName}:${symbol}`;
        if (suspectedDelistedSymbols.has(key)) {
            suspectedDelistedSymbols.delete(key);
            logWithTimestamp(`Symbol ${symbol} on ${exchangeName} recovered, removed from exclusion list`);
        }
    } else {
        health.lastFailTime = now;

        const otherSymbolsTotal = fetchResults.total - 1;
        const otherSymbolsSuccess = fetchResults.successful - (success ? 1 : 0);
        const successRate = otherSymbolsTotal > 0 ? otherSymbolsSuccess / otherSymbolsTotal : 0;

        if (otherSymbolsTotal < MIN_SAMPLE_SIZE) {
            logWithTimestamp(`Symbol ${symbol} on ${exchangeName} failed but only ${otherSymbolsTotal} other symbols - insufficient sample size for delisting detection`);
            return;
        }

        if (successRate >= OTHER_SYMBOLS_SUCCESS_THRESHOLD) {
            health.consecutiveFails++;

            if (health.consecutiveFails >= CONSECUTIVE_FAIL_THRESHOLD) {
                const key = `${exchangeName}:${symbol}`;
                if (!suspectedDelistedSymbols.has(key)) {
                    suspectedDelistedSymbols.add(key);
                    logWithTimestamp(`Symbol ${symbol} suspected delisted on ${exchangeName} after ${health.consecutiveFails} consecutive failures (${Math.round(successRate * 100)}% of other symbols succeeded)`);

                    handleError(`DELISTING DETECTED: Symbol ${symbol} on ${exchangeName} has failed ${health.consecutiveFails} consecutive times while other symbols succeed. Temporarily excluded from fetching.`, false);

                    (async () => {
                        try {
                            const refetched = await refetchSymbolsForExchange(exchangeName);
                            if (refetched) {
                                clearSuspectedDelistedForExchange(exchangeName);
                                const newSettings = await loadSettings();
                                settings = newSettings;

                                if (settings.delisting_detection) {
                                    CONSECUTIVE_FAIL_THRESHOLD = settings.delisting_detection.consecutive_fail_threshold || 3;
                                    OTHER_SYMBOLS_SUCCESS_THRESHOLD = settings.delisting_detection.other_symbols_success_threshold || 0.6;
                                    MIN_SAMPLE_SIZE = settings.delisting_detection.min_sample_size || 3;
                                }

                                logWithTimestamp(`Settings reloaded after successful refetch for ${exchangeName}`);
                            }
                        } catch (err) {
                            logWithTimestamp(`Error during refetch/reload for ${exchangeName}: ${err.message}`);
                        }
                    })();
                }
            }
        } else {
            logWithTimestamp(`Symbol ${symbol} failed but ${Math.round(successRate * 100)}% success rate suggests exchange issue, not delisting`);
        }
    }
}

function shouldSkipSymbol(exchangeName, symbol) {
    const key = `${exchangeName}:${symbol}`;
    return suspectedDelistedSymbols.has(key);
}

function clearSuspectedDelistedForExchange(exchangeName) {
    const keysToRemove = [];
    for (const key of suspectedDelistedSymbols) {
        if (key.startsWith(`${exchangeName}:`)) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => suspectedDelistedSymbols.delete(key));

    if (keysToRemove.length > 0) {
        logWithTimestamp(`Cleared ${keysToRemove.length} suspected delisted symbols for ${exchangeName} after refetch`);
    }
}

function clearHealthTrackerForExchange(exchangeName) {
    if (symbolHealthTracker[exchangeName]) {
        const symbolCount = Object.keys(symbolHealthTracker[exchangeName]).length;
        delete symbolHealthTracker[exchangeName];
        logWithTimestamp(`Cleared health tracker for ${exchangeName} (${symbolCount} symbols removed)`);
    }
}

async function ensureTableExists(tableName) {
    try {
        if (!(await tableExists(tableName))) {
            await createTable(tableName);
            logWithTimestamp(`Created table: ${tableName}`);
        }
    } catch (error) {
        handleError(error, true);
    }
}

function parseInstrumentType(instrument) {
    switch (instrument) {
        case 'futures':
            return 'f';
        case 'perpetual':
            return 'p';
        case 'perpetual_quanto':
            return 'pq';
        case 'spot':
            return 's';
        default:
            const errorMessage = `Invalid instrument type: ${instrument}`;
            handleError(errorMessage, true);
    }
}

function getTableName(apiName, tablePrefix, type, symbol, tableSymbol) {
    const prefix = tablePrefix || apiName;
    symbol = tableSymbol || symbol;

    const parsedType = parseInstrumentType(type);
    const constructedName = `${prefix}_${parsedType}_position_limits_${symbol}`;

    if (constructedName.length > 64) {
        const errorMessage = `Table name too long: ${constructedName}`;
        handleError(errorMessage, true);
    }

    return constructedName;
}

async function ensureTablesExist() {
    try {
        for (const exchange of settings.exchanges) {
            console.log(`Ensuring position_limits tables exist for exchange: ${exchange.api_name}`);
            for (const instrumentType in exchange.instruments) {
                for (const instrument of exchange.instruments[instrumentType]) {
                    if (instrument.type !== 'spot') {
                        const tableName = getTableName(
                            exchange.api_name,
                            exchange.table_prefix,
                            instrument.type,
                            instrument.symbol,
                            instrument.table_symbol
                        );
                        await ensureTableExists(tableName);
                    }
                }
            }
        }
        logWithTimestamp('All position_limits tables exist.');
    } catch (error) {
        handleError(error, true);
    }
}

function getAuthConfig(exchangeName) {
    if (exchangeName === 'binance_usdm_futures' || exchangeName === 'binance_coinm_futures') {
        return {
            apiKey: settings.binance_api_key,
            apiSecret: settings.binance_api_secret,
        };
    }
    if (exchangeName === 'bingx_usdm_futures') {
        return {
            apiKey: settings.bingx_api_key,
            apiSecret: settings.bingx_api_secret,
            headerName: 'X-BX-APIKEY',
        };
    }
    return {};
}

async function fetchAllData(exchangeInstance, symbols, instrument, exchangeName) {
    try {
        let allData = [];
        const authConfig = getAuthConfig(exchangeName);

        const fetchResults = {
            total: 0,
            successful: 0,
            failed: 0
        };

        if (exchangeInstance.has.fetchAllPositionLimits) {
            const allLimits = await withRetries(() => exchangeInstance.fetchAllPositionLimits(instrument, authConfig)) || [];
            allData = [...ensureArray(allLimits)];

            fetchResults.total = symbols.length;
            fetchResults.successful = allData.length;
            fetchResults.failed = symbols.length - allData.length;

            for (const { symbol } of symbols) {
                const success = allData.some(data => data.symbol === symbol);
                updateSymbolHealth(exchangeName, symbol, success, fetchResults);
            }
        } else if (exchangeInstance.has.fetchPositionLimit) {
            const symbolsToFetch = [];
            const skippedSymbols = [];

            for (const { symbol } of symbols) {
                if (shouldSkipSymbol(exchangeName, symbol)) {
                    skippedSymbols.push(symbol);
                } else {
                    symbolsToFetch.push(symbol);
                }
            }

            if (skippedSymbols.length > 0) {
                logWithTimestamp(`Skipping ${skippedSymbols.length} suspected delisted symbols on ${exchangeName}: ${skippedSymbols.join(', ')}`);
            }

            fetchResults.total = symbolsToFetch.length;
            const symbolOutcomes = [];

            for (const symbol of symbolsToFetch) {
                let success = false;
                try {
                    const result = await withRetries(() => exchangeInstance.fetchPositionLimit(symbol, instrument, authConfig));
                    if (result && result.tiers && result.tiers.length > 0) {
                        allData.push(result);
                        fetchResults.successful++;
                        success = true;
                    }
                } catch (error) {
                    logWithTimestamp(`Error fetching position limits for ${symbol}: ${error.message}`);
                }

                symbolOutcomes.push({ symbol, success });
            }

            fetchResults.failed = fetchResults.total - fetchResults.successful;

            for (const { symbol, success } of symbolOutcomes) {
                updateSymbolHealth(exchangeName, symbol, success, fetchResults);
            }
        } else {
            logWithTimestamp(`Exchange ${exchangeName} does not support fetchAllPositionLimits or fetchPositionLimit.`);
        }

        if (fetchResults.total > 0) {
            const successRate = Math.round((fetchResults.successful / fetchResults.total) * 100);
            logWithTimestamp(`${exchangeName}: ${fetchResults.successful}/${fetchResults.total} symbols succeeded (${successRate}%)`);
        }

        return allData.filter(data => data && symbols.some(s => s.symbol === data.symbol));
    } catch (error) {
        logWithTimestamp(`Error fetching position limits data for ${exchangeInstance.exchangeName}: ${error.message}`);
        handleError(error, true);
        return [];
    }
}

function ensureArray(data) {
    if (!Array.isArray(data)) {
        logWithTimestamp(`Warning: data is not iterable. Defaulting to empty array.`);
        return [];
    }
    return data;
}

async function initializeExchangeProcesses(exchangeSettings) {
    try {
        const exchangeClass = exchanges[exchangeSettings.api_name];
        if (!exchangeClass) {
            const errorMessage = `Exchange ${exchangeSettings.api_name} not found in exchanges module.`;
            handleError(errorMessage, true);
            return;
        }

        if (!exchangeSettings.instruments || Object.keys(exchangeSettings.instruments).length === 0) {
            const errorMessage = `Fatal: No instruments found for exchange ${exchangeSettings.api_name}. This likely indicates a failed contract list fetch.`;
            handleError(errorMessage, true);
            process.exit(1);
        }

        const ips = settings.ips || [];
        const exchangeInstance = new exchangeClass(ips, globalRateLimiter);

        // Skip exchanges that don't support position limits
        if (!exchangeInstance.has.fetchAllPositionLimits && !exchangeInstance.has.fetchPositionLimit) {
            logWithTimestamp(`Skipping ${exchangeSettings.api_name} - does not support position limits fetching`);
            return;
        }

        for (const instrument in exchangeSettings.instruments) {
            const instrumentData = exchangeSettings.instruments[instrument];

            if (!instrumentData || instrumentData.length === 0) {
                continue;
            }

            const symbols = instrumentData.map(data => ({
                symbol: data.symbol,
                table_symbol: data.table_symbol || data.symbol,
                type: data.type,
                timeframes: data.timeframes
            }));

            // Filter to derivatives only
            const derivativeSymbols = symbols.filter(s => s.type !== 'spot');

            if (derivativeSymbols.length > 0) {
                const lockKey = `${exchangeSettings.api_name}_${instrument}`;

                // Every 5 minutes
                cron.schedule('*/5 * * * *', async () => {
                    if (fetchCycleInProgress[lockKey]) {
                        logWithTimestamp(`Skipping position limits fetch cycle for ${exchangeSettings.api_name} ${instrument} - previous cycle still in progress`);
                        return;
                    }

                    try {
                        fetchCycleInProgress[lockKey] = true;
                        logWithTimestamp(`Fetching position limits for ${exchangeSettings.api_name} ${instrument}...`);

                        const timestamp = moment().utc().startOf('minute').format('YYYY-MM-DD HH:mm:ss');
                        const allData = await fetchAllData(exchangeInstance, derivativeSymbols, instrument, exchangeSettings.api_name);

                        for (const result of allData) {
                            const symbolDetails = derivativeSymbols.find(s => s.symbol === result.symbol);
                            if (symbolDetails && result.tiers && result.tiers.length > 0) {
                                const tableName = getTableName(
                                    exchangeSettings.api_name,
                                    exchangeSettings.table_prefix,
                                    symbolDetails.type,
                                    result.symbol,
                                    symbolDetails.table_symbol
                                );

                                try {
                                    const rows = result.tiers.map(tier => ({
                                        timestamp,
                                        leverageMin: tier.leverageMin,
                                        leverageMax: tier.leverageMax,
                                        maxQuantity: tier.maxQuantity,
                                        maxNotional: tier.maxNotional,
                                    }));
                                    await insertPositionLimitsData(tableName, rows);
                                } catch (error) {
                                    logWithTimestamp(`Error inserting position limits for ${result.symbol}: ${error.message}`);
                                }
                            }
                        }
                    } catch (error) {
                        handleError(error, true);
                    } finally {
                        fetchCycleInProgress[lockKey] = false;
                    }
                });
            } else {
                logWithTimestamp(`Skipping position limits for ${exchangeSettings.api_name} ${instrument} - no derivatives contracts found`);
            }
        }
    } catch (error) {
        handleError(error, true);
    }
}

async function start() {
    try {
        await generateDynamicSettings();
        logWithTimestamp('Dynamic settings generated.');

        settings = await loadSettings();
        logWithTimestamp('Settings loaded.');

        globalRateLimiter = new RollingRateLimiter(settings.domainRateLimits);
        logWithTimestamp('Global rate limiter initialized.');

        if (settings.delisting_detection) {
            CONSECUTIVE_FAIL_THRESHOLD = settings.delisting_detection.consecutive_fail_threshold || 3;
            OTHER_SYMBOLS_SUCCESS_THRESHOLD = settings.delisting_detection.other_symbols_success_threshold || 0.6;
            MIN_SAMPLE_SIZE = settings.delisting_detection.min_sample_size || 3;
            logWithTimestamp(`Delisting detection thresholds: consecutive_fails=${CONSECUTIVE_FAIL_THRESHOLD}, success_rate=${OTHER_SYMBOLS_SUCCESS_THRESHOLD}, min_sample=${MIN_SAMPLE_SIZE}`);
        }

        await ensureTablesExist();
        logWithTimestamp('Confirmed that all tables exist.');

        for (const exchangeSettings of settings.exchanges) {
            await initializeExchangeProcesses(exchangeSettings);
        }
        logWithTimestamp('Exchange processes for position limits initialized.');

        cron.schedule('0 0 * * *', dailyUpdateAndCheck, {
            scheduled: true,
            timezone: "UTC"
        });
        logWithTimestamp('Scheduled daily update and check.');

    } catch (error) {
        handleError(error, true);
    }
}

async function dailyUpdateAndCheck() {
    try {
        logWithTimestamp('Starting daily update and check...');

        await generateDynamicSettings();
        logWithTimestamp('Dynamic settings updated.');

        const newSettings = await loadSettings();

        for (const exchange of newSettings.exchanges) {
            clearSuspectedDelistedForExchange(exchange.api_name);
            clearHealthTrackerForExchange(exchange.api_name);
        }

        settings = newSettings;
        logWithTimestamp('Settings reloaded.');

        if (settings.delisting_detection) {
            CONSECUTIVE_FAIL_THRESHOLD = settings.delisting_detection.consecutive_fail_threshold || 3;
            OTHER_SYMBOLS_SUCCESS_THRESHOLD = settings.delisting_detection.other_symbols_success_threshold || 0.6;
            MIN_SAMPLE_SIZE = settings.delisting_detection.min_sample_size || 3;
            logWithTimestamp(`Delisting detection thresholds reloaded: consecutive_fails=${CONSECUTIVE_FAIL_THRESHOLD}, success_rate=${OTHER_SYMBOLS_SUCCESS_THRESHOLD}, min_sample=${MIN_SAMPLE_SIZE}`);
        }

        deleteOldData(settings.position_limits_days_to_keep || 60, () => {
            logWithTimestamp('Old position limits data deleted.');
        });
        logWithTimestamp('Deletion of old data initiated.');

        await ensureTablesExist();
        logWithTimestamp('Confirmed that all tables exist.');

        logWithTimestamp('New settings have been reloaded.');

    } catch (error) {
        handleError(error, true);
    }
}

start();
