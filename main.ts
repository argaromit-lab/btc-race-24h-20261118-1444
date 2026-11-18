import { createInterface } from 'node:readline';

type Bar = {symbol: string; t: number; o: string; h: string; l: string; c: string; v: string | null; o_depth: string[]; c_depth: string[]};
type Position = {symbol: string; qty: string; cost_quote_units: string};
type Hello = {protocol: string; symbols: {symbol: string; price_scale: number; qty_scale: number}[]; capital: {quote_scale: number; quote_units: string}; fees: {fee_bps: number; slippage_bps: number; min_notional_quote_units: string}; caps: {max_weight_bps: number}; warmup_bars?: number};
type Batch = {type: 'batch'; seq: number; t: number; bars: Bar[]; fills: {client_id: string; side: string; status: string}[]; account: {cash_quote_units: string; equity_quote_units: string; positions: Position[]}};
type Point = {open: number; high: number; low: number; close: number; volume: number};

// Experimental high-turnover policy; its negative dev result is documented separately.
const CONFIG = Object.freeze({mode: 'mixed', projection: 6, activity: 0.8, takeProfit: 8, maxBars: 1, impact: 6, allocation: 0.90, stop: 35, buySlippage: 100, sellSlippage: 100});
let priceScale = 5;
let quantityScale = 8;
let quoteScale = 6;
let feeBps = 4;
let slipBps = 2;
let minimumNotional = 1_000_000n;
let maximumWeight = 10000;
let warmup = 0;
let peakEquity = 1_000_000_000n;
let reduced = false;
let halted = false;
let ema3 = 0;
let ema8 = 0;
let ema21 = 0;
let previousGap = 0;
let lastTimestamp = -1;
let openedAt = -1;
let positionHigh = 0;
let exitLatched = false;
let pendingKind = 'momentum';
let entryKind = 'momentum';
const history: Point[] = [];

function initialize(hello: Hello): void {
  if (hello.protocol !== 'agent-fun/bars-replay/v1') throw new Error('unsupported protocol');
  const symbol = hello.symbols.find((item) => item.symbol === 'CBBTC');
  if (!symbol) throw new Error('CBBTC missing');
  priceScale = symbol.price_scale;
  quantityScale = symbol.qty_scale;
  quoteScale = hello.capital.quote_scale;
  feeBps = hello.fees.fee_bps;
  slipBps = hello.fees.slippage_bps;
  minimumNotional = BigInt(hello.fees.min_notional_quote_units);
  maximumWeight = hello.caps.max_weight_bps;
  warmup = hello.warmup_bars ?? 0;
  peakEquity = BigInt(hello.capital.quote_units);
}

function valueAt(quantity: bigint, rawPrice: string): bigint {
  return quantity * BigInt(rawPrice) * 10n ** BigInt(quoteScale) / 10n ** BigInt(priceScale + quantityScale);
}

