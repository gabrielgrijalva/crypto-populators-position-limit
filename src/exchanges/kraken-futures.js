const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class KrakenFutures extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://futures.kraken.com/derivatives/api/v3";
        this.exchangeName = 'kraken-futures'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        try {
            const response = await axios.get(`${this.url}/instruments`);

            if (response?.data?.instruments?.length) {
                return response.data.instruments
                    .filter(instr => instr.tradeable === true) // Only include tradeable instruments
                    .map(instr => {
                        // Determine if this is perpetual or futures
                        let adjustedType;
                        if (instr.perpetual || instr.symbol.startsWith('PI_') || instr.symbol.startsWith('PF_')) {
                            adjustedType = 'perpetual';
                        } else {
                            adjustedType = 'futures';
                        }

                        // Parse the pair to get base and quote
                        const pairParts = instr.pair.split(':');
                        const base = pairParts[0];
                        const quote = pairParts[1] || 'USD';

                        // Determine if this is inverse or linear
                        const isInverse = instr.symbol.startsWith('PI_');

                        // Format the table_symbol with appropriate suffix
                        const tableSuffix = isInverse ? '_I' : '_L';
                        const tableSymbol = base + quote + tableSuffix;

                        return {
                            symbol: instr.symbol,
                            table_symbol: tableSymbol,
                            type: adjustedType,
                            asset: sanitizeAssetName(base),
                        };
                    });
            }
            return null;
        } catch (error) {
            console.error('Error fetching symbols from Kraken Futures:', error);
            return null;
        }
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument) {
        try {
            const response = await axios.get(`${this.url}/instruments`);

            if (response?.data?.instruments?.length) {
                return response.data.instruments
                    .filter(instr => instr.tradeable === true && instr.marginLevels?.length)
                    .map(instr => {
                        const isInverse = instr.symbol.startsWith('PI_');

                        const tiers = instr.marginLevels.map((level, index) => {
                            const sizeField = isInverse ? level.contracts : level.numNonContractUnits;
                            const nextLevel = instr.marginLevels[index + 1];
                            const nextSizeField = nextLevel
                                ? (isInverse ? nextLevel.contracts : nextLevel.numNonContractUnits)
                                : (instr.maxPositionSize || null);
                            const leverageMax = level.initialMargin > 0
                                ? Math.floor(1 / level.initialMargin)
                                : null;

                            return {
                                leverageMin: 1,
                                leverageMax,
                                maxQuantity: nextSizeField,
                                maxNotional: null,
                            };
                        });

                        return {
                            symbol: instr.symbol,
                            tiers,
                        };
                    });
            }
            return null;
        } catch (error) {
            console.error('Error fetching all position limits from Kraken Futures:', error);
            return null;
        }
    }

}

module.exports = KrakenFutures;
