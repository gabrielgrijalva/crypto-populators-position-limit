const IPRotatingRequest = require('../utils/ip-rotating-requests');

class BaseExchange {
    constructor(ips = [], globalRateLimiter) {
        this.ipRotatingRequest = new IPRotatingRequest(ips);
        this.globalRateLimiter = globalRateLimiter;
        this.has = {
            fetchSymbols: false,
            fetchPositionLimit: false,
            fetchAllPositionLimits: false,
        }
    }

    async publicRequest(endpoint, params = {}) {
        const fullUrl = `${this.url}/${endpoint}`;
        if (this.globalRateLimiter) {
            await this.globalRateLimiter.requestPermission(fullUrl);
        }
        try {
            const response = await this.ipRotatingRequest.request({
                method: 'GET',
                url: fullUrl,
                params: params
            });
            return response.data;
        } catch (error) {
            const errorMessage = `Error fetching from ${this.exchangeName} at ${endpoint}: ${error.message}`;
            console.log(errorMessage);
            throw error;
        }
    }

    async authenticatedRequest(endpoint, params = {}, { apiKey, apiSecret, headerName = 'X-MBX-APIKEY', signatureParam = 'signature', timestampParam = 'timestamp' } = {}) {
        const url = `${this.url}/${endpoint}`;

        if (this.globalRateLimiter) {
            await this.globalRateLimiter.requestPermission(url);
        }

        const crypto = require('crypto');
        params[timestampParam] = Date.now();
        const queryString = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

        try {
            const response = await this.ipRotatingRequest.request({
                method: 'GET',
                url: url,
                params: { ...params, [signatureParam]: signature },
                headers: { [headerName]: apiKey },
            });
            return response.data;
        } catch (error) {
            const errorMessage = `Error fetching from ${this.exchangeName} at ${endpoint}: ${error.message}`;
            console.log(errorMessage);
            throw error;
        }
    }

    async fetchSymbols(instrument) {
        throw new Error('fetchSymbols not implemented');
    }

    async fetchPositionLimit(symbol, instrument) {
        throw new Error('fetchPositionLimit not implemented');
    }

    async fetchAllPositionLimits(instrument) {
        throw new Error('fetchAllPositionLimits not implemented');
    }
}

module.exports = BaseExchange;
