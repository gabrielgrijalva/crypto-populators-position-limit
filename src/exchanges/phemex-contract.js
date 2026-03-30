const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const moment = require("moment");

class PhemexContract extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api.phemex.com";
        this.exchangeName = 'phemex-contract'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest('public/products-plus')
        if (response?.data?.products) {
            return response.data.products
                .filter(res => res.contractUnderlyingAssets === 'USD')
                .map(res => {
                    return {
                        symbol: res.symbol,
                        table_symbol: res.displaySymbol.replace(' / ', ''),
                        type: res.type.toLowerCase(),
                        asset: sanitizeAssetName(res.settleCurrency),
                    }
                })
        }
        return null;
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument) {
        try {
            const response = await this.publicRequest('public/products-plus');

            if (!response?.data?.products || !response?.data?.leverageMargins) {
                return null;
            }

            // Filter to inverse/non-hedged products (contractUnderlyingAssets === 'USD')
            const products = response.data.products.filter(p => p.contractUnderlyingAssets === 'USD');
            const leverageMargins = response.data.leverageMargins;

            // Build a lookup map from index_id to leverage margin items
            const marginMap = {};
            for (const margin of leverageMargins) {
                marginMap[margin.index_id] = margin.items;
            }

            const results = [];
            for (const product of products) {
                const marginItems = marginMap[product.leverageMargin];
                if (!marginItems || !marginItems.length) {
                    continue;
                }

                results.push({
                    symbol: product.symbol,
                    tiers: marginItems.map(item => ({
                        leverageMin: 1,
                        leverageMax: +item.maxLeverageRr || +item.maxLeverage,
                        maxQuantity: null,
                        maxNotional: +item.notionalValueRv,
                    })),
                });
            }

            return results.length ? results : null;
        } catch (error) {
            console.error('Error fetching all position limits:', error.message);
            return null;
        }
    }

}

module.exports = PhemexContract;
