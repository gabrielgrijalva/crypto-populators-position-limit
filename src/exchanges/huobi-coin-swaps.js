const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const moment = require("moment");

class HuobiCoinSwaps extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api.hbdm.vn";
        this.exchangeName = 'huobi-coin-swaps'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest('swap-api/v1/swap_contract_info', {
        })
        if (response?.status === 'ok' && response?.data?.length) {
            return response.data.map(res => {
                return {
                    symbol: res.contract_code,
                    table_symbol: res.contract_code.replace('-', ''),
                    type: 'perpetual',
                    asset: sanitizeAssetName(res.symbol),
                }
            })
        }
        return null;
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument, authConfig = {}) {
        try {
            // Fetch contract info (public) for contract_size per symbol
            const contractInfoResponse = await this.publicRequest('swap-api/v1/swap_contract_info', {});
            if (contractInfoResponse?.status !== 'ok' || !contractInfoResponse?.data?.length) {
                return null;
            }

            const contractSizeMap = {};
            for (const contract of contractInfoResponse.data) {
                contractSizeMap[contract.contract_code] = +contract.contract_size;
            }

            // Fetch position limits (authenticated) for buy_limit/sell_limit per symbol
            const positionLimitResponse = await this.huobiAuthenticatedRequest(
                'swap-api/v1/swap_position_limit',
                {},
                authConfig
            );

            if (positionLimitResponse?.status !== 'ok' || !positionLimitResponse?.data?.length) {
                return null;
            }

            // Fetch adjust factors (public) for max leverage per symbol
            const adjustFactorResponse = await this.publicRequest('swap-api/v1/swap_adjustfactor', {});
            const maxLeverageMap = {};
            if (adjustFactorResponse?.status === 'ok' && adjustFactorResponse?.data?.length) {
                for (const item of adjustFactorResponse.data) {
                    let maxLever = 0;
                    for (const entry of (item.list || [])) {
                        if (+entry.lever_rate > maxLever) {
                            maxLever = +entry.lever_rate;
                        }
                    }
                    maxLeverageMap[item.contract_code] = maxLever;
                }
            }

            const results = [];

            for (const item of positionLimitResponse.data) {
                const symbol = item.contract_code;
                const contractSize = contractSizeMap[symbol];

                // Skip symbols without active contract info (likely delisted)
                if (!contractSize) continue;

                const buyLimit = +item.buy_limit;
                const sellLimit = +item.sell_limit;
                const maxLeverage = maxLeverageMap[symbol] || 0;

                if (maxLeverage <= 0) continue;

                // Normalize: contracts × contract_size (USD per contract) = USD notional
                const maxNotional = Math.min(buyLimit, sellLimit) * contractSize;

                results.push({
                    symbol,
                    tiers: [{
                        leverageMin: 1,
                        leverageMax: maxLeverage,
                        maxQuantity: null,
                        maxNotional: maxNotional,
                    }],
                });
            }

            return results.length ? results : null;
        } catch (error) {
            console.error('Error fetching all position limits:', error.message);
            return null;
        }
    }

}

module.exports = HuobiCoinSwaps;
