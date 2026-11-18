import { createInterface } from 'node:readline';

type Bar = {
  symbol: string;
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string | null;
  o_depth: string[];
  c_depth: string[];
};

type Position = { symbol: string; qty: string; cost_quote_units: string };
type Hello = {
  type: 'hello';
  protocol: string;
  capital: { quote_scale: number; quote_units: string };
  symbols: { symbol: string; price_scale: number; qty_scale: number }[];
  fees: { fee_bps: number; slippage_bps: number; min_notional_quote_units: string };
  caps: { max_weight_bps: number; max_orders_per_bar: number };
  warmup_bars?: number;
};
type Batch = {
  type: 'batch';
  seq: number;
  t: number;
  bars: Bar[];
  fills: { side: string; status: string; client_id: string }[];
  account: {
    cash_quote_units: string;
    equity_quote_units: string;
    positions: Position[];
  };
};

type Point = { close: number; high: number; low: number; open: number; volume: number };

const WINDOW_LIMIT = 121;
const FEE_BPS = 4;
const SLIPPAGE_BPS = 2;
const MIN_EDGE_BPS = 25;
const MAX_SLIPPAGE_BPS = 100;
const symbolHistory = new Map<string, Point[]>();
const emaValues = new Map<string, Map<number, number>>();
let peakEquity = 1_000_000_000;
let positionHigh = 0;
let entrySeq = -1;
let tookPartial = false;
let entryKind: 'reversion' | 'trend' = 'reversion';
let pendingKind: 'reversion' | 'trend' = 'reversion';
let quoteScale = 6;
let priceScale = 5;
let quantityScale = 8;
let feeBps = FEE_BPS;
let slippageBps = SLIPPAGE_BPS;
let warmupBars = 0;
let lastTimestamp = -1;
let stopTriggered = false;
let partialPending: string | null = null;
let exitPending = false;
let minimumNotional = 1_000_000n;
let maximumWeight = 10_000;
// Observe non-overlapping paper setups before enabling the momentum sleeve.
// Each outcome enters the estimate only after its next open and full horizon arrived.
const momentumObservations: { seq: number; open: number | null }[] = [];
const momentumEdges: number[] = [];
let nextMomentumObservation = 0;

function priceBand(history: Point[], span: number): { z: number; edgeBps: number } {
  const points = history.slice(-span);
  const mean = points.reduce((total, point) => total + point.close, 0) / points.length;
  const variance = points.reduce((total, point) => total + (point.close - mean) ** 2, 0) / points.length;
  const close = points[points.length - 1]!.close;
  return { z: (close - mean) / Math.max(Math.sqrt(variance), mean * 0.00005), edgeBps: (mean / close - 1) * 10_000 };
}

function valueAt(quantity: bigint, rawPrice: string): bigint {
  return quantity * BigInt(rawPrice) * 10n ** BigInt(quoteScale) / 10n ** BigInt(quantityScale + priceScale);
}

function ema(symbol: string, span: number, value: number): number {
  let values = emaValues.get(symbol);
  if (values === undefined) {
    values = new Map<number, number>();
    emaValues.set(symbol, values);
  }
  const previous = values.get(span);
  const next = previous === undefined ? value : previous + (2 / (span + 1)) * (value - previous);
  values.set(span, next);
  return next;
}

function returnBps(history: Point[], bars: number): number {
  if (history.length <= bars) return 0;
  const then = history[history.length - 1 - bars]!.close;
  const now = history[history.length - 1]!.close;
  return then > 0 ? ((now / then) - 1) * 10_000 : 0;
}

function realizedVolBps(history: Point[], bars: number): number {
  const start = Math.max(1, history.length - bars);
  if (history.length - start < 2) return 0;
  let total = 0;
  let squares = 0;
  let count = 0;
  for (let i = start; i < history.length; i++) {
    const previous = history[i - 1]!.close;
    const change = previous > 0 ? (history[i]!.close / previous - 1) * 10_000 : 0;
    total += change;
    squares += change * change;
    count++;
  }
  const variance = Math.max(0, squares / count - (total / count) ** 2);
  return Math.sqrt(variance);
}

function atrBps(history: Point[], bars: number): number {
  const start = Math.max(0, history.length - bars);
  let total = 0;
  let count = 0;
  for (let i = start; i < history.length; i++) {
    const point = history[i]!;
    const previous = i > 0 ? history[i - 1]!.close : point.open;
    const scale = point.close || previous;
    if (scale <= 0) continue;
    total += Math.max(point.high - point.low, Math.abs(point.high - previous), Math.abs(point.low - previous)) / scale * 10_000;
    count++;
  }
  return count ? total / count : 0;
}

function volumeWeightedReturn(history: Point[], bars: number): number {
  // Pool-state bars carry no volume. Range-weighted returns below are a price
  // pressure proxy, not an observed order book imbalance or fabricated volume.
  const start = Math.max(1, history.length - bars);
  let weighted = 0;
  let weights = 0;
  for (let i = start; i < history.length; i++) {
    const point = history[i]!;
    const previous = history[i - 1]!.close;
    const change = previous > 0 ? (point.close / previous - 1) * 10_000 : 0;
    const observedVolume = point.volume > 0 ? point.volume : 0;
    const range = point.close > 0 ? (point.high - point.low) / point.close : 0;
    const weight = observedVolume > 0 ? observedVolume : Math.max(range, Math.abs(change) / 10_000, 0.000001);
    weighted += change * weight;
    weights += weight;
  }
  return weights > 0 ? weighted / weights : 0;
}

