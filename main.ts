import { createInterface } from 'node:readline';

type Bar = {symbol: string; t: number; o: string; h: string; l: string; c: string; v: string | null; o_depth: string[]; c_depth: string[]};
type Position = {symbol: string; qty: string; cost_quote_units: string};
type Hello = {protocol: string; symbols: {symbol: string; price_scale: number; qty_scale: number}[]; capital: {quote_scale: number; quote_units: string}; fees: {fee_bps: number; slippage_bps: number; min_notional_quote_units: string}; caps: {max_weight_bps: number}; warmup_bars?: number};
type Batch = {type: 'batch'; seq: number; t: number; bars: Bar[]; fills: {client_id: string; side: string; status: string}[]; account: {cash_quote_units: string; equity_quote_units: string; positions: Position[]}};
type Point = {close: number; high: number; low: number; range: number; fast: number; volume: number | null};

const POLICY = Object.freeze({breakout: 30, minimumMove: 35, activity: 1.0, trail: 40, hold: 60});
const fastSpan = 12, mediumSpan = 36, slowSpan = 96;
let priceScale = 5, quantityScale = 8, quoteScale = 6;
let fees = 4, slippage = 2, maximumWeight = 10000, warmup = 0;
let minimumNotional = 1000000n;
let peakEquity = 1000000000n;
let reduced = false, halted = false, closing = false;
let fast: number | null = null, medium: number | null = null, slow: number | null = null;
let lastTimestamp = -1, openedAt = -1, positionHigh = 0, additions = 0, lastExit = -100;
const points: Point[] = [];
const seeds = new Map<number, number[]>();

function initialize(hello: Hello): void {
  if (hello.protocol !== 'agent-fun/bars-replay/v1') throw new Error('unsupported protocol');
  const asset = hello.symbols.find((item) => item.symbol === 'CBBTC');
  if (!asset) throw new Error('CBBTC missing');
  priceScale = asset.price_scale;
  quantityScale = asset.qty_scale;
  quoteScale = hello.capital.quote_scale;
  fees = hello.fees.fee_bps;
  slippage = hello.fees.slippage_bps;
  minimumNotional = BigInt(hello.fees.min_notional_quote_units);
  maximumWeight = hello.caps.max_weight_bps;
  warmup = hello.warmup_bars ?? 0;
  peakEquity = BigInt(hello.capital.quote_units);
}

function step(previous: number | null, span: number, close: number): number | null {
  if (previous !== null) return previous + 2 / (span + 1) * (close - previous);
  const seed = seeds.get(span) ?? [];
  seed.push(close);
  seeds.set(span, seed);
  if (seed.length < span) return null;
  const value = seed.reduce((sum, price) => sum + price, 0) / span;
  seeds.delete(span);
  return value;
}

function valueAt(quantity: bigint, rawPrice: string): bigint {
  return quantity * BigInt(rawPrice) * 10n ** BigInt(quoteScale) / 10n ** BigInt(priceScale + quantityScale);
}

function quantityAt(value: bigint, rawPrice: string): bigint {
  return value * 10n ** BigInt(priceScale + quantityScale) / (BigInt(rawPrice) * 10n ** BigInt(quoteScale));
}

function returnBps(span: number): number {
  if (points.length <= span) return 0;
  return (points[points.length - 1].close / points[points.length - span - 1].close - 1) * 10000;
}

function meanRange(from: number, to: number): number {
  const rows = points.slice(from, to);
  return rows.length ? rows.reduce((sum, point) => sum + point.range, 0) / rows.length : 0;
}

function activityRatio(): number {
  const recent = points.slice(-5), prior = points.slice(-25, -5);
  const volumeKnown = recent.length === 5 && prior.length === 20 && [...recent, ...prior].every((point) => point.volume !== null);
  if (volumeKnown) {
    const before = prior.reduce((sum, point) => sum + point.volume!, 0) / prior.length;
    const now = recent.reduce((sum, point) => sum + point.volume!, 0) / recent.length;
    return before > 0 ? now / before : 0;
  }
  // Pool-state input has null volume. This is range activity, never reported as measured volume.
  const before = meanRange(-25, -5), now = meanRange(-5, points.length);
  return before > 0 ? now / before : now > 0 ? 1 : 0;
}

function depthQuoteUnits(bar: Bar): number {
  let inverse = 0;
  for (const raw of bar.c_depth) {
    const depth = Number(raw);
    if (!(depth > 0)) return 0;
    inverse += 1 / depth;
  }
  return inverse > 0 ? 1 / inverse * 10 ** (quoteScale - 6) : 0;
}

