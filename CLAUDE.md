# CLAUDE.md - crypto-populators-position-limit

## Project Overview

A Node.js service that continuously fetches and stores **max position limits by leverage tier** from 17 cryptocurrency derivatives exchanges into a MySQL database. It runs on an hourly cron schedule (`0 * * * *`), with a daily maintenance cycle at 00:00 UTC.

**Runtime**: Node.js v22+ | **Entry point**: `src/main.js` | **Database**: MySQL (`exchanges` database)

## Architecture

```
src/
├── main.js                  # Core orchestration: cron scheduling, fetch cycles, health tracking
├── fetch-symbols.js         # Symbol discovery & dynamic settings generation
├── pairs.json               # Auto-generated at runtime (gitignored)
├── exchanges/
│   ├── base-exchange.js     # Abstract base class all exchanges extend
│   ├── index.js             # Exchange registry (maps api_name → class)
│   └── *.js                 # 17 exchange implementations
└── utils/
    ├── index.js             # Logging, retries, error handling, asset name sanitization
    ├── db.js                # MySQL pool, table creation, inserts, data deletion
    ├── rolling-rate-limiter.js  # Domain-based rolling window rate limiter
    └── ip-rotating-requests.js  # Round-robin proxy IP rotation for HTTP requests
```

**Configuration**: `settings.js` (root) defines exchange list, DB credentials, rate limits, proxy IPs, API keys (Binance/BingX), and delisting detection thresholds. It loads `src/pairs.json` for the symbol registry.

## Data Flow

1. **Startup**: `generateDynamicSettings()` calls each exchange's `fetchSymbols()` to discover all tradeable contracts and writes `src/pairs.json`
2. **Hourly cron cycle** (`0 * * * *`): For each exchange + instrument pair, calls `fetchAllPositionLimits()` (bulk) or loops `fetchPositionLimit()` (per-symbol), then inserts leverage tiers into MySQL. Timestamps are rounded to start of hour.
3. **Daily maintenance** (00:00 UTC): Refetches symbols, clears health trackers, deletes data older than retention period (default 60 days), creates any missing tables

## Exchange Module Pattern

All exchange files extend `BaseExchange` and must implement:

- `fetchSymbols(instrument)` — Returns list of tradeable contracts
- `fetchPositionLimit(symbol, instrument[, authConfig])` — Returns position limits for a single symbol (per-symbol exchanges)
- `fetchAllPositionLimits(instrument[, authConfig])` — Returns position limits for all symbols in one call (preferred)

Each exchange declares supported methods via `this.has = { fetchSymbols, fetchPositionLimit, fetchAllPositionLimits }`.

**Adding a new exchange**:
1. Create `src/exchanges/{exchange-name}.js` extending `BaseExchange`
2. Implement `fetchSymbols` + one of the position limit methods, declaring capabilities in `this.has`
3. Register in `src/exchanges/index.js`
4. Add config entry in `settings.js` with `api_name`, optional `table_prefix`, and `instruments` array
5. Add rate limit entry in `settings.js` `domainRateLimits` for the exchange's API domain
6. If the exchange requires authentication, add key/secret to `settings.js` and update `getAuthConfig()` in `main.js`

**Standardized position limit response**: All exchanges must normalize to this shape:
```js
{
  symbol: "BTCUSDT",
  tiers: [
    { leverageMin: 1, leverageMax: 100, maxQuantity: null, maxNotional: 10000000 },
    { leverageMin: 1, leverageMax: 50,  maxQuantity: null, maxNotional: 50000000 },
    // ... one entry per leverage tier
  ]
}
```

## Data Normalization

Position limits are stored in **real, normalized units** — not raw contract counts:

- **`maxQuantity`**: Base asset units (BTC, ETH, etc.). Used by: Binance COINM, OKX (converts contracts × ctVal), CoinEx, Kraken, Bybit inverse.
- **`maxNotional`**: Settlement/quote currency (USDT, USD, BTC). Used by: Binance USDM (USDT), BingX (USDT), Bitget (USDT/USD), Bybit linear (USDT), Gate.io (USDT or BTC), KuCoin (USDT or BTC), Phemex (BTC or USDT), BitMEX (settlement ccy), Deribit (base ccy).
- **NULL**: Exchange does not enforce that limit type. Huobi (both) stores NULL/NULL — only max leverage is recorded.

OKX is the only exchange that requires explicit conversion: `maxSz` (contracts) × `ctVal` (contract value from instruments cache) = base asset quantity.

BitMEX and Deribit compute tiers algorithmically from margin parameters rather than returning a discrete tier array.

## Database Schema

One table per symbol, named `{prefix}_{instrumentCode}_position_limits_{symbol}`:

```sql
CREATE TABLE {tableName} (
    timestamp DATETIME NOT NULL,
    leverage_min DECIMAL(10,2) NOT NULL,
    leverage_max DECIMAL(10,2) NOT NULL,
    max_quantity DECIMAL(30,8) NULL,
    max_notional DECIMAL(30,2) NULL,
    PRIMARY KEY (timestamp, leverage_min)
)
```

