const url = require('url');
const tldjs = require('tldjs');

class RollingRateLimiter {
    constructor(domainLimits) {
        this.domainLimits = domainLimits;
        this.domainRequests = {};
    }

    async requestPermission(fullUrl) {
        const { hostname } = url.parse(fullUrl);
        const baseDomain = tldjs.getDomain(hostname);
        const now = Date.now();

        if (!this.domainLimits[baseDomain]) {
            console.warn(`No rate limit defined for domain: ${baseDomain}`);
            return;
        }

        const { maxRequests, timeWindow } = this.domainLimits[baseDomain];

        if (!this.domainRequests[baseDomain]) {
            this.domainRequests[baseDomain] = [];
        }

        // Remove expired requests
        this.domainRequests[baseDomain] = this.domainRequests[baseDomain].filter(timestamp => now - timestamp < timeWindow);

        // Log current rate limit status
        console.log(`Rate limit for ${baseDomain}: ${this.domainRequests[baseDomain].length}/${maxRequests} requests in the last ${timeWindow}ms`);

        if (this.domainRequests[baseDomain].length >= maxRequests) {
            const oldestRequest = this.domainRequests[baseDomain][0];
            const timeToWait = oldestRequest + timeWindow - now;

            console.log(`Rate limit exceeded for ${baseDomain}. Waiting ${timeToWait}ms before next request.`);
            await new Promise(resolve => setTimeout(resolve, timeToWait));

            // Recursive call to check again after waiting
            return this.requestPermission(fullUrl);
        }

        // Record the current request
        this.domainRequests[baseDomain].push(now);
    }

    cleanupUnusedDomains() {
        const now = Date.now();
        for (const [domain, requests] of Object.entries(this.domainRequests)) {
            if (requests.length === 0 || now - Math.max(...requests) > this.domainLimits[domain].timeWindow * 2) {
                delete this.domainRequests[domain];
                console.log(`Removed unused domain from rate limiter: ${domain}`);
            }
        }
    }
}

module.exports = RollingRateLimiter;