function chooseOrder(batch: Batch): Record<string, unknown>[] {
  const bar = batch.bars.find((item) => item.symbol === 'CBBTC');
  if (!bar) return [];
  const p = {open: Number(bar.o) / 10 ** priceScale, high: Number(bar.h) / 10 ** priceScale, low: Number(bar.l) / 10 ** priceScale, close: Number(bar.c) / 10 ** priceScale, volume: bar.v === null ? 0 : Number(bar.v)};
  if (lastTimestamp >= 0 && batch.t - lastTimestamp > 180000) {
    history.length = 0;
    ema3 = ema8 = ema21 = 0;
    previousGap = 0;
  }
  lastTimestamp = batch.t;
  const previous = history[history.length - 1];
  const priorHigh = history.length ? Math.max(...history.slice(-3).map((point) => point.high)) : p.high;
  const oldGap = previousGap;
  if (history.length === 0) ema3 = ema8 = ema21 = p.close;
  else {
    ema3 += 0.5 * (p.close - ema3);
    ema8 += 2 / 9 * (p.close - ema8);
    ema21 += 2 / 22 * (p.close - ema21);
  }
  previousGap = (ema3 / ema8 - 1) * 10000;
  history.push(p);
  if (history.length > 64) history.shift();
  const recent = history.slice(-15);
  let rangeSum = 0;
  let positiveVolume = 0;
  let volumeCount = 0;
  for (let index = 0; index < recent.length; index++) {
    const point = recent[index];
    const prior = index ? recent[index - 1].close : point.open;
    rangeSum += Math.max(point.high - point.low, Math.abs(point.high - prior), Math.abs(point.low - prior)) / point.close * 10000;
    if (point.volume > 0) { positiveVolume += point.volume; volumeCount++; }
  }
  const atr = rangeSum / Math.max(1, recent.length);
  const range = (p.high - p.low) / p.close * 10000;
  // Null volume is not fabricated volume: this fallback is a range activity proxy.
  const activity = p.volume > 0 && volumeCount > 1 ? p.volume / (positiveVolume / volumeCount) : range / Math.max(atr, 0.1);
  const one = previous ? (p.close / previous.close - 1) * 10000 : 0;
  const three = history.length >= 4 ? (p.close / history[history.length - 4].close - 1) * 10000 : 0;
  const body = (p.close / p.open - 1) * 10000;
  const cash = BigInt(batch.account.cash_quote_units);
  const equity = BigInt(batch.account.equity_quote_units);
  if (equity >= peakEquity) { peakEquity = equity; reduced = false; }
  const drawdownBps = peakEquity > 0n ? Number((peakEquity - equity) * 10000n / peakEquity) : 0;
  if (drawdownBps >= 1400) reduced = true;
  if (drawdownBps >= 1800) reduced = true;
  if (drawdownBps >= 2200) halted = true;
  const held = batch.account.positions.find((position) => position.symbol === 'CBBTC');
  if (!held) { openedAt = -1; positionHigh = 0; exitLatched = false; }
  if (batch.seq < warmup) return [];

  if (held) {
    const quantity = BigInt(held.qty);
    const cost = BigInt(held.cost_quote_units);
    const value = valueAt(quantity, bar.c);
    const gain = cost > 0n ? Number((value - cost) * 10000n / cost) : 0;
    if (openedAt < 0) { openedAt = batch.seq; positionHigh = p.close; entryKind = pendingKind; }
    positionHigh = Math.max(positionHigh, p.close);
    const age = batch.seq - openedAt + 1;
    const trailing = Math.max(CONFIG.stop, Math.min(100, atr * 2));
    const weak = entryKind === 'reversion' ? one <= 0 && body <= 0 : ema3 < ema8 || (one <= 0 && body <= 0);
    const closeDepth = 1 / bar.c_depth.reduce((sum, raw) => sum + 1 / Number(raw), 0);
    const exitFriction = feeBps + slipBps + Number(value) / (closeDepth * 10 ** (quoteScale - 6)) * 10000;
    const reason = gain >= CONFIG.takeProfit + exitFriction || gain <= -CONFIG.stop || p.close <= positionHigh * (1 - trailing / 10000)
      || age >= CONFIG.maxBars || (age >= 1 && weak) || drawdownBps >= 1800 || halted;
    if (reason || exitLatched) {
      exitLatched = true;
      return [{side: 'sell', client_id: `s${batch.seq}`, symbol: 'CBBTC', qty: quantity.toString(), max_slippage_bps: drawdownBps >= 1800 || gain <= -CONFIG.stop ? 10000 : CONFIG.sellSlippage}];
    }
    return [];
  }
  if (halted || history.length < 9 || cash < minimumNotional) return [];
  const cross = oldGap <= 0 && previousGap > 0;
  const microBreakout = p.close >= priorHigh && one > 0 && three > 0;
  const persistentPush = one > 0 && body > 0 && three > 3;
  const momentum = ema3 > ema8 && activity >= CONFIG.activity && (cross || microBreakout || persistentPush);
  const dip = p.close < ema8 && three < 0;
  const recovery = one > 0 || body > 0 || (p.high > p.low && (p.close - p.low) / (p.high - p.low) > 0.65);
  const reversion = dip && activity >= CONFIG.activity && recovery;
  const signal = CONFIG.mode === 'momentum' ? momentum : CONFIG.mode === 'reversion' ? reversion : momentum || reversion;
  if (!signal) return [];
  const depth = 1 / bar.c_depth.reduce((sum, raw) => sum + 1 / Number(raw), 0);
  if (!(depth > 0) || !Number.isFinite(depth)) return [];
  const quoteFactor = 10 ** (quoteScale - 6);
  const allocationBps = reduced ? 2500 : Math.round(CONFIG.allocation * 10000);
  let spend = cash * BigInt(allocationBps) / 10000n;
  const cap = BigInt(Math.floor(depth * quoteFactor * CONFIG.impact / 10000));
  const weight = equity * BigInt(maximumWeight) / 10000n;
  if (spend > cap) spend = cap;
  if (spend > weight) spend = weight;
  if (spend < minimumNotional) return [];
  const impact = Number(spend) / (depth * quoteFactor) * 10000;
  const roundTripCost = 2 * (feeBps + slipBps + impact);
  // Opportunity-size heuristic; it is not a calibrated expected return.
  const displacement = reversion ? Math.max(0, (ema8 / p.close - 1) * 10000) : Math.max(three, previousGap * 2, 0);
  const moveBudget = Math.max(displacement, range * CONFIG.projection, atr * Math.sqrt(CONFIG.maxBars) * 2);
  if (moveBudget <= roundTripCost + 2) return [];
  pendingKind = momentum ? 'momentum' : 'reversion';
  return [{side: 'buy', client_id: `b${batch.seq}`, symbol: 'CBBTC', notional_quote_units: spend.toString(), max_slippage_bps: CONFIG.buySlippage}];
}

const input = createInterface({input: process.stdin, crlfDelay: Infinity});
let initialized = false;
let nextSequence = 0;
let finished = false;
for await (const line of input) {
  if (!line) continue;
  if (Buffer.byteLength(line, 'utf8') > 1048576) throw new Error('input exceeds protocol limit');
  const message = JSON.parse(line);
  if (message.type === 'hello') {
    if (initialized) throw new Error('duplicate hello');
    initialize(message);
    initialized = true;
  } else if (message.type === 'batch') {
    if (!initialized || message.seq !== nextSequence++) throw new Error('invalid batch sequence');
    if (!Number.isSafeInteger(message.t) || !Array.isArray(message.bars) || !Array.isArray(message.fills)
      || !message.account || !Array.isArray(message.account.positions)) throw new Error('malformed batch');
    if (message.bars.some((bar: Bar) => !Number.isSafeInteger(bar.t) || bar.t > message.t)) {
      throw new Error('future-dated bar');
    }
    const reply = JSON.stringify({type: 'reply', seq: message.seq, orders: chooseOrder(message)});
    if (!process.stdout.write(reply + '\n')) await new Promise<void>((resolve) => process.stdout.once('drain', resolve));
  } else if (message.type === 'done') {
    if (!initialized || message.seq !== nextSequence) throw new Error('invalid done sequence');
    finished = true;
    input.close();
    process.stdin.destroy();
    break;
  } else throw new Error('unknown protocol message');
}
if (!finished) throw new Error('input ended before done');
