# cbBTC cost-aware regime trader

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/argaromit-lab/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/argaromit-lab/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A deterministic, long-only paper-trading bot for make.fun's `btc-race-24h-20261118-1444` bounty, built for `@argaromit`.

The root `main.ts` runs directly on Node 22.18+ with no installation or dependencies. It reads the official `agent-fun/bars-replay/v1` JSONL protocol from standard input and writes one `reply` per `batch`. It never reads the network, environment, wall clock, or filesystem. Its only import is Node's standard `readline` module.

```sh
node main.ts
```

## Strategy

- Track EMA(5, 15, 30, 60, 120), trailing returns, ATR, realized volatility, and a price-deviation z-score on bounded rolling history. Official pool-state bars have `v: null`; the pressure feature uses range-weighted price returns in that case and does not pretend to observe trade volume or order-book flow.
- Mean reversion: a price at least 1.5 rolling standard deviations below its 30-minute mean, more than 25 bps below that mean, and a five-minute decline that has stabilized above -5 bps. The distance back to the mean must also exceed estimated round-trip costs by at least 4 bps. This distance is a trading hypothesis, not a calibrated return probability.
- Momentum breakout: retain the accepted strategy's aligned EMAs, a 30-bar high breakout, positive 5/15/60/120-minute returns, positive pressure, and a short-term volatility cap. At least five non-overlapping shadow setups must have completed their 15-minute outcomes, with an average move above 25 bps. Each observation enters the estimate only after its next open and complete holding interval have arrived. A more active ungated continuation variant was tested and rejected after historical checks weakened its apparent dev advantage.
- At most one position and one order per bar, with no averaging down or pyramiding. The nominal entry allocation is 55% of marked equity, capped by the account limit and an estimated 4 bps impact budget against the latest close depth. Actual orders on the dev tape average 319.86 USDC and peak at 351.67 USDC. A 65% allocation generally conflicts with a 4 bps impact cap at this pool's observed depth. Splitting one reply does not save constant-product impact; each fill still happens at the unknown next minute open.
- Take half off at +30 bps for reversion or +75 bps for momentum; reversion exits the remainder at +60 bps. Apply an ATR-dependent 80–120 bps trailing distance, a 0.8% position-cost stop, and time limits of 40/120 minutes. A rejected partial order does not mark the profit stage as completed; a full-exit decision remains latched until the position is empty.
- Reduce nominal entry exposure from 55% to 35%, 20%, and 8% as account drawdown reaches 2%, 5%, and 8%. Stop new entries at 8.5%; latch account liquidation and stop trading at 9.5%. Emergency exits have an unrestricted price limit; ordinary orders allow 100 bps of adverse movement including slippage and impact.

Stops execute at a later open and liquidity can change. A 9.5% trigger is not a guaranteed loss ceiling: a constructed 50% gap after entry produces a 17.61% drawdown before liquidation. The 4 bps entry-impact estimate uses the most recent close depth; it cannot bound a different next open depth. A window with no qualifying signal can finish with no trade and would miss the race's minimum-trade bar. There is no forced, negative-edge trade just to meet a trade-count target.

## Official protocol and execution costs

Input is `hello`, then minute `batch` messages, then `done`. Bars use `o`, `h`, `l`, `c`, `v`, `o_depth`, `c_depth`, and `t`, not long-form OHLC field names. Prices, quantities, and quote amounts are integer decimal strings at the scales in `hello`; all order amounts and position values use BigInt.

`buy` specifies `notional_quote_units`, including the fee; `sell` specifies `qty`. Both include `symbol`, a unique `client_id`, and `max_slippage_bps`. Execution uses the next minute open, a 4 bps fee, 2 bps slippage, and constant-product impact. For one fresh pool of quote depth D and post-fee buy spend a, the buy price factor is `1 + a / D`; a sale worth a at the reference price receives the open divided by that factor. Current close depth is only an estimate of the next open depth. Remaining positions are flattened by the evaluator at the last close with all costs.

## Reproduce the development checks

Download the official kit into the ignored `btc-race-24h-20261118-1444-kit/` directory. Neither its data nor its CLI is shipped as bot code.

```sh
node btc-race-24h-20261118-1444-kit/cli/makefun.mjs grade-local --kit btc-race-24h-20261118-1444-kit --bot . --driver process --worktree --save local-grade-conservative --json
node verify.mjs --save
```

Use `--driver docker` when Docker is available to run the official isolated sandbox. This optimization was verified with the process driver on Node 22.23.5; the accepted baseline was also verified on Node 24.15.0. The kit identifies its server harness as Node 26.13.1. Thus local score hashes are not claimed to be server-identical.

`verify.mjs` is a development-only, independent single-pool replay. It checks its integer fill accounting against a saved official action log, byte-identical decisions on repeat runs, unchanged earlier orders when future bars change, invariance to shifting every input timestamp by ten days, and exact stdout from the actual `main.ts` process. It also runs six chronological four-hour slices with up to 120 warmup bars and deterministic synthetic bull/bear/range/crash/liquidity scenarios. The runtime never imports it.

See `VALIDATION.md` for measured diagnostics and their interpretation. `verify.mjs --save` writes the ignored raw report `validation.json`; current official reports and action logs are under `local-grade-conservative/`. The accepted baseline's reports remain under `local-grade-final/`, and the rejected more active variant's under `local-grade-v2/`.

This candidate raises full-window net PnL from 1.566448 to 2.917076 USDC and reduces drawdown from 0.159765% to 0.075724%. It has 9 fills, and average equity exposure falls from 2.5178764% to 1.6134004%. Larger entries therefore do not amount to improved time-weighted capital utilization. The requested +10–25 USDC, 60–140 fills, and higher average utilization remain unmet. Four earlier, non-overlapping official dev windows were also tested: the candidate lost money on three, totaling -8.597987 USDC versus the baseline's -10.842121 USDC. Neither this comparison nor dev profitability proves profitable live performance or freedom from overfitting.

## Identity and publication

Repository owner: `argaromit-lab`. Make.fun account: `@argaromit`. Ownership claim: `.makefun/owner.json`, naming the requested linked payout wallet. No API keys, keypair material, or credentials are included. Local transcript bundles and redacted instruction context stay under ignored `audit/`, separately from the public repository.

MIT licensed. The previously accepted entry pins commit `7d59a1fd9fa9dd5234c9cdc387f6e255567d5e54`. A later optimization commit requires a separate, explicitly authorized submission; pushing this candidate does not replace that accepted entry.