function pushBar(bar: Bar): Point[] {
  const scale = 10 ** priceScale;
  const point: Point = {
    close: Number(bar.c) / scale,
    high: Number(bar.h) / scale,
    low: Number(bar.l) / scale,
    open: Number(bar.o) / scale,
    volume: bar.v === null ? 0 : Number(bar.v),
  };
  const history = symbolHistory.get(bar.symbol) ?? [];
  history.push(point);
  if (history.length > WINDOW_LIMIT) history.shift();
  symbolHistory.set(bar.symbol, history);
  for (const span of [5, 15, 30, 60, 120]) ema(bar.symbol, span, point.close);
  return history;
}

function chooseOrder(batch: Batch): Record<string, unknown>[] {
  const bar = batch.bars.find((item) => item.symbol === 'CBBTC');
  if (bar === undefined) return [];
  if (lastTimestamp >= 0 && batch.t - lastTimestamp > 180_000) {
    symbolHistory.clear();
    emaValues.clear();
    momentumObservations.length = 0;
    momentumEdges.length = 0;
  }
  lastTimestamp = batch.t;
  const history = pushBar(bar);
  const held = batch.account.positions.find((position) => position.symbol === 'CBBTC');
  const equity = Number(batch.account.equity_quote_units);
  const cash = BigInt(batch.account.cash_quote_units);
  if (equity > peakEquity) peakEquity = equity;
  const drawdown = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
  const price = Number(bar.c) / 10 ** priceScale;
  const shortReturn = returnBps(history, 5);
  const mediumReturn = returnBps(history, 15);
  const longReturn = returnBps(history, 60);
  const fast = emaValues.get(bar.symbol)!.get(5)!;
  const medium = emaValues.get(bar.symbol)!.get(15)!;
  const slow = emaValues.get(bar.symbol)!.get(60)!;
  const vol5 = realizedVolBps(history, 5);
  const vol30 = realizedVolBps(history, 30);
  const atr = atrBps(history, 14);
  const flow = volumeWeightedReturn(history, 5);
  const band = priceBand(history, 30);
  const zScore = band.z;
  const equityCircuit = drawdown >= 0.095;
  for (const observation of momentumObservations) {
    if (batch.seq === observation.seq + 1) observation.open = Number(bar.o);
    if (observation.seq >= 0 && batch.seq >= observation.seq + 16) {
      if (observation.open !== null) momentumEdges.push((Number(bar.o) / observation.open - 1) * 10_000);
      observation.seq = -10000;
    }
  }
  while (momentumObservations.length > 0 && momentumObservations[0]!.seq < 0) momentumObservations.shift();
  if (momentumEdges.length > 24) momentumEdges.shift();
  if (batch.seq >= nextMomentumObservation && history.length >= 60 && fast > medium && medium > slow && mediumReturn > 10) {
    momentumObservations.push({ seq: batch.seq, open: null });
    nextMomentumObservation = batch.seq + 16;
  }
  const momentumMean = momentumEdges.length ? momentumEdges.reduce((sum, edge) => sum + edge, 0) / momentumEdges.length : 0;
  const momentumConfirmed = momentumEdges.length >= 5 && momentumMean > 25;
  if (equityCircuit) stopTriggered = true;
  for (const fill of batch.fills) {
    if (fill.client_id === partialPending) {
      if (fill.status === 'filled') tookPartial = true;
      partialPending = null;
    }
  }

  if (held === undefined) {
    positionHigh = 0;
    entrySeq = -1;
    tookPartial = false;
    partialPending = null;
    exitPending = false;
  }
  if (batch.seq < warmupBars) return [];

  if (held !== undefined) {
    const quantity = BigInt(held.qty);
    const cost = BigInt(held.cost_quote_units);
    if (entrySeq < 0) {
      entrySeq = batch.seq;
      positionHigh = price;
      entryKind = pendingKind;
    }
    // Track closes: an intrabar high happened before this decision and may precede our entry.
    positionHigh = Math.max(positionHigh, price);
    const marketValue = valueAt(quantity, bar.c);
    const gainBps = cost > 0n ? Number((marketValue - cost) * 10_000n / cost) : 0;
    const age = batch.seq - entrySeq;
    const stopDistance = Math.max(80, Math.min(120, atr * 5));
    const trailingStop = positionHigh * (1 - stopDistance / 10_000);
    const hardStop = gainBps <= -80;
    const trendFailed = entryKind === 'trend' && fast < medium && mediumReturn < -MIN_EDGE_BPS;
    const targetReached = gainBps >= (entryKind === 'reversion' ? 30 : 75);
    const meanReverted = entryKind === 'reversion' && gainBps >= 60;
    const exit = stopTriggered || price <= trailingStop || hardStop || trendFailed || meanReverted || age >= (entryKind === 'reversion' ? 40 : 120);
    if (exit || exitPending) {
      exitPending = true;
      const exitSlippage = stopTriggered || hardStop ? 10_000 : MAX_SLIPPAGE_BPS;
      return [{ side: 'sell', client_id: `s${batch.seq}`, symbol: bar.symbol, qty: quantity.toString(), max_slippage_bps: exitSlippage }];
    }
    if (targetReached && !tookPartial && partialPending === null && quantity > 1n) {
      const half = quantity / 2n;
      const partialValue = valueAt(half, bar.c);
      if (partialValue >= minimumNotional) {
        partialPending = `p${batch.seq}`;
        return [{ side: 'sell', client_id: `p${batch.seq}`, symbol: bar.symbol, qty: half.toString(), max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  }

  if (stopTriggered || drawdown >= 0.085 || cash < minimumNotional || history.length < 31) return [];
  const breakout = price >= Math.max(...history.slice(-31, -1).map((point) => point.high));
  const trendSignal = momentumConfirmed && breakout && history.length >= 120 && fast > medium && medium > slow
    && returnBps(history, 120) > 100 && longReturn > 60 && mediumReturn > 30
    && shortReturn > 10 && flow > 0 && vol5 < Math.max(15, vol30 * 2);
  const oversold = zScore < -1.5 && band.edgeBps > MIN_EDGE_BPS;
  const reversal = shortReturn > -5;
  const meanReversionSignal = oversold && reversal;
  if (!trendSignal && !meanReversionSignal) return [];

  const exposure = drawdown >= 0.08 ? 0.08 : drawdown >= 0.05 ? 0.20 : drawdown >= 0.02 ? 0.35 : 0.55;
  const target = BigInt(Math.floor(equity * Math.min(exposure, maximumWeight / 10000)));
  // Reserve pool depths are micro-USDC, independently of the account quote scale.
  const depth = 1 / bar.c_depth.reduce((inverse, raw) => inverse + 1 / Number(raw), 0);
  if (!(depth > 0) || !Number.isFinite(depth)) return [];
  const quoteFactor = 10 ** (quoteScale - 6);
  const impactRoom = BigInt(Math.floor(depth * quoteFactor * 0.0004));
  let notional = target < cash ? target : cash;
  if (impactRoom < notional) notional = impactRoom;
  if (notional < minimumNotional) return [];
  const impactBps = Number(notional) / (depth * quoteFactor) * 10_000;
  const roundTripCost = 2 * (feeBps + slippageBps + impactBps);
  const expectedMove = meanReversionSignal ? band.edgeBps : Math.min(momentumMean, Math.max(mediumReturn, longReturn * 0.5));
  if (expectedMove < roundTripCost + 4) return [];
  pendingKind = meanReversionSignal ? 'reversion' : 'trend';
  return [{ side: 'buy', client_id: `b${batch.seq}`, symbol: bar.symbol, notional_quote_units: notional.toString(), max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

function initialize(hello: Hello): void {
  if (hello.protocol !== 'agent-fun/bars-replay/v1') throw new Error('unsupported protocol');
  const asset = hello.symbols.find((item) => item.symbol === 'CBBTC');
  if (asset === undefined) throw new Error('CBBTC missing from universe');
  quoteScale = hello.capital.quote_scale;
  priceScale = asset.price_scale;
  quantityScale = asset.qty_scale;
  peakEquity = Number(hello.capital.quote_units);
  feeBps = hello.fees.fee_bps;
  slippageBps = hello.fees.slippage_bps;
  warmupBars = hello.warmup_bars ?? 0;
  minimumNotional = BigInt(hello.fees.min_notional_quote_units);
  maximumWeight = hello.caps.max_weight_bps;
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let initialized = false;
let expectedSequence = 0;
let finished = false;
for await (const line of input) {
  if (line.length === 0) continue;
  if (Buffer.byteLength(line, 'utf8') > 1_048_576) throw new Error('input line exceeds protocol limit');
  const message = JSON.parse(line) as { type: string; seq: number; bars?: Bar[]; account?: Batch['account'] };
  if (message.type === 'hello') {
    if (initialized) throw new Error('duplicate hello');
    initialize(message as unknown as Hello);
    initialized = true;
    continue;
  }
  if (message.type === 'batch') {
    if (!initialized || message.seq !== expectedSequence++) throw new Error('invalid batch sequence');
    const batch = message as Batch;
    const reply = { type: 'reply', seq: batch.seq, orders: chooseOrder(batch) };
    if (!process.stdout.write(`${JSON.stringify(reply)}\n`)) {
      await new Promise<void>((resolve) => process.stdout.once('drain', resolve));
    }
    continue;
  }
  if (message.type === 'done') {
    if (!initialized || message.seq !== expectedSequence) throw new Error('invalid done sequence');
    finished = true;
    input.close();
    process.stdin.destroy();
    break;
  }
  throw new Error(`unsupported protocol message: ${message.type}`);
}
if (!finished) throw new Error('input ended before done');
