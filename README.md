# Volatility-breakout final fixed test

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/argaromit-lab/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/argaromit-lab/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

**Current test: +0.708340 USDC net PnL, 0.3098174% maximum drawdown, 25 fills. No merge or submit.** The user's final rule requires >10 USDC and at most 15% drawdown; this result is also below the explicit +5 USDC preservation threshold. Default `main` remains `071720f14f9dd6b8875edb9f272eeb1f9408fc35`, and the accepted entry remains pinned to `7d59a1fd9fa9dd5234c9cdc387f6e255567d5e54`.

Branch `volatility-breakout-final` tests one fixed configuration: a 45-minute high breakout more than 28 bps above EMA-60; relative single-bar volume above 1.6 times its preceding 30-bar mean when volume exists, otherwise an explicitly labeled true-range proxy because official volume is null; up to three consecutive planned slices, each no more than 35% of equity and an estimated 1.8 bps of pool depth; a latched 2.5 x ATR-30 trailing stop only after marked profit exceeds 35 bps; a four-hour holding limit; and a 15% account halt. Downside breakouts can close longs; shorts are not permitted. Normal exits are also sliced. Protective stops may act earlier. Future depth and gaps prevent a guaranteed impact/drawdown ceiling.

The official kit ran the final code twice with matching action logs and a reproduced L1 regrade. Fees alone are 1.356533 USDC, return is +0.0708340%, and no order was rejected. No parameter search was run for this last configuration. Raw reports are in ignored `local-grade-volatility-final/`.

```sh
node btc-race-24h-20261118-1444-kit/cli/makefun.mjs grade-local --kit btc-race-24h-20261118-1444-kit --bot . --driver process --worktree --save local-grade-volatility-final --json
```

Action-log digest: `ee2caf07b06c036f6c449dca979f3357fe0b11de76392ab1abe3e5cfd5957b62`.

## Archived parent swing report

The remainder below documents the earlier `high-conviction-swing` parent, not this final fixed configuration. Its source and commands must be read in that parent commit. The protected main and accepted entry are unchanged.

This branch tests a deterministic, long-only EMA-12/36/96 trend and swing bot for make.fun's `btc-race-24h-20261118-1444` bounty, built for `@argaromit`. The complete official dev replay returns **-8.030987 USDC**, with **0.8600817% maximum drawdown** and **20 fills**.

The root `main.ts` runs directly on Node 22.18+ with no installation or dependencies. It reads the official `agent-fun/bars-replay/v1` JSONL protocol from standard input and writes one `reply` per `batch`. It never reads the network, environment, wall clock, or filesystem. Its only import is Node's standard `readline` module.

```sh
node main.ts
```

## Strategy

- Seed and update EMA(12), EMA(36), and EMA(96) causally. Entry requires ordered upward EMAs, positive 15- and 30-minute momentum, a 30-bar high breakout, and an activity filter.
- The trend-move budget is the smaller of recent momentum extrapolation and a 30-minute projection of the EMA-12 slope. It must exceed 35 bps and the estimated round-trip friction plus 4 bps. This is a heuristic, not a calibrated expected return or a guaranteed future move.
- Official bars have null volume. When volume is genuinely available, compare five recent bars with the previous twenty; otherwise use the same comparison of true-range activity and identify it as a proxy.
- Target 90% of marked equity, subject to the account limit. Build across at most three fills on separate minutes, each capped at an estimated 4.5 bps impact. Further additions require that the existing position is non-losing in exact quote units, conviction persists, and no more than eight holding bars have elapsed. Each buy subtracts the position already held from its target room. No same-bar splitting is used.
- Use an initial 35–80 bps position-cost stop, adaptive trailing distance of at least 40 bps, and a 60-minute maximum hold in the selected configuration. Regime-failure exits apply after fifteen holding bars; protective stops can act earlier. Normal exits are staged against the same liquidity budget and remain latched until flat. There is no quick fixed take-profit that automatically cuts a winner after one or two bars.
- Reduce target exposure to 25% at 6% account drawdown and halt at 10%, leaving a buffer below the user's 12% measured-drawdown criterion. An emergency at 11.5% may sell the full remainder. Next-open latency, changing liquidity, forced final flattening, and arbitrary gaps prevent these triggers from being guaranteed loss or impact ceilings.

On the current dev tape, staged building reaches 81.44% maximum marked exposure. Measured normal buy and sell fills remain below 5 bps impact, with a maximum of 4.524189 bps. These measured properties do not imply profitable trading: this candidate loses money and misses the required merge threshold. The protocol does not allow shorts, so declining regimes are avoided rather than traded short.

## Official protocol and execution costs

Input is `hello`, then minute `batch` messages, then `done`. Bars use `o`, `h`, `l`, `c`, `v`, `o_depth`, `c_depth`, and `t`, not long-form OHLC field names. Prices, quantities, and quote amounts are integer decimal strings at the scales in `hello`; all order amounts and position values use BigInt.

`buy` specifies `notional_quote_units`, including the fee; `sell` specifies `qty`. Both include `symbol`, a unique `client_id`, and `max_slippage_bps`. Execution uses the next minute open, a 4 bps fee, 2 bps slippage, and constant-product impact. For one fresh pool of quote depth D and post-fee buy spend a, the buy price factor is `1 + a / D`; a sale worth a at the reference price receives the open divided by that factor. Current close depth is only an estimate of the next open depth. Remaining positions are flattened by the evaluator at the last close with all costs.

## Reproduce the development checks

Download the official kit into the ignored `btc-race-24h-20261118-1444-kit/` directory. Neither its data nor its CLI is shipped as bot code.

```sh
node btc-race-24h-20261118-1444-kit/cli/makefun.mjs grade-local --kit btc-race-24h-20261118-1444-kit --bot . --driver process --worktree --save local-grade-swing --json
node verify-swing.mjs --save
```

Use `--driver docker` when Docker is available to run the official isolated sandbox. The swing experiment used the process driver on Node 22.23.5. The kit identifies its server harness as Node 26.13.1; a complete local result envelope is not claimed to equal a server Docker result hash.

`verify-swing.mjs` uses the existing independent integer replay helper, extended in the test harness to permit staged buys. It verifies exact official order/PnL parity, repeated byte-identical orders, future-suffix causality, timestamp-shift invariance, native stdout parity, future-dated input rejection, target-room limits, non-losing additions, and observed normal-fill impact. It also reports six restarted four-hour diagnostics. The runtime imports neither verifier; `verify.mjs` remains the previous conservative version's test entry point.

See `SWING_RESULTS.md` for results, parameter-search limits, and the failed merge decision. Raw reports remain under ignored `local-grade-swing/`, `local-grade-swing-historical-*/`, and `audit/swing-validation.json`. `VALIDATION.md` is the archived conservative report at `071720f`.

## Identity and publication

Repository owner: `argaromit-lab`. Make.fun account: `@argaromit`. Ownership claim: `.makefun/owner.json`, naming the requested linked payout wallet. No API keys, keypair material, or credentials are included. Local transcript bundles and redacted instruction context stay under ignored `audit/`, separately from the public repository.

MIT licensed. The conditional merge rule requires an official full dev PnL above 15 USDC, maximum drawdown at most 12%, and a passing pre-submit check. The PnL condition fails, so this branch is not merged into `main` or submitted. Publishing the test branch does not replace the accepted entry.
