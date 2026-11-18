// Development-only audit. The deployed bot never imports this file.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';

const root = new URL('./', import.meta.url);
const source = readFileSync(new URL('main.ts', root), 'utf8');
assert(!/Date\s*[.(]|performance\s*\.|process\.env|Math\.random|node:(fs|http|https|net|dns|child_process)|\bfetch\s*\(/.test(source), 'runtime uses a forbidden source of variation');
assert.deepEqual([...source.matchAll(/^import .* from ['"]([^'"]+)/gm)].map((match) => match[1]), ['node:readline']);
const strategySource = source.slice(source.indexOf('type Bar ='), source.indexOf('const input = createInterface'));
const compiled = new vm.Script(stripTypeScriptTypes(`${strategySource}\n({ initialize, chooseOrder });`));
const referenceFlag = process.argv.indexOf('--reference');
const referenceDirectory = referenceFlag >= 0 ? process.argv[referenceFlag + 1] : 'local-grade-conservative';
assert(referenceDirectory, '--reference requires a saved official grade directory');
const baseLog = JSON.parse(readFileSync(new URL(`${referenceDirectory}/action-log.json`, root), 'utf8'));
const helloTemplate = baseLog.hello;
const originalBars = gunzipSync(readFileSync(new URL('btc-race-24h-20261118-1444-kit/dataset/bars/CBBTC.ndjson.gz', root)))
  .toString('utf8').trim().split('\n').map((line) => {
    const { t, o, h, l, c, v, o_depth, c_depth } = JSON.parse(line);
    return { symbol: 'CBBTC', t, o, h, l, c, v, o_depth, c_depth };
  });

function strategy(hello) {
  const math = Object.create(Math);
  math.random = () => { throw new Error('randomness is forbidden'); };
  const context = vm.createContext({ Math: math, Date: undefined, performance: undefined, process: undefined, fetch: undefined });
  const bot = compiled.runInContext(context);
  bot.initialize(hello);
  return bot;
}

function simulate(bars, { warmup = 0, feeMultiplier = 1, capture = false, overrideReplies = null } = {}) {
  const hello = structuredClone(helloTemplate);
  hello.first_close_ms = bars[0].t;
  hello.fees.fee_bps *= feeMultiplier;
  if (warmup) hello.warmup_bars = warmup;
  const bot = strategy(hello);
  let cash = BigInt(hello.capital.quote_units);
  let qty = 0n;
  let cost = 0n;
  let peak = cash;
  let maxDrawdown = 0;
  let trades = 0;
  let rejected = 0;
  let fees = 0n;
  let exposureSum = 0;
  let scoredBars = 0;
  let heldBars = 0;
  let maximumExposure = 0;
  let maximumBuyImpact = 0;
  const entryAmounts = [];
  let pending = [];
  let latest = null;
  const seen = new Set();
  const replies = [];
  const inputs = capture ? [hello] : null;
  const value = (q, price) => q * BigInt(price) * 1_000_000n / 10_000_000_000_000n;
  const account = () => ({ cash_quote_units: cash.toString(), equity_quote_units: (cash + (latest ? value(qty, latest.c) : 0n)).toString(), positions: qty ? [{ symbol: 'CBBTC', qty: qty.toString(), cost_quote_units: cost.toString() }] : [] });
  const mark = () => {
    const equity = BigInt(account().equity_quote_units);
    if (equity > peak) peak = equity;
    maxDrawdown = Math.max(maxDrawdown, Number(peak - equity) / Number(peak));
  };
  function resolve(order, bar, reference, flatten = false) {
    if (!bar) return { ...order, status: 'rejected', reason: 'no_bar' };
    const open = BigInt(flatten ? bar.c : bar.o);
    const depth = BigInt((flatten ? bar.c_depth : bar.o_depth)[0]);
    const fee = BigInt(hello.fees.fee_bps);
    const slip = BigInt(hello.fees.slippage_bps);
    const bps = 10_000n;
    let price, amount, paid;
    if (order.side === 'buy') {
      amount = BigInt(order.notional_quote_units);
      const spend = amount * (bps - fee) / bps;
      price = open * (bps + slip) * (depth + spend) / (bps * depth);
      const units = spend * 10_000_000_000_000n / (price * 1_000_000n);
      if (price * bps > BigInt(reference) * (bps + BigInt(order.max_slippage_bps))) return { ...order, status: 'rejected', reason: 'max_slippage' };
      assert(amount <= cash && amount >= 1_000_000n);
      assert.equal(qty, 0n, 'strategy must not pyramid');
      cash -= amount;
      qty += units;
      cost += amount;
      paid = amount - spend;
      entryAmounts.push(Number(amount) / 1e6);
      maximumBuyImpact = Math.max(maximumBuyImpact, Number(spend) / Number(depth) * 10000);
    } else {
      amount = BigInt(order.qty);
      const worth = value(amount, open);
      price = open * (bps - slip) * depth / (bps * (depth + worth));
      if (price < 1n) price = 1n;
      if (!flatten && price * bps < BigInt(reference) * (bps - BigInt(order.max_slippage_bps))) return { ...order, status: 'rejected', reason: 'max_slippage' };
      assert(amount <= qty && amount > 0n);
      const gross = value(amount, price);
      assert(flatten || amount === qty || value(amount, reference) >= 1_000_000n);
      const proceeds = gross * (bps - fee) / bps;
      cash += proceeds;
      cost -= cost * amount / qty;
      qty -= amount;
      paid = gross - proceeds;
    }
    fees += paid;
    if (!flatten) trades++;
    return { client_id: order.client_id, side: order.side, symbol: order.symbol, status: 'filled', reason: null, price: price.toString() };
  }
  for (let seq = 0; seq < bars.length; seq++) {
    const bar = bars[seq];
    const fills = [];
    for (const action of pending) {
      const fill = resolve(action, bar, latest.c);
      if (fill.status === 'rejected') rejected++;
      fills.push(fill);
    }
    pending = [];
    if (bar) latest = bar;
    if (seq >= warmup) {
      mark();
      const equity = BigInt(account().equity_quote_units);
      const positionValue = latest ? value(qty, latest.c) : 0n;
      const exposure = equity > 0n ? Number(positionValue) / Number(equity) : 0;
      exposureSum += exposure;
      scoredBars++;
      if (qty > 0n) heldBars++;
      maximumExposure = Math.max(maximumExposure, exposure);
    }
    const batch = { type: 'batch', seq, t: bars[0].t + seq * 60_000, bars: bar ? [bar] : [], fills, account: account() };
    if (inputs) inputs.push(structuredClone(batch));
    const orders = overrideReplies ? overrideReplies[seq].orders : JSON.parse(JSON.stringify(bot.chooseOrder(batch)));
    assert(orders.length <= 1, 'independent audit supports one order per bar');
    for (const order of orders) {
      assert.match(order.client_id, /^[A-Za-z0-9-][A-Za-z0-9_-]{0,63}$/);
      assert(!seen.has(order.client_id), 'duplicate client_id');
      seen.add(order.client_id);
      assert.equal(order.symbol, 'CBBTC');
      assert(Number.isInteger(order.max_slippage_bps) && order.max_slippage_bps >= 0 && order.max_slippage_bps <= 10000);
      assert(seq >= warmup, 'order during warmup');
      if (order.side === 'buy') assert(BigInt(order.notional_quote_units) <= cash);
      if (seq === bars.length - 1) rejected++;
      else pending.push(order);
    }
    replies.push({ type: 'reply', seq, orders });
    assert(cash >= 0n && qty >= 0n);
  }
  if (qty) resolve({ side: 'sell', qty: qty.toString() }, latest, latest.c, true);
  mark();
  const done = { type: 'done', seq: bars.length, reason: 'end_of_data', account: account() };
  if (inputs) inputs.push(done);
  const wire = replies.map((reply) => JSON.stringify(reply)).join('\n') + '\n';
  const utilization = { averageExposurePct: exposureSum / Math.max(1, scoredBars) * 100, maximumExposurePct: maximumExposure * 100, heldBars, averageEntryUsdc: entryAmounts.length ? entryAmounts.reduce((sum, amount) => sum + amount, 0) / entryAmounts.length : 0, maximumEntryUsdc: entryAmounts.length ? Math.max(...entryAmounts) : 0, maximumFilledBuyImpactBps: maximumBuyImpact };
  return { pnl: Number(cash - 1_000_000_000n) / 1e6, returnPct: Number(cash - 1_000_000_000n) / 1e7, maxDrawdownPct: maxDrawdown * 100, trades, rejected, fees: Number(fees) / 1e6, utilization, hash: createHash('sha256').update(wire).digest('hex'), replies, inputs, wire };
}

// Reproduce an earlier official action log first, independently of today's strategy.
const reference = JSON.parse(readFileSync(new URL(`${referenceDirectory}/result.json`, root), 'utf8')).performance.metrics;
const parity = simulate(originalBars, { overrideReplies: baseLog.replies });
assert.equal(Math.round(parity.pnl * 1e6).toString(), reference.net_pnl_quote_units);
assert.equal(parity.trades, reference.trades);
assert.equal(parity.rejected, reference.rejected);

const start = performance.now();
const full = simulate(originalBars, { capture: true });
assert.equal(Math.round(full.pnl * 1e6).toString(), reference.net_pnl_quote_units, 'independent replay differs from official PnL');
assert.equal(full.trades, reference.trades);
assert.deepEqual(full.replies, baseLog.replies, 'independent decisions differ from official action log');
const second = simulate(originalBars);
assert.equal(full.wire, second.wire, 'orders differ between runs');
for (const cut of [64, 240, 480, 1000]) {
  const mutated = structuredClone(originalBars);
  for (let i = cut; i < mutated.length; i++) for (const field of ['o', 'h', 'l', 'c']) mutated[i][field] = (BigInt(mutated[i][field]) * 3n).toString();
  assert.deepEqual(full.replies.slice(0, cut), simulate(mutated).replies.slice(0, cut), `future suffix changed orders before ${cut}`);
}
const shifted = originalBars.map((bar) => ({ ...bar, t: bar.t + 86_400_000 * 10 }));
assert.equal(full.wire, simulate(shifted).wire, 'absolute timestamp dependence');
const folds = [];
for (let from = 0; from < originalBars.length; from += 240) {
  const begin = Math.max(0, from - 120);
  const warmup = from - begin;
  const result = simulate(originalBars.slice(begin, from + 240), { warmup });
  folds.push({ scoredBars: [from, from + 239], warmup, ...compact(result) });
}
const halfFees = simulate(originalBars, { feeMultiplier: 2 });
const shallow = originalBars.map((bar) => ({ ...bar, o_depth: bar.o_depth.map((d) => (BigInt(d) / 10n).toString()), c_depth: bar.c_depth.map((d) => (BigInt(d) / 10n).toString()) }));
const stress = [{ name: 'one-tenth-liquidity', ...compact(simulate(shallow)) }];
const missingBars = structuredClone(originalBars);
for (const index of [60, 61, 62, 63, 64]) missingBars[index] = null;
stress.push({ name: 'five-missing-minutes', ...compact(simulate(missingBars)) });
function synthetic(kind) {
  let last = 65000;
  return Array.from({ length: 1440 }, (_, i) => {
    const change = kind === 'bull' ? 0.00032 + 0.00012 * Math.sin(i / 5) : kind === 'bear' ? -0.00032 + 0.00012 * Math.sin(i / 5) : kind === 'sideways' ? 0.0008 * Math.sin(i / 9) : (i % 80 === 40 ? -0.06 : 0.00015 * Math.sin(i));
    const open = last;
    const close = open * (1 + change);
    last = close;
    const raw = (price) => Math.round(price * 1e5).toString();
    return { symbol: 'CBBTC', t: originalBars[0].t + i * 60000, o: raw(open), c: raw(close), h: raw(Math.max(open, close) * 1.0001), l: raw(Math.min(open, close) * 0.9999), v: null, o_depth: ['1000000000000'], c_depth: ['1000000000000'] };
  });
}
for (const name of ['bull', 'bear', 'sideways', 'crash']) stress.push({ name, ...compact(simulate(synthetic(name))) });
const gap = structuredClone(originalBars);
const firstEntry = full.replies.find((reply) => reply.orders.some((order) => order.side === 'buy')).seq;
for (let i = firstEntry + 2; i < gap.length; i++) for (const field of ['o', 'h', 'l', 'c']) gap[i][field] = (BigInt(gap[i][field]) / 2n).toString();
stress.push({name: '50-percent-gap-after-entry', ...compact(simulate(gap))});
assert(stress.find((run) => run.name === 'bull').trades > 0, 'momentum sleeve never activated on the bull scenario');
assert(full.replies.some((reply) => reply.orders.some((order) => order.client_id.startsWith('p'))), 'partial take profit was not exercised');
// Isolate the account circuit from position stops: this marked position is at
// cost, so a 9.6% portfolio drawdown is its only immediate exit condition.
const cashAccount = (amount = '1000000000') => ({ cash_quote_units: amount, equity_quote_units: amount, positions: [] });
const unitBatch = (seq, account = cashAccount()) => ({ type: 'batch', seq, t: originalBars[seq].t, bars: [originalBars[seq]], fills: [], account });
const circuitBot = strategy(helloTemplate);
const controlBot = strategy(helloTemplate);
let controlBuys = 0;
const circuitAt = firstEntry + 1;
for (let seq = 0; seq < 240; seq++) {
  const normal = controlBot.chooseOrder(unitBatch(seq));
  if (seq > circuitAt) controlBuys += normal.filter((order) => order.side === 'buy').length;
  if (seq === circuitAt) {
    const quantity = 389000n;
    const mark = quantity * BigInt(originalBars[seq].c) * 1_000_000n / 10_000_000_000_000n;
    const account = { cash_quote_units: (904_000_000n - mark).toString(), equity_quote_units: '904000000', positions: [{symbol: 'CBBTC', qty: quantity.toString(), cost_quote_units: mark.toString()}] };
    const emergency = circuitBot.chooseOrder(unitBatch(seq, account));
    assert.equal(emergency[0]?.side, 'sell', 'equity circuit did not liquidate');
    assert.equal(emergency[0]?.max_slippage_bps, 10000);
  } else {
    const orders = circuitBot.chooseOrder(unitBatch(seq));
    if (seq > circuitAt) assert.equal(orders.length, 0, 'equity circuit did not remain latched after account recovery');
  }
}
assert(controlBuys > 0, 'circuit latch test had no eligible post-circuit opportunities');
for (const [amount, limit] of [['920000000', 73_600_000n], ['915000000', 0n]]) {
  const bot = strategy(helloTemplate);
  for (let seq = 0; seq < firstEntry; seq++) bot.chooseOrder(unitBatch(seq));
  const orders = bot.chooseOrder(unitBatch(firstEntry, cashAccount(amount)));
  if (limit === 0n) assert.equal(orders.length, 0, '8.5% drawdown entry halt failed');
  else {
    assert.equal(orders[0]?.side, 'buy', '8% drawdown sizing test had no eligible opportunity');
    assert(BigInt(orders[0].notional_quote_units) <= limit, '8% drawdown did not reduce the allocation to 8%');
  }
}
const runtimeStart = performance.now();
const runtime = spawnSync(process.execPath, ['main.ts'], { cwd: new URL('.', root), input: full.inputs.map((message) => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 10_000_000, timeout: 30_000 });
const runtimeMs = Math.round(performance.now() - runtimeStart);
assert.equal(runtime.status, 0, runtime.stderr);
assert.equal(runtime.stdout, full.wire, 'CLI differs from audited decisions');
const report = { schema: 'cb-btc-local-audit/v2', benchmarkRuntime: process.version, officialReferenceParity: true, deterministic: true, prefixCausal: true, timestampShiftInvariant: true, runtimeMatches: true, circuitBreakerVerified: true, dev: compact(full), utilization: full.utilization, twoFeeAdaptiveRun: compact(halfFees), folds, stress, runtimeMs, elapsedMs: Math.round(performance.now() - start), interpretation: 'Chronological diagnostics of an already inspected development window, not independent out-of-sample evidence. Synthetic scenarios are implementation checks, not forecasts.' };
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--save')) writeFileSync(new URL('validation.json', root), JSON.stringify(report, null, 2) + '\n');

function compact(run) {
  return { pnl: run.pnl, returnPct: run.returnPct, maxDrawdownPct: run.maxDrawdownPct, trades: run.trades, rejected: run.rejected, fees: run.fees, replyHash: run.hash };
}
