const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class BingXUSDMFutures extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://open-api.bingx.com";
        this.exchangeName = 'bingx-usdm-futures'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchPositionLimit: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        try {
            const timestamp = Date.now();
            const response = await axios.get(`${this.url}/openApi/swap/v2/quote/contracts`, {
                params: { timestamp }
            });

            if (response?.data?.data?.length) {
                return response.data.data.map(contract => {
                    // Extract asset and quote from symbol (e.g., BTC-USDT -> BTC, USDT)
                    const [asset, quote] = contract.symbol.split('-');
                    return {
                        symbol: contract.symbol,
                        table_symbol: asset + quote, // e.g. BTCUSDT
                        type: 'perpetual', // BingX USDT-M are all perpetual contracts
                        asset: sanitizeAssetName(asset),
                    };
                });
            }
            return null;
        } catch (error) {
            console.error('Error fetching symbols from BingX USDM Futures:', error);
            return null;
        }
    }

    // Position limits functions

    async fetchPositionLimit(symbol, instrument, authConfig = {}) {
        try {
            const response = await this.authenticatedRequest('openApi/swap/v1/maintMarginRatio', {
                symbol,
            }, { ...authConfig, headerName: 'X-BX-APIKEY' });

            if (response?.code === 0 && response?.data?.length) {
                return {
                    symbol,
                    tiers: response.data.map(tier => {
                        const maintMarginRatio = +tier.maintMarginRatio;
                        const leverageMax = maintMarginRatio > 0 ? Math.floor(1 / maintMarginRatio) : null;
                        return {
                            leverageMin: 1,
                            leverageMax,
                            maxQuantity: null,
                            maxNotional: +tier.maxPositionVal,
                        };
                    }),
                };
            }
            return null;
        } catch (error) {
            console.error(`Error fetching position limit for ${symbol} from BingX USDM Futures:`, error);
            return null;
        }
    }

}

module.exports = BingXUSDMFutures;
