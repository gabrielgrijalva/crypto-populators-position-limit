const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class Deribit extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://www.deribit.com/api/v2";
        this.exchangeName = 'deribit'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        try {
            const response = await axios.get(`${this.url}/public/get_instruments`, {
                params: {
                    currency: 'any',
                    kind: 'future',
                    expired: false
                }
            });

            if (response?.data?.result?.length) {
                return response.data.result
                    .map(instr => {
                        let adjustedType;
                        if (instr.settlement_period === 'perpetual') {
                            adjustedType = 'perpetual';
                        } else {
                            adjustedType = 'futures';
                        }

                        // Determine if this is linear or inverse
                        const isLinear = instr.instrument_type === 'linear';

                        // Format table_symbol
                        let tableSymbol;
                        if (adjustedType === 'perpetual') {
                            // For perpetuals, use ASSETQUOTE format
                            if (instr.quote_currency) {
                                tableSymbol = instr.base_currency + instr.quote_currency;
                            } else {
                                // For inverse contracts, the quote currency is implied to be USD
                                tableSymbol = instr.base_currency + 'USD';
                            }
                        } else {
                            // For futures, use the original instrument name but clean up any hyphens or underscores
                            tableSymbol = instr.instrument_name.replace(/-|_/g, '');
                        }

                        return {
                            symbol: instr.instrument_name,
                            table_symbol: tableSymbol,
                            type: adjustedType,
                            asset: sanitizeAssetName(instr.base_currency),
                        };
                    });
            }
            return null;
        } catch (error) {
            console.error('Error fetching symbols from Deribit:', error);
            return null;
        }
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument) {
        try {
            const response = await this.publicRequest('public/get_instruments', {
                currency: 'any',
                kind: 'future',
                expired: false,
            });

            if (!response?.result?.length) {
                return null;
            }

            // Margin formula parameters by base currency
            const marginParams = {
                BTC: { baseImRate: 0.02, imScalingFactor: 0.00005 },
                ETH: { baseImRate: 0.02, imScalingFactor: 0.00025 },
            };
            const defaultMarginParams = { baseImRate: 0.05, imScalingFactor: 0.001 };

            const results = [];

            for (const instr of response.result) {
                // Skip options and inactive instruments
                if (!instr.is_active) {
                    continue;
                }

                const maxLeverage = instr.max_leverage;
                if (!maxLeverage || maxLeverage <= 1) {
                    continue;
                }

                const baseCurrency = instr.base_currency;
                const { baseImRate, imScalingFactor } = marginParams[baseCurrency] || defaultMarginParams;

                const tiers = [];

                // Generate synthetic tiers at integer leverage points from (maxLeverage - 1) down to 1
                for (let L = maxLeverage - 1; L >= 1; L--) {
                    const maxPosition = (1 / L - baseImRate) / imScalingFactor;

                    if (maxPosition > 0) {
                        tiers.push({
                            leverageMin: 1,
                            leverageMax: L,
                            maxQuantity: null,
                            maxNotional: maxPosition,
                        });
                    }
                }

                if (tiers.length) {
                    results.push({
                        symbol: instr.instrument_name,
                        tiers,
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

module.exports = Deribit;
