const fs = require('fs').promises;
const path = require('path');
const exchanges = require('./exchanges');
const { loadSettings } = require('../settings');
const settings = loadSettings();

const exchangeConfigurations = settings.exchange_configurations;

// Manual pairs for exchanges that do not have the fetchSymbols method
const manualPairs = settings.manual_pairs;

// Track last refetch time for each exchange to prevent too frequent refetches
const lastRefetchTimes = {};
const REFETCH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown between refetches

async function refetchSymbolsForExchange(exchangeName) {
    // Check if we're within the cooldown period
    const now = Date.now();
    if (lastRefetchTimes[exchangeName] && (now - lastRefetchTimes[exchangeName] < REFETCH_COOLDOWN_MS)) {
        console.log(`Skipping refetch for ${exchangeName} - within cooldown period`);
        return false;
    }

    console.log(`Refetching symbols for exchange ${exchangeName} due to potential delisting...`);

    // Find the configuration for this exchange
    const config = exchangeConfigurations.find(cfg => cfg.api_name === exchangeName);
    if (!config) {
        console.error(`No configuration found for exchange ${exchangeName}`);
        return false;
    }

    // Get current settings
    const currentSettings = await loadSettings();
    let exchangeIndex = currentSettings.exchanges.findIndex(ex => ex.api_name === exchangeName);

    if (exchangeIndex === -1) {
        console.error(`Exchange ${exchangeName} not found in current settings`);
        return false;
    }

    // Create a new exchange settings object
    let updatedExchangeSettings = {
        ...currentSettings.exchanges[exchangeIndex],
        instruments: {}
    };

    // Instantiate the exchange wrapper
    const exchangeWrapper = new exchanges[exchangeName]();

    // Check if the exchange instance has the fetchSymbols method
    if (exchangeWrapper.has.fetchSymbols) {
        for (const category of config.instruments) {
            console.log(`Refetching symbols for category ${category} from ${exchangeName}...`);
            try {
                const symbols = await exchangeWrapper.fetchSymbols(category);
                if (symbols && symbols.length > 0) {
                    updatedExchangeSettings.instruments[category] = symbols.map(symbol => ({
                        symbol: symbol.symbol,
                        table_symbol: symbol.table_symbol,
                        type: symbol.type || 'perpetual',
                        asset: symbol.asset,
                        timeframes: symbol.timeframes || [1],
                    }));
                }
            } catch (error) {
                console.error(`Error refetching symbols for category ${category} from ${exchangeName}:`, error);
                return false;
            }
        }
    } else {
        // Use manual pairs
        if (manualPairs && manualPairs[exchangeName]) {
            // Dynamically setting the instruments under their respective types
            for (const pair of manualPairs[exchangeName]) {
                if (!updatedExchangeSettings.instruments[pair.type]) {
                    updatedExchangeSettings.instruments[pair.type] = [];
                }
                updatedExchangeSettings.instruments[pair.type].push(pair);
            }
        } else {
            console.warn(`No fetchSymbols method and no manual pairs defined for ${exchangeName}`);
            return false;
        }
    }

    // Only update if instruments are defined
    if (Object.keys(updatedExchangeSettings.instruments).length > 0) {
        // Update the exchange in the current settings
        currentSettings.exchanges[exchangeIndex] = updatedExchangeSettings;

        // Write updated settings back to pairs.json
        const pairsFilePath = path.join(__dirname, 'pairs.json');
        await fs.writeFile(pairsFilePath, JSON.stringify(currentSettings, null, 2), 'utf8');
        console.log(`Updated pairs.json with refreshed symbols for ${exchangeName}`);

        // Update the last refetch time
        lastRefetchTimes[exchangeName] = now;

        console.log(`Successfully refetched ${Object.values(updatedExchangeSettings.instruments).flat().length} symbols for ${exchangeName}`);
        return true;
    }

    return false;
}

async function generateDynamicSettings() {
    console.log('Generating dynamic settings...');
    let settings = {
        exchanges: [],
    };

    for (const config of exchangeConfigurations) {
        let exchangeSettings = {
            api_name: config.api_name,
            instruments: {},
        };

        if (config.table_prefix) {
            exchangeSettings.table_prefix = config.table_prefix;
        }

        // Instantiate the exchange wrapper
        const exchangeWrapper = new exchanges[config.api_name]();

        // Check if the exchange instance has the fetchSymbols method
        if (exchangeWrapper.has.fetchSymbols) {
            for (const category of config.instruments) {
                console.log(`Fetching symbols for category ${category} from ${config.api_name}...`)
                try {
                    const symbols = await exchangeWrapper.fetchSymbols(category);
                    if (symbols && symbols.length > 0) {
                        exchangeSettings.instruments[category] = symbols.map(symbol => ({
                            symbol: symbol.symbol,
                            table_symbol: symbol.table_symbol,
                            type: symbol.type || 'perpetual',
                            asset: symbol.asset,
                            timeframes: symbol.timeframes || [1],
                        }));
                    }
                } catch (error) {
                    console.error(`Error fetching symbols for category ${category} from ${config.api_name}:`, error);
                }
            }
        } else {
            // Use manual pairs
            if (manualPairs && manualPairs[config.api_name]) {
                // Dynamically setting the instruments under their respective types
                for (const pair of manualPairs[config.api_name]) {
                    if (!exchangeSettings.instruments[pair.type]) {
                        exchangeSettings.instruments[pair.type] = [];
                    }
                    exchangeSettings.instruments[pair.type].push(pair);
                }
            } else {
                console.warn(`No fetchSymbols method and no manual pairs defined for ${config.api_name}`);
            }
        }

        // Only add this exchange's settings if instruments are defined
        if (Object.keys(exchangeSettings.instruments).length > 0) {
            settings.exchanges.push(exchangeSettings);
        }
    }

    // Write the generated settings directly to the pairs.json file
    const pairsFilePath = path.join(__dirname, 'pairs.json');
    await fs.writeFile(pairsFilePath, JSON.stringify(settings, null, 2), 'utf8');
    console.log('Updated pairs.json with new settings.');
}

module.exports = {
    generateDynamicSettings,
    refetchSymbolsForExchange
};
