const axios = require('axios');
const https = require('https');
const url = require('url');
const moment = require('moment');

function logWithTimestamp(message) {
    console.log(`${moment().utc().format('YYYY-MM-DD HH:mm:ss.SSS')} - ${message}`);
}

class IPRotatingRequest {
    constructor(ips = []) {
        this.ips = ips;
        this.urlIpMap = new Map();
        if (this.ips.length === 0) {
            console.log('Initialized IPRotatingRequest with default IP (no rotation)');
        } else {
            console.log(`Initialized IPRotatingRequest with IPs: ${this.ips.join(', ')}`);
        }
    }

    getNextIp(fullUrl) {
        if (this.ips.length === 0) return null;

        const { hostname } = url.parse(fullUrl);
        if (!this.urlIpMap.has(hostname)) {
            this.urlIpMap.set(hostname, 0); // Initialize index if hostname is not present
        }

        let currentIndex = this.urlIpMap.get(hostname);
        currentIndex = (currentIndex + 1) % this.ips.length;
        this.urlIpMap.set(hostname, currentIndex);

        const selectedIp = this.ips[currentIndex];
        logWithTimestamp(`Selected IP ${selectedIp} for ${hostname} (index: ${currentIndex})`);
        return selectedIp;
    }


    async request(config) {
        const fullUrl = `${config.baseURL || ''}${config.url}`;
        const { hostname } = url.parse(fullUrl);
        const localAddress = this.getNextIp(fullUrl);

        const axiosConfig = { ...config };
        if (localAddress) {
            axiosConfig.httpsAgent = new https.Agent({ localAddress });
        }

        try {
            const response = await axios(axiosConfig);
            return response;
        } catch (error) {
            console.error(`Error for ${fullUrl}: ${error.message}`);
            throw error;
        }
    }
}

module.exports = IPRotatingRequest;
