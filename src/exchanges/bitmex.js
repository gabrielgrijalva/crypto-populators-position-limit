const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class BitMEX extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://www.bitmex.com";
        this.exchangeName = 'bitmex'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest('api/v1/instrument/active');
        if (response?.length) {
            return response
            .filter(res => res.state === 'Open' && res.typ === instrument)
            .map(res => {
                let adjustedType;
                switch (res.typ) {
                    case 'FFWCSX':
                        adjustedType = res.isQuanto ? 'perpetual_quanto' : 'perpetual';
                        break;
                    case 'FFCCSX':
                        adjustedType = 'futures';
                        break;
                    case 'IFXXXP':
                        adjustedType = 'spot';
                        break;
                    default:
                        throw new Error(`Unsupported type ${res.typ}`);
                }

                // Replace 'XBT' with 'BTC' for the table_symbol
                let adjustedTableSymbol = res.symbol.replace('XBT', 'BTC');

                return {
                    symbol: res.symbol,
                    table_symbol: adjustedTableSymbol,
                    type: adjustedType,
                    asset: sanitizeAssetName(res.underlying),
                };
            });
        }
        return null;
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument) {
        try {
            const response = await this.publicRequest('api/v1/instrument/active');

            if (!response?.length) {
                return null;
            }

            // Filter to active perpetuals and futures only (skip spot)
            const instruments = response.filter(res =>
                res.state === 'Open' &&
                (res.typ === 'FFWCSX' || res.typ === 'FFCCSX')
            );

            if (!instruments.length) {
                return null;
            }

            const results = [];

            for (const instr of instruments) {
                const {
                    symbol,
                    riskLimit,
                    riskStep,
                    initMargin,
                    maintMargin,
                    underlyingToSettleMultiplier,
                } = instr;

                // Skip instruments without required risk fields
                if (!riskLimit || !riskStep || !initMargin || !maintMargin || !underlyingToSettleMultiplier) {
                    continue;
                }

                const absMultiplier = Math.abs(underlyingToSettleMultiplier);
                const tiers = [];

                // Compute tiers algorithmically: tier N starts at 0
                for (let n = 0; ; n++) {
                    const effectiveInitMargin = initMargin + n * maintMargin;
                    const leverageMax = Math.floor(1 / effectiveInitMargin);

                    if (leverageMax <= 0) {
                        break;
                    }

                    const tierRiskLimit = riskLimit + n * riskStep;
                    const positionLimit = tierRiskLimit / absMultiplier;

                    tiers.push({
                        leverageMin: 1,
                        leverageMax: leverageMax,
                        maxQuantity: null,
                        maxNotional: positionLimit,
                    });

                    // Stop when max leverage reaches 1
                    if (leverageMax <= 1) {
                        break;
                    }
                }

                if (tiers.length) {
                    results.push({
                        symbol,
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

module.exports = BitMEX;
