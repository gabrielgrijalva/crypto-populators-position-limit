const { handleError, sanitizeAssetName } = require('../utils');
const BaseExchange = require("./base-exchange")

const axios = require("axios");
const moment = require("moment");

class OKX extends BaseExchange {

    constructor(ips = [], globalRateLimiter) {
        super(ips, globalRateLimiter);
        this.url = "https://www.okx.com";
        this.exchangeName = 'okx'
        // Declare capabilities
        this.has = {
            fetchSymbols: true,
            fetchPositionLimit: true,
        }
        this._instrumentsCache = null;
        this._instrumentsCacheTime = 0;
        this._instrumentsCacheTTL = 3600000; // 1 hour cache
    }

    // Helper functions

    async _getInstrumentsCache(instType = 'SWAP') {
        const now = Date.now();
        if (this._instrumentsCache && (now - this._instrumentsCacheTime) < this._instrumentsCacheTTL) {
            return this._instrumentsCache;
        }
        try {
            const response = await this.publicRequest('api/v5/public/instruments', { instType });
            if (response?.data?.length) {
                this._instrumentsCache = {};
                for (const inst of response.data) {
                    this._instrumentsCache[inst.instId] = {
                        ctVal: +inst.ctVal,
                        ctMult: +inst.ctMult || 1,
                        ctValCcy: inst.ctValCcy,
                    };
                }
                this._instrumentsCacheTime = now;
            }
        } catch (error) {
            console.error('Error fetching instruments from OKX:', error);
        }
        return this._instrumentsCache || {};
    }

    // Exchange info functions

    async fetchSymbols(instrument) {
        const response = await this.publicRequest('api/v5/public/instruments', {
            instType: instrument.toUpperCase(), // SPOT / SWAP / FUTURES / OPTION
        })
        if (response?.data?.length) {
            return response.data
            .filter(res => res.state === 'live')
            .map(res => {
                let adjustedType;
                switch(res.instType) {
                    case 'SPOT':
                        adjustedType = 'spot';
                        break;
                    case 'SWAP':
                        adjustedType = 'perpetual';
                        break;
                    case 'FUTURES':
                        adjustedType = 'futures';
                        break;
                    default:
                        throw new Error(`Unsupported type ${res.instType}`);
                }
                return {
                    symbol: res.instId,
                    table_symbol: res.instId.replace(/-/g, '').replace('SWAP', ''),
                    type: adjustedType,
                    // split uly by - and get first part
                    asset: sanitizeAssetName(res.uly.split('-')[0]),
                }
            })
        }
        return null;
    }

    // Position limits functions

    async fetchPositionLimit(symbol, instrument) {
        const response = await this.publicRequest('api/v5/public/position-tiers', {
            instType: 'SWAP',
            instId: symbol,
            tdMode: 'cross',
        });
        if (response?.data?.length) {
            const instrumentsCache = await this._getInstrumentsCache('SWAP');
            const instSpec = instrumentsCache[symbol];
            const ctVal = instSpec?.ctVal || 1;

            return {
                symbol,
                tiers: response.data.map(tier => {
                    return {
                        leverageMin: 1,
                        leverageMax: +tier.maxLever,
                        maxQuantity: +tier.maxSz * ctVal,
                        maxNotional: null,
                    };
                }),
            };
        }
        return null;
    }

}

module.exports = OKX;
