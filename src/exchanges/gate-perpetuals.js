const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class GatePerpetuals extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api.gateio.ws/api/v4";
        this.exchangeName = 'gate-perpetuals'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchAllPositionLimits: true,
        }
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest(`futures/${instrument.toLowerCase()}/contracts/`, {
        })
        if (response?.length) {
            return response
            .filter(res => res.in_delisting == false)
            .map(res => {
                return {
                    symbol: res.name,
                    table_symbol: res.name.replace('_', ''),
                    type: instrument.toLowerCase() == 'btc'  && +res.quanto_multiplier ? 'perpetual_quanto' : 'perpetual',
                    asset: sanitizeAssetName(res.name.split('_')[0]),
                }
            })
        }
        return null;
    }

    // Position limits functions

    async fetchAllPositionLimits(instrument) {
        try {
            const settle = instrument.toLowerCase(); // 'usdt' or 'btc'
            let allTiers = [];
            let offset = 0;
            const limit = 100;

            do {
                const params = { limit, offset };
                const response = await this.publicRequest(`futures/${settle}/risk_limit_tiers`, params);

                if (response?.length) {
                    allTiers.push(...response);
                }

                if (!response || response.length < limit) {
                    break;
                }

                offset += limit;
                await new Promise(resolve => setTimeout(resolve, 200));
            } while (true);

            if (!allTiers.length) {
                return null;
            }

            // Group tiers by contract name
            const grouped = {};
            for (const tier of allTiers) {
                const contract = tier.contract;
                if (!grouped[contract]) {
                    grouped[contract] = [];
                }
                grouped[contract].push(tier);
            }

            return Object.entries(grouped).map(([contract, tiers]) => {
                return {
                    symbol: contract,
                    tiers: tiers.map(tier => ({
                        leverageMin: 1,
                        leverageMax: +tier.leverage_max,
                        maxQuantity: null,
                        maxNotional: +tier.risk_limit,
                    })),
                };
            });
        } catch (error) {
            console.error('Error fetching all position limits:', error.message);
            return null;
        }
    }

}

module.exports = GatePerpetuals;
