const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class Bybit extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api.bybit.com";
        this.exchangeName = 'bybit'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange info functions

    async fetchSymbols(type) {
        try {
            let allSymbols = [];
            let cursor = '';

            do {
                const params = { category: type, limit: 1000 };
                if (cursor) {
                    params.cursor = cursor;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const response = await axios.get(`${this.url}/v5/market/instruments-info`, { params });

                if (response?.data?.result?.list?.length) {
                    allSymbols.push(...response.data.result.list);
                }

                cursor = response?.data?.result?.nextPageCursor || '';
            } while (cursor);

            if (allSymbols.length) {
                return allSymbols
                .filter(res => res.status == 'Trading')
                .map(res => {
                    let adjustedType;
                    switch(type) {
                        case 'spot':
                            adjustedType = 'spot';
                            break;
                        case 'linear':
                            adjustedType = res.contractType == 'LinearPerpetual' ? 'perpetual' : 'futures';
                            break;
                        case 'inverse':
                            adjustedType = res.contractType == 'InversePerpetual' ? 'perpetual' : 'futures';
                            break;
                        default:
                            throw new Error(`Invalid type ${type}`);
                    }

                    let adjustedTableSymbol;
                    switch(adjustedType) {
                        case 'spot':
                            adjustedTableSymbol = res.baseCoin + res.quoteCoin;
                            break;
                        case 'perpetual':
                            adjustedTableSymbol = res.baseCoin + res.quoteCoin;
                            break;
                        case 'futures':
                            adjustedTableSymbol = res.symbol.replace('-', '');
                            break;
                        default:
                            throw new Error(`Invalid type ${type}`);
                    }

                    return {
                        symbol: res.symbol,
                        table_symbol: adjustedTableSymbol,
                        type: adjustedType,
                        asset: sanitizeAssetName(res.baseCoin)
                    }
                })
            }
            return null;
        } catch (error) {
            console.error('Error fetching symbols:', error);
            return null;
        }
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument) {
        try {
            let allTiers = [];
            let cursor = '';

            do {
                const params = { category: instrument };
                if (cursor) {
                    params.cursor = cursor;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const response = await this.publicRequest('v5/market/risk-limit', params);

                if (response?.result?.list?.length) {
                    allTiers.push(...response.result.list);
                }

                cursor = response?.result?.nextPageCursor || '';
            } while (cursor);

            if (!allTiers.length) {
                return null;
            }

            // Group tiers by symbol
            const grouped = {};
            for (const tier of allTiers) {
                if (!grouped[tier.symbol]) {
                    grouped[tier.symbol] = [];
                }
                grouped[tier.symbol].push(tier);
            }

            return Object.entries(grouped).map(([symbol, tiers]) => {
                return {
                    symbol,
                    tiers: tiers.map(tier => {
                        const isLinear = instrument === 'linear';
                        return {
                            leverageMin: 1,
                            leverageMax: +tier.maxLeverage,
                            maxQuantity: isLinear ? null : +tier.riskLimitValue,
                            maxNotional: isLinear ? +tier.riskLimitValue : null,
                        };
                    }),
                };
            });
        } catch (error) {
            console.error('Error fetching all position limits:', error.message);
            return null;
        }
    }

}

module.exports = Bybit;
