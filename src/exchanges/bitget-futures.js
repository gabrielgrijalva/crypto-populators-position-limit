const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class BitgetFutures extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api.bitget.com";
        this.exchangeName = 'bitget-futures'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchPositionLimit: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest('api/v2/mix/market/contracts', {
            productType: instrument
        }
        );
        if (response?.msg === 'success' && response?.data?.length) {
            return response.data
            .filter(res => res.symbolStatus === 'normal')
            .map(res => {
                let adjustedType;
                switch(res.symbolType) {
                    case 'perpetual':
                        adjustedType = 'perpetual';
                        break;
                    case 'delivery':
                        adjustedType = 'futures';
                        break;
                    default:
                        throw new Error(`Unsupported type ${res.symbolType}`);
                }

                return {
                    symbol: res.symbol,
                    table_symbol: res.symbol,
                    type: adjustedType,
                    asset: sanitizeAssetName(res.baseCoin),
                }
                }
            );
        }
        return null;
    }

    // Position limits functions

    async fetchPositionLimit(symbol, instrument) {
        try {
            const productTypeMap = {
                'usdt-futures': 'USDT-FUTURES',
                'coin-futures': 'COIN-FUTURES',
            };
            const productType = productTypeMap[instrument] || instrument.toUpperCase();

            const response = await this.publicRequest('api/v2/mix/market/query-position-lever', {
                symbol,
                productType,
            });

            if (response?.code === '00000' && response?.data?.length) {
                return {
                    symbol,
                    tiers: response.data.map(tier => ({
                        leverageMin: 1,
                        leverageMax: +tier.leverage,
                        maxQuantity: null,
                        maxNotional: +tier.endUnit,
                    })),
                };
            }
            return null;
        } catch (error) {
            console.error(`Error fetching position limit for ${symbol}:`, error.message);
            return null;
        }
    }

}

module.exports = BitgetFutures;
