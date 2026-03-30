const bitmex = require('./bitmex');
const bybit = require('./bybit');
const coinex_futures = require('./coinex-futures');
const phemex_contract = require('./phemex-contract');
const phemex_hedged_contract = require('./phemex-hedged-contract');
const okx = require('./okx');
const gate_perpetuals = require('./gate-perpetuals');
const huobi_coin_swaps = require('./huobi-coin-swaps');
const huobi_usdt_swaps = require('./huobi-usdt-swaps');
const binance_usdm_futures = require('./binance-usdm-futures');
const binance_coinm_futures = require('./binance-coinm-futures');
const bitget_futures = require('./bitget-futures');
const bingx_usdm_futures = require('./bingx-usdm-futures');
const deribit = require('./deribit');
const kraken_futures = require('./kraken-futures');
const kucoin_linear = require('./kucoin-linear');
const kucoin_inverse = require('./kucoin-inverse');

module.exports = {
    bitmex,
    bybit,
    coinex_futures,
    phemex_contract,
    phemex_hedged_contract,
    okx,
    gate_perpetuals,
    huobi_coin_swaps,
    huobi_usdt_swaps,
    binance_usdm_futures,
    binance_coinm_futures,
    bitget_futures,
    bingx_usdm_futures,
    deribit,
    kraken_futures,
    kucoin_linear,
    kucoin_inverse,
};