function chooseOrder(batch: Batch): Record<string, unknown>[] {
  const bar = batch.bars.find((item) => item.symbol === 'CBBTC');
  if (!bar) return [];
  if (lastTimestamp >= 0 && batch.t - lastTimestamp > 180000) {
    points.length = 0;
    seeds.clear();
    fast = medium = slow = null;
  }
  lastTimestamp = batch.t;
  const close = Number(bar.c) / 10 ** priceScale;
  const previousClose = points.length ? points[points.length - 1].close : Number(bar.o) / 10 ** priceScale;
  const high = Number(bar.h) / 10 ** priceScale, low = Number(bar.l) / 10 ** priceScale;
  fast = step(fast, fastSpan, close);
  medium = step(medium, mediumSpan, close);
  slow = step(slow, slowSpan, close);
  const range = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)) / close * 10000;
  points.push({close, high, low, range, fast: fast ?? close, volume: bar.v === null ? null : Number(bar.v)});
  if (points.length > 180) points.shift();

  const cash = BigInt(batch.account.cash_quote_units), equity = BigInt(batch.account.equity_quote_units);
  if (equity >= peakEquity) { peakEquity = equity; reduced = false; }
  const drawdown = peakEquity > 0n ? Number((peakEquity - equity) * 10000n / peakEquity) : 0;
  if (drawdown >= 600) reduced = true;
  if (drawdown >= 1000) { halted = true; closing = true; }
  for (const fill of batch.fills) if (fill.side === 'buy' && fill.status === 'filled') additions++;
  const held = batch.account.positions.find((position) => position.symbol === 'CBBTC');
  if (!held) {
    if (openedAt >= 0) lastExit = batch.seq;
    openedAt = -1;
    positionHigh = 0;
    additions = 0;
    closing = false;
  }
  if (batch.seq < warmup) return [];

  const atr = meanRange(-20, points.length);
  const momentum15 = returnBps(15), momentum30 = returnBps(30);
  const regime = fast !== null && medium !== null && slow !== null && fast > medium && medium > slow;
  const slope5 = points.length > 5 && fast !== null ? (fast / points[points.length - 6].fast - 1) * 10000 : 0;
  // A causal trend projection, not a calibrated promise of future return.
  const moveBudget = Math.min(Math.max(momentum30, momentum15 * 2), Math.max(0, slope5) * 6);
  const conviction = regime && momentum15 > 0 && momentum30 > 0 && moveBudget > POLICY.minimumMove;
  const depth = depthQuoteUnits(bar);
  if (!(depth > 0) || !Number.isFinite(depth)) return [];
  // Buffer below the requested 5 bps; the next open depth is not known yet.
  const impactRoom = BigInt(Math.floor(depth * 4.5 / 10000));
  const positionValue = held ? valueAt(BigInt(held.qty), bar.c) : 0n;

  if (held) {
    const quantity = BigInt(held.qty), cost = BigInt(held.cost_quote_units);
    const gain = cost > 0n ? Number((positionValue - cost) * 10000n / cost) : 0;
    if (openedAt < 0) { openedAt = batch.seq; positionHigh = close; }
    positionHigh = Math.max(positionHigh, close);
    const age = batch.seq - openedAt + 1;
    const initialStop = Math.max(35, Math.min(80, atr * 2));
    const trailingDistance = Math.max(POLICY.trail, Math.min(150, atr * 3));
    const initialFailure = gain <= -initialStop;
    const trailingFailure = (gain >= 25 || age >= 15) && close <= positionHigh * (1 - trailingDistance / 10000);
    const trendFailure = age >= 15 && fast !== null && medium !== null && fast <= medium && momentum15 < 0;
    if (halted || initialFailure || trailingFailure || trendFailure || age >= POLICY.hold) closing = true;
    if (closing) {
      const emergency = drawdown >= 1150;
      let sold = emergency || positionValue <= impactRoom ? quantity : quantityAt(impactRoom, bar.c);
      if (sold > quantity) sold = quantity;
      if (sold <= 0n || (sold < quantity && valueAt(sold, bar.c) < minimumNotional)) return [];
      return [{side: 'sell', client_id: `out${batch.seq}`, symbol: 'CBBTC', qty: sold.toString(), max_slippage_bps: emergency ? 10000 : 125}];
    }
    // Build only while the already-held trade is non-losing and conviction persists.
    if (reduced || additions >= 3 || age > 8 || positionValue < cost || !conviction) return [];
  } else {
    if (halted || !conviction || batch.seq - lastExit < 5 || points.length < slowSpan) return [];
    const prior = points.slice(-POLICY.breakout - 1, -1);
    const ceiling = Math.max(...prior.map((point) => point.high));
    if (close < ceiling || close <= previousClose || activityRatio() < POLICY.activity) return [];
  }

  const desired = equity * BigInt(reduced ? 2500 : 9000) / 10000n;
  const permitted = equity * BigInt(maximumWeight) / 10000n;
  const target = desired < permitted ? desired : permitted;
  const room = target > positionValue ? target - positionValue : 0n;
  let notional = room < cash ? room : cash;
  if (notional > impactRoom) notional = impactRoom;
  if (notional < minimumNotional) return [];
  const roundTripCost = 2 * (fees + slippage + Number(notional) / depth * 10000);
  if (moveBudget <= roundTripCost + 4) return [];
  return [{side: 'buy', client_id: `build${batch.seq}`, symbol: 'CBBTC', notional_quote_units: notional.toString(), max_slippage_bps: 125}];
}

const input = createInterface({input: process.stdin, crlfDelay: Infinity});
let initialized = false, nextSequence = 0, finished = false;
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
      || !message.account || !Array.isArray(message.account.positions)
      || message.bars.some((bar: Bar) => !Number.isSafeInteger(bar.t) || bar.t > message.t)) throw new Error('malformed or future-dated batch');
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
