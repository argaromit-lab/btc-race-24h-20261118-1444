// Development-only verification of the aggressive experiment, never imported by the bot.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';

const root = new URL('./', import.meta.url);
const source = readFileSync(new URL('main.ts', root), 'utf8');
const common = readFileSync(new URL('verify.mjs', root), 'utf8');
const begin = common.indexOf('const source =');
const end = common.indexOf('// Reproduce an earlier');
assert(begin >= 0 && end > begin, 'Shared replay helper markers changed');
const engineSource = common.slice(begin, end).replace("const source = readFileSync(new URL('main.ts', root), 'utf8');", '');
const factory = new Function('source', 'root', 'assert', 'readFileSync', 'stripTypeScriptTypes', 'vm', 'gunzipSync', 'createHash', `${engineSource}\nreturn {simulate, strategy, originalBars, helloTemplate};`);
const {simulate, strategy, originalBars: bars, helloTemplate} = factory(source, root, assert, readFileSync, stripTypeScriptTypes, vm, gunzipSync, createHash);
const referenceLog = JSON.parse(readFileSync(new URL('local-grade-aggressive/action-log.json', root), 'utf8'));
const reference = JSON.parse(readFileSync(new URL('local-grade-aggressive/result.json', root), 'utf8')).performance.metrics;
const full = simulate(bars, {capture: true});
assert.equal(Math.round(full.pnl * 1e6).toString(), reference.net_pnl_quote_units);
assert.equal(full.trades, reference.trades);
assert.deepEqual(full.replies, referenceLog.replies);
assert.equal(full.wire, simulate(bars).wire, 'Nondeterministic order stream');
for (const cut of [64, 240, 480, 1000]) {
  const changed = structuredClone(bars);
  for (let index = cut; index < changed.length; index++) for (const field of ['o','h','l','c']) changed[index][field] = (BigInt(changed[index][field]) * 2n).toString();
  assert.deepEqual(full.replies.slice(0, cut), simulate(changed).replies.slice(0, cut), 'Future suffix changed earlier decisions');
}
assert.equal(full.wire, simulate(bars.map((bar) => ({...bar, t: bar.t + 10 * 86400000}))).wire, 'Absolute timestamp dependency');

const cash = (amount = '1000000000') => ({cash_quote_units: amount, equity_quote_units: amount, positions: []});
const synthetic = [];
let price = 65000;
for (let index = 0; index < 30; index++) {
  const open = price;
  price *= 1.01;
  const units = (n) => Math.round(n * 100000).toString();
  synthetic.push({symbol: 'CBBTC', t: bars[0].t + index * 60000, o: units(open), c: units(price), h: units(price * 1.001), l: units(open * 0.999), v: null, o_depth: ['100000000000000'], c_depth: ['100000000000000']});
}
const batch = (index, account = cash()) => ({type: 'batch', seq: index, t: synthetic[index].t, bars: [synthetic[index]], fills: [], account});
const bot = strategy(helloTemplate);
for (let index = 0; index < 12; index++) bot.chooseOrder(batch(index));
const reduced = bot.chooseOrder(batch(12, cash('820000000')));
assert.equal(reduced[0]?.notional_quote_units, '205000000', '18% drawdown did not cap cash allocation at 25%');
const beforeRecovery = bot.chooseOrder(batch(13, cash('950000000')));
assert.equal(beforeRecovery[0]?.notional_quote_units, '237500000', 'Reduced mode cleared before the prior peak recovered');
const recovered = bot.chooseOrder(batch(14));
assert.equal(recovered[0]?.notional_quote_units, '900000000', '90% allocation did not resume at peak recovery');
assert.equal(bot.chooseOrder(batch(15, cash('770000000'))).length, 0, '22% emergency halt failed');
assert.equal(bot.chooseOrder(batch(16)).length, 0, 'Emergency halt did not remain latched');
for (const [equity, expectedSlippage] of [['821000000', 100], ['820000000', 10000]]) {
  const unit = strategy(helloTemplate);
  for (let index = 0; index < 12; index++) unit.chooseOrder(batch(index));
  const qty = 200000n;
  const value = qty * BigInt(synthetic[12].c) * 1000000n / 10000000000000n;
  const account = {cash_quote_units: (BigInt(equity) - value).toString(), equity_quote_units: equity, positions: [{symbol: 'CBBTC', qty: qty.toString(), cost_quote_units: value.toString()}]};
  const exit = unit.chooseOrder(batch(12, account));
  assert.equal(exit[0]?.side, 'sell');
  assert.equal(exit[0]?.max_slippage_bps, expectedSlippage, 'Hard drawdown exit boundary differs from 18%');
}

const runtime = spawnSync(process.execPath, ['main.ts'], {cwd: root, input: full.inputs.map((message) => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 10000000, timeout: 30000});
assert.equal(runtime.status, 0, runtime.stderr);
assert.equal(runtime.stdout, full.wire);
const malformed = {type: 'batch', seq: 0, t: bars[0].t, bars: [{...bars[0], t: bars[0].t + 60000}], fills: [], account: cash()};
const rejected = spawnSync(process.execPath, ['main.ts'], {cwd: root, input: [helloTemplate, malformed, {type: 'done', seq: 1, reason: 'end_of_data', account: cash()}].map(JSON.stringify).join('\n') + '\n', encoding: 'utf8', timeout: 30000});
assert.notEqual(rejected.status, 0, 'Future-dated input bar should be rejected');

const summary = (run) => ({pnlUsdc: run.pnl, returnPct: run.returnPct, maxDrawdownPct: run.maxDrawdownPct, trades: run.trades, feesUsdc: run.fees, rejected: run.rejected, utilization: run.utilization, replyHash: run.hash});
const folds = [];
for (let from = 0; from < 1440; from += 240) {
  const start = Math.max(0, from - 120);
  folds.push({from, to: from + 239, ...summary(simulate(bars.slice(start, from + 240), {warmup: from - start}))});
}
const report = {schema: 'cb-btc-aggressive-audit/v1', node: process.version, officialOrderParity: true, deterministic: true, prefixCausal: true, timestampShiftInvariant: true, runtimeMatches: true, riskSizingAndRecoveryVerified: true, futureInputRejected: true, devGateProfitable: full.pnl > 0, dev: summary(full), folds, adaptiveDoubleFee: summary(simulate(bars, {feeMultiplier: 2})), interpretation: 'An implementation audit, not a trading qualification. This experiment loses money and fails the mandatory positive-PnL dev gate.'};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--save')) writeFileSync(new URL('audit/aggressive-validation.json', root), JSON.stringify(report, null, 2) + '\n');