Instrument type codes: `f` = futures, `p` = perpetual, `pq` = perpetual_quanto, `s` = spot. Max table name length: 64 chars.

Inserts use `ON DUPLICATE KEY UPDATE` (upsert on timestamp + leverage_min). Multiple rows per timestamp (one per leverage tier).

## Authentication

Three exchanges require authenticated API requests (HMAC-SHA256 signing):

| Exchange | Config keys | Header |
|----------|-------------|--------|
| Binance USDM | `binance_api_key`, `binance_api_secret` | `X-MBX-APIKEY` |
| Binance COINM | `binance_api_key`, `binance_api_secret` | `X-MBX-APIKEY` |
| BingX USDM | `bingx_api_key`, `bingx_api_secret` | `X-BX-APIKEY` |

Auth config is resolved by `getAuthConfig(exchangeName)` in `main.js` and passed through `fetchAllData()` to the exchange methods. The `authenticatedRequest()` method in `BaseExchange` handles timestamp injection, query string signing, and header attachment.

## Key Subsystems

### Symbol Health Tracking (`main.js`)
Detects delistings by tracking consecutive failures per symbol. A symbol is suspected delisted when:
- It fails `CONSECUTIVE_FAIL_THRESHOLD` (3) times in a row
- At least `OTHER_SYMBOLS_SUCCESS_THRESHOLD` (60%) of other symbols on the same exchange are succeeding
- Minimum `MIN_SAMPLE_SIZE` (3) other symbols exist for comparison

Triggers automatic symbol refetch with 1-hour cooldown. Resets daily.

### Rate Limiting (`utils/rolling-rate-limiter.js`)
Domain-based rolling window limiter. Limits are defined per domain in `settings.js` and multiplied by number of proxy IPs. Blocks requests that would exceed the limit until the window clears.

### IP Rotation (`utils/ip-rotating-requests.js`)
Round-robin rotation across 4 proxy IPs per hostname. Uses `localAddress` binding on HTTPS agent.

### Error Handling (`utils/index.js`)
- `withRetries(fn, retries=5, delay=2000)` — Exponential retry wrapper for API calls
- `handleError(error, sendEmail)` — Logs with UTC timestamp, optionally sends debounced email via SendGrid (5-second batching window)

## Important Conventions

- **`maxQuantity` values are in base asset units; `maxNotional` values are in settlement/quote currency** — never raw contract counts
- **Timestamps use UTC** throughout (`moment.utc()`) and are rounded to start of hour
- **Logging format**: `YYYY-MM-DD HH:mm:ss.SSS [crypto-populators-position-limit] - message`
- **Asset name sanitization**: XBT/xbt → BTC, strips underscores/hyphens/spaces, removes large numeric suffixes (100000, 1000000)
- **Fetch cycle mutex**: `fetchCycleInProgress[lockKey]` prevents overlapping cron cycles for the same exchange+instrument
- Files use **kebab-case**, variables use **camelCase**, classes use **PascalCase**, thresholds use **UPPER_SNAKE_CASE**

## Exchanges (17 total)

| Exchange | Module | Method | Auth | Instruments |
|----------|--------|--------|------|-------------|
| Bybit | `bybit.js` | bulk (paginated) | No | linear, inverse |
| Binance USDM | `binance-usdm-futures.js` | bulk | Yes | perpetual |
| Binance COINM | `binance-coinm-futures.js` | bulk | Yes | perpetual |
| OKX | `okx.js` | per-symbol | No | SWAP (perpetual) |
| Gate.io | `gate-perpetuals.js` | bulk (paginated) | No | btc, usdt |
| Huobi USDT | `huobi-usdt-swaps.js` | bulk (NULL-only) | No | swap |
| Huobi Coin | `huobi-coin-swaps.js` | bulk (NULL-only) | No | swap |
| Phemex Standard | `phemex-contract.js` | bulk | No | perpetual |
| Phemex Hedged | `phemex-hedged-contract.js` | bulk | No | perpetual |
| BitMEX | `bitmex.js` | bulk (algorithmic) | No | FFWCSX |
| CoinEx | `coinex-futures.js` | bulk | No | perpetual |
| Deribit | `deribit.js` | bulk (synthetic) | No | perpetual, future |
| Kraken Futures | `kraken-futures.js` | bulk | No | perpetual, future |
| KuCoin Linear | `kucoin-linear.js` | per-symbol | No | perpetual |
| KuCoin Inverse | `kucoin-inverse.js` | per-symbol | No | perpetual |
| BingX USDM | `bingx-usdm-futures.js` | per-symbol | Yes | perpetual |
| Bitget | `bitget-futures.js` | per-symbol | No | usdt-futures, coin-futures |

## Dependencies

