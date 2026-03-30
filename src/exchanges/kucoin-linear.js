const { sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange");

const moment = require("moment");

class KuCoinLinear extends BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://api-futures.kucoin.com";
        this.exchangeName = 'kucoin-linear';
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchPositionLimit: true,
        };

        // Cache for contracts data to reduce API calls
        this._contractsCache = null;
        this._contractsCacheTime = 0;
        this._contractsCacheTTL = 60000; // 1 minute cache
    }

    // Helper functions

    async _getContracts() {
        const now = Date.now();
        if (this._contractsCache && (now - this._contractsCacheTime) < this._contractsCacheTTL) {
            return this._contractsCache;
        }

        const response = await this.publicRequest('api/v1/contracts/active', {});
        if (response?.data?.length) {
            this._contractsCache = response.data;
            this._contractsCacheTime = now;
            return response.data;
        }
        return [];
    }

    _getLinearContracts(contracts) {
        return contracts.filter(c =>
            c.isInverse === false &&
            c.status === 'Open' &&
            c.type === 'FFWCSX' // Perpetual type
        );
    }

    _normalizeTableSymbol(symbol) {
        // Remove trailing M and normalize XBT to BTC
        return symbol.replace(/M$/, '').replace(/^XBT/, 'BTC');
    }

    // Exchange data functions

    async fetchSymbols(instrument) {
        try {
            const contracts = await this._getContracts();
            const linearContracts = this._getLinearContracts(contracts);

            return linearContracts.map(contract => {
                // KuCoin uses XBT for Bitcoin
                let asset = contract.baseCurrency;
                if (asset === 'XBT') {
                    asset = 'BTC';
                }

                return {
                    symbol: contract.symbol,
                    table_symbol: this._normalizeTableSymbol(contract.symbol),
                    type: 'perpetual',
                    asset: sanitizeAssetName(asset),
                };
            });
        } catch (error) {
            console.error('Error fetching symbols:', error.message);
            return null;
        }
    }

    // Position limits functions

    async fetchPositionLimit(symbol, instrument) {
        try {
            const response = await this.publicRequest(`api/v1/contracts/risk-limit/${symbol}`, {});

            if (response?.data?.length) {
                return {
                    symbol,
                    tiers: response.data.map(tier => ({
                        leverageMin: 1,
                        leverageMax: +tier.maxLeverage,
                        maxQuantity: null,
                        maxNotional: +tier.maxRiskLimit,
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

module.exports = KuCoinLinear;
