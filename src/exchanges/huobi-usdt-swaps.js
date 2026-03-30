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

    async fetchAllPositionLimits(instrument) {
        try {
            const response = await this.publicRequest('linear-swap-api/v1/swap_adjustfactor', {});

            if (response?.status !== 'ok' || !response?.data?.length) {
                return null;
            }

            const results = [];

            for (const item of response.data) {
                const symbol = item.contract_code;
                const leverRates = item.list || [];

                // Find the highest available lever_rate for this symbol
                let maxLeverRate = 0;
                for (const entry of leverRates) {
                    if (+entry.lever_rate > maxLeverRate) {
                        maxLeverRate = +entry.lever_rate;
                    }
                }

                if (maxLeverRate > 0) {
                    results.push({
                        symbol,
                        tiers: [{
                            leverageMin: 0,
                            leverageMax: maxLeverRate,
                            maxQuantity: null,
                            maxNotional: null,
                        }],
                    });
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
