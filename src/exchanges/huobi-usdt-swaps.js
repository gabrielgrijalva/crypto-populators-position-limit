const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const moment = require("moment");

class HuobiUSDTSwaps extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api.hbdm.vn";
        this.exchangeName = 'huobi-usdt-swaps'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest('linear-swap-api/v1/swap_contract_info', {
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
            const response = await this.huobiAuthenticatedRequest(
                'linear-swap-api/v1/swap_lever_position_limit',
                {},
                authConfig
            );

            if (response?.status !== 'ok' || !response?.data?.length) {
                return null;
            }

            const results = [];

            for (const item of response.data) {
                const symbol = item.contract_code;
                const leverEntries = item.list || [];

                if (!leverEntries.length) continue;

                // Condense per-lever_rate entries into tiers where limit value changes
                const tiers = [];
                let currentLimit = null;
                let tierStartRate = null;

                for (const entry of leverEntries) {
                    const limitValue = Math.min(entry.buy_limit_value, entry.sell_limit_value);

                    if (limitValue !== currentLimit) {
                        if (currentLimit !== null) {
                            tiers.push({
                                leverageMin: tierStartRate,
                                leverageMax: entry.lever_rate - 1,
                                maxQuantity: null,
                                maxNotional: currentLimit,
                            });
                        }
                        currentLimit = limitValue;
                        tierStartRate = entry.lever_rate;
                    }
                }

                // Push final tier
                if (currentLimit !== null) {
                    tiers.push({
                        leverageMin: tierStartRate,
                        leverageMax: leverEntries[leverEntries.length - 1].lever_rate,
                        maxQuantity: null,
                        maxNotional: currentLimit,
                    });
                }

                if (tiers.length > 0) {
                    results.push({ symbol, tiers });
                }
            }

            return results.length ? results : null;
        } catch (error) {
            console.error('Error fetching all position limits:', error.message);
            return null;
        }
    }

}

module.exports = HuobiUSDTSwaps;
