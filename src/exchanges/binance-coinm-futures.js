const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class BinanceCOINMFutures extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://dapi.binance.com";
        this.exchangeName = 'binance-coinm-futures'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest('dapi/v1/exchangeInfo');
        if (response?.symbols?.length) {
            return response.symbols
            .filter(symbol => symbol.contractStatus === 'TRADING')
            .map(symbol => {
                let adjustedType;
                switch (symbol.contractType.toLowerCase()) {
                    case 'perpetual':
                    case 'tradifi_perpetual':
                        adjustedType = 'perpetual';
                        break;
                    case 'current_quarter':
                        adjustedType = 'futures';
                        break;
                    case 'next_quarter':
                        adjustedType = 'futures';
                        break;
                    default:
                        // Skip unsupported contract types instead of throwing
                        return null;
                }

                return {
                    symbol: symbol.symbol,
                    table_symbol: symbol.pair,
                    type: adjustedType,
                    asset: sanitizeAssetName(symbol.baseAsset),
                }
            })
            .filter(Boolean);
        }
        return null;
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument, authConfig = {}) {
        const response = await this.authenticatedRequest('dapi/v2/leverageBracket', {}, authConfig);
        if (response?.length) {
            return response.map(item => {
                return {
                    symbol: item.symbol,
                    tiers: item.brackets.map(bracket => {
                        return {
                            leverageMin: 1,
                            leverageMax: bracket.initialLeverage,
                            maxQuantity: bracket.qtyCap,
                            maxNotional: null,
                        };
                    }),
                };
            });
        }
        return null;
    }

}

module.exports = BinanceCOINMFutures;
