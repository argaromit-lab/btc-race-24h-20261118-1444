# cbBTC aggressive micro-scalp experiment

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/argaromit-lab/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/argaromit-lab/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

**Failed trading experiment: this branch loses money on the official dev window and must not be presented as a qualifying entry.** It is retained for review on `aggressive-micro-experiment`; the repository's default `main` branch and previously accepted submission are preserved.

This deterministic, long-only paper bot tests EMA-3/EMA-8 micro-momentum, short-range breakouts, and fast dip recovery for `@argaromit`. The committed configuration produces 310 filled orders, but its official dev net PnL is **-156.479683 USDC**, not the requested +100 USDC.

The root `main.ts` runs directly on Node 22.18+ with no installation or dependencies. It reads the official `agent-fun/bars-replay/v1` JSONL protocol from standard input and writes one `reply` per `batch`. It never reads the network, environment, wall clock, or filesystem. Its only import is Node's standard `readline` module.

```sh
node main.ts
```

## Strategy

- Track EMA(3), EMA(8), EMA(21), one- and three-minute returns, a three-bar high, and a 15-bar ATR on bounded 64-bar history. Momentum entries use a fast/slow cross, micro breakout, or persistent positive push; the second sleeve tests a dip below EMA(8) followed by a recovery indication.
- The official pool-state bars have `v: null`. A range-to-ATR activity ratio is therefore used as an explicitly identified proxy, not fabricated trade volume. The committed activity threshold is 0.8.
- Allocate a nominal 90% of available cash, capped by the account weight limit and estimated 6 bps impact at the last known depth. Actual entry averages 436.77 USDC, peaks at 611.66 USDC, and maximum marked exposure is 66.07%. Thus the nominal 90% setting did not produce 85–95% actual exposure on this tape.
- Use a range/displacement opportunity-budget heuristic and require it to exceed modeled fees, slippage, estimated round-trip impact, and a 2 bps buffer. The empirical result shows this heuristic does not establish a profitable edge.
- The tested family uses one to five completed holding bars. The committed profile exits after one completed bar, or on weakness, a 35 bps position-cost loss, an ATR trailing stop, or a net-profit target that also allows for estimated exit friction. It sends one order per bar and never fabricates trade count with dust orders or same-bar round trips.
- Reduce the cash allocation to 25% at 14% drawdown as an early brake; the requested 18% hard reduction also forces liquidation of a held position. Reduced mode persists until equity recovers its prior peak. A separate 22% emergency halt remains latched. These triggers execute at later opens and cannot guarantee that drawdown never overshoots 18% or 25%.

Increasing turnover and nominal allocation did not create an edge. The complete result, failed variants, and qualification decision are documented in `AGGRESSIVE_RESULTS.md`. The earlier conservative results remain in `VALIDATION.md` as a historical reference for commit `071720f`.

## Official protocol and execution costs

Input is `hello`, then minute `batch` messages, then `done`. Bars use `o`, `h`, `l`, `c`, `v`, `o_depth`, `c_depth`, and `t`, not long-form OHLC field names. Prices, quantities, and quote amounts are integer decimal strings at the scales in `hello`; all order amounts and position values use BigInt.

`buy` specifies `notional_quote_units`, including the fee; `sell` specifies `qty`. Both include `symbol`, a unique `client_id`, and `max_slippage_bps`. Execution uses the next minute open, a 4 bps fee, 2 bps slippage, and constant-product impact. For one fresh pool of quote depth D and post-fee buy spend a, the buy price factor is `1 + a / D`; a sale worth a at the reference price receives the open divided by that factor. Current close depth is only an estimate of the next open depth. Remaining positions are flattened by the evaluator at the last close with all costs.

## Reproduce the development checks

Download the official kit into the ignored `btc-race-24h-20261118-1444-kit/` directory. Neither its data nor its CLI is shipped as bot code.

```sh
node btc-race-24h-20261118-1444-kit/cli/makefun.mjs grade-local --kit btc-race-24h-20261118-1444-kit --bot . --driver process --worktree --save local-grade-aggressive --json
node verify-aggressive.mjs --save
```

Use `--driver docker` when Docker is available to run the official isolated sandbox. This experiment was verified with the process driver on Node 22.23.5. The kit identifies its server harness as Node 26.13.1, so a local process score's complete envelope is not claimed to be server-identical.

`verify-aggressive.mjs` uses the earlier independent integer replay helper to check exact parity with the official orders and PnL, repeat determinism, four future-suffix perturbations, a ten-day timestamp shift, native stdout parity, input rejection for future-dated bars, and the 18% sizing/recovery boundary. It also tests six restarted four-hour slices and adaptive doubled fees. The runtime imports neither verifier. The standalone `verify.mjs` command remains the conservative branch's audit entry point; it is not the test command for this experiment.

Raw aggressive reports are under ignored `local-grade-aggressive/` and `audit/aggressive-validation.json`. Source inspection and trading qualification are distinct: `makefun check` can pass the transcript and repository checks while this bot still fails the mandatory positive-PnL dev gate. The recorded result fails that trading gate.

## Identity and publication

Repository owner: `argaromit-lab`. Make.fun account: `@argaromit`. Ownership claim: `.makefun/owner.json`, naming the requested linked payout wallet. No API keys, keypair material, or credentials are included. Local transcript bundles and redacted instruction context stay under ignored `audit/`, separately from the public repository.

MIT licensed. The previously accepted entry pins commit `7d59a1fd9fa9dd5234c9cdc387f6e255567d5e54`. This losing experiment is published on its separate review branch and is not submitted to replace that accepted entry.
