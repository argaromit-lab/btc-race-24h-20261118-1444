# cbBTC cost-aware regime trader

A deterministic, long-only paper-trading bot for make.fun's `btc-race-24h-20261118-1444` bounty, built for `@argaromit`.

The root `main.ts` runs directly on Node 22.18+ with no installation or dependencies. It reads the official `agent-fun/bars-replay/v1` JSONL protocol from standard input and writes one `reply` per `batch`. It never reads the network, environment, wall clock, or filesystem. Its only import is Node's standard `readline` module.

```sh
node main.ts
```

## Strategy

- Track EMA(5, 15, 30, 60, 120), trailing returns, ATR, realized volatility, and a price-deviation z-score on bounded rolling history. Official pool-state bars have `v: null`; the pressure feature uses range-weighted price returns in that case and does not pretend to observe trade volume or order-book flow.
- Mean reversion: a price at least 1.5 rolling standard deviations below its 30-minute mean, more than 25 bps below that mean, and a five-minute decline that has stabilized above -10 bps. The distance back to the mean must also exceed estimated round-trip costs by at least 8 bps. This distance is a trading hypothesis, not a calibrated return probability.
- Momentum: require aligned EMAs, a 30-bar high breakout, positive 5/15/60/120-minute returns, positive pressure, and no excessive short-term volatility. Before enabling it, at least five non-overlapping shadow setups must have completed their future 15-minute outcomes, with an average move above 25 bps. An observation enters this estimate only after its next open and complete holding interval have arrived; future bars are never available at decision time.
- At most one position and one order per bar. Spend at most 25% of marked equity, limited further by a 5 bps impact budget against the latest close depth. Splitting one reply does not save constant-product impact, so the bot sends a single order. Each fill still happens at the unknown next minute open.
- Take half off at +25 bps for reversion or +75 bps for momentum; reversion exits the remainder at +45 bps. Apply an ATR-dependent trailing stop, a 1% position-cost stop, and time limits of 40/120 minutes. A rejected partial order does not mark the profit stage as completed; a full-exit decision remains latched until the position is empty.
- Reduce entry exposure from 25% to 15% and 8% as account drawdown reaches 3% and 6%. Stop new entries at 8.5%; latch account liquidation and stop trading at 10.5%. Emergency exits have an unrestricted price limit; ordinary orders allow 100 bps of adverse movement including slippage and impact.

Stops execute at a later open and liquidity can change. These controls do not guarantee a maximum realized drawdown under every possible price gap. A window with no qualifying signal can finish with no trade and would miss the race's minimum-trade bar. There is no forced, negative-edge trade just to meet that bar.

## Official protocol and execution costs

Input is `hello`, then minute `batch` messages, then `done`. Bars use `o`, `h`, `l`, `c`, `v`, `o_depth`, `c_depth`, and `t`, not long-form OHLC field names. Prices, quantities, and quote amounts are integer decimal strings at the scales in `hello`; all order amounts and position values use BigInt.

`buy` specifies `notional_quote_units`, including the fee; `sell` specifies `qty`. Both include `symbol`, a unique `client_id`, and `max_slippage_bps`. Execution uses the next minute open, a 4 bps fee, 2 bps slippage, and constant-product impact. For one fresh pool of quote depth D and post-fee buy spend a, the buy price factor is `1 + a / D`; a sale worth a at the reference price receives the open divided by that factor. Current close depth is only an estimate of the next open depth. Remaining positions are flattened by the evaluator at the last close with all costs.

## Reproduce the development checks

Download the official kit into the ignored `btc-race-24h-20261118-1444-kit/` directory. Neither its data nor its CLI is shipped as bot code.

```sh
node btc-race-24h-20261118-1444-kit/cli/makefun.mjs grade-local --kit btc-race-24h-20261118-1444-kit --bot . --driver process --worktree --save local-grade-final --json
node verify.mjs --save
```

Use `--driver docker` when Docker is available to run the official isolated sandbox. Local development used the process driver on Node 24.15.0 and Node 22.23.5, both with identical orders and financial metrics. The kit identifies its server harness as Node 26.13.1. Thus local score hashes are not claimed to be server-identical.

`verify.mjs` is a development-only, independent single-pool replay. It checks its integer fill accounting against a saved official action log, byte-identical decisions on repeat runs, unchanged earlier orders when future bars change, invariance to shifting every input timestamp by ten days, and exact stdout from the actual `main.ts` process. It also runs six chronological four-hour slices with up to 120 warmup bars and deterministic synthetic bull/bear/range/crash/liquidity scenarios. The runtime never imports it.

See `VALIDATION.md` for measured diagnostics and their interpretation. `verify.mjs --save` also writes the ignored raw report `validation.json`; saved official reports and action logs are under ignored `local-grade-final/`. Parameter exploration used the already published dev tape, so the slices are diagnostics, not independent out-of-sample evidence. One day of development data cannot establish live profitability or remove overfitting risk.

## Identity and publication

Repository owner: `argaromit-lab`. Make.fun account: `@argaromit`. Ownership claim: `.makefun/owner.json`, naming the requested linked payout wallet. No API keys, keypair material, or credentials are included. Local transcript bundles and redacted instruction context stay under ignored `audit/`, separately from the public repository.

MIT licensed. Development stops at the pre-submission check; `makefun submit` requires a later user instruction.
