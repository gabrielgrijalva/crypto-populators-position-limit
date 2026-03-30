const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class CoinExFutures extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api.coinex.com";
        this.exchangeName = 'coinex-futures'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(type) {
        const response = await this.publicRequest('v2/futures/market', {});
        if (response?.code === 0) {
            return response.data.map(symbol => {
                return {
                    symbol: symbol.market,
                    table_symbol: symbol.market,
                    type: 'perpetual',
                    asset: sanitizeAssetName(symbol.market),
                };
            });
        }
        return null;
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument) {
        const response = await this.publicRequest('v2/futures/position-level', {});
        if (response?.code === 0 && response?.data?.length) {
            return response.data.map(item => {
                return {
                    symbol: item.market,
                    tiers: item.level.map(level => {
                        return {
                            leverageMin: 1,
                            leverageMax: +level.leverage,
                            maxQuantity: +level.amount,
                            maxNotional: null,
                        };
                    }),
                };
            });
        }
        return null;
    }

}

module.exports = CoinExFutures;