| Package | Purpose |
|---------|---------|
| `mysql2` | MySQL connection pool (promise API) |
| `axios` | HTTP client for exchange API requests |
| `node-cron` | Cron scheduling for fetch cycles and daily maintenance |
| `moment` | UTC date/time formatting and hour rounding |
| `@sendgrid/mail` | Email error notifications |
| `tldjs` | Domain extraction from URLs for rate limiter |

## Production Environment

### Infrastructure

- **Cloud**: AWS EC2
- **Instance**: AMD EPYC 7R13 — 4 vCPUs, 7.6 GB RAM
- **Storage**: 500 GB NVMe SSD (`nvme0n1`), ~16 GB used (4%)
- **OS**: Ubuntu 24.04.4 LTS (Noble Numbat), kernel 6.17
- **Private IP**: `172.31.41.117` (primary)
- **SSH access**: `ssh ubuntu@crypto-populators-volume` (hostname in local `/etc/hosts`)

### Networking — 4 Elastic IPs

The instance has 4 network interfaces (`ens5`–`ens8`), each with its own private IP, used for IP-rotated API requests:

| Interface | Private IP | Purpose |
|-----------|-----------|---------|
| `ens5` | `172.31.41.117` | Primary + API rotation |
| `ens6` | `172.31.47.55` | API rotation |
| `ens7` | `172.31.43.29` | API rotation |
| `ens8` | `172.31.47.202` | API rotation |

These IPs are configured in `settings.js` and multiplied into rate limit windows (e.g., Bybit: 10 req/s × 4 IPs = 40 req/s effective).

### Firewall

UFW is **inactive** and iptables has default ACCEPT policies. Security is managed at the AWS Security Group level.

### Process Management — PM2

- **Process manager**: PM2 (fork mode, single process)
- **PM2 process name**: `position-limits`
- **Script path**: `/home/ubuntu/crypto-populators-position-limit/src/main.js`
- **Working directory**: `/home/ubuntu/crypto-populators-position-limit`
- **Node.js version**: v18.20.8 (system-installed at `/usr/bin/node`)
- **Auto-restart on boot**: Enabled via `pm2-ubuntu` systemd service + saved dump

**PM2 commands**:
```bash
pm2 status                    # Check process status
pm2 logs position-limits      # Tail stdout + stderr
pm2 logs position-limits --err  # Tail stderr only
pm2 restart position-limits   # Restart the service
pm2 stop position-limits      # Stop the service
pm2 save                      # Save current process list (for boot recovery)
```

### Log Management — pm2-logrotate

- **Module**: `pm2-logrotate` v3.0.0
- **Max file size**: 2048 MB (before rotation)
- **Retention**: 7 rotated files
- **Rotation schedule**: Daily at 00:00 UTC
- **Compression**: Disabled
- **Log location**: `~/.pm2/logs/`

Log files:
- `position-limits-out.log` — stdout (lower volume than volume project due to hourly vs 5-min cron)
- `position-limits-error.log` — stderr (exchange API errors and retries)

### MySQL Database

- **Version**: MySQL 8.0.45 (Ubuntu package)
- **Service**: Running via systemd (`systemctl status mysql`)
- **Database name**: `exchanges`
- **User**: `ardaga`
- **Connection pool**: 10 connections (app-level), max_connections: 151 (server-level)
- **InnoDB buffer pool**: 128 MB

**Data retention**: 60 days (configurable via `position_limits_days_to_keep` in `settings.js`). Old rows are purged daily at 00:00 UTC.

### Deployment

- **Git remote**: `git@github.com:gabrielgrijalva/crypto-populators-position-limit.git`
- **Deploy path**: `/home/ubuntu/crypto-populators-position-limit`

The production VM must have SSH-based git credentials configured (`~/.ssh/` key registered with GitHub) so that it can pull from the remote repository. The project on the VM is a git-tracked clone of the repo.

**Initial setup on production VM**:
```bash
cd /home/ubuntu
git clone git@github.com:gabrielgrijalva/crypto-populators-position-limit.git
cd crypto-populators-position-limit
npm install
# Create settings.js with production credentials (DB, API keys, proxy IPs)
pm2 start src/main.js --name position-limits
pm2 save
```

**Deploying updates**:
```bash
cd /home/ubuntu/crypto-populators-position-limit
git pull origin main
npm install        # only if dependencies changed
pm2 restart position-limits
```

All code changes must be committed and pushed to the remote, then pulled on the production VM. Never edit source files directly on the VM — only `settings.js` (which is gitignored) should be created/edited on the VM.

## Common Tasks

- **Run the service**: `node src/main.js` (local) or `pm2 restart position-limits` (production)
- **Install dependencies**: `npm install`
- **Config changes**: Edit `settings.js` (exchange list, rate limits, DB credentials, proxy IPs, API keys)
- **Symbol list is auto-generated**: `src/pairs.json` is written at startup and refreshed daily; do not edit manually
- **View production logs**: `ssh ubuntu@crypto-populators-volume "pm2 logs position-limits --lines 100"`
- **Check production status**: `ssh ubuntu@crypto-populators-volume "pm2 status"`
