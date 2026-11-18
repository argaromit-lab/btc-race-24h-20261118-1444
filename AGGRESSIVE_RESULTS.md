# Aggressive micro-scalp experiment: failed dev gate

The experiment implements the requested EMA-3/EMA-8 micro signals, short-range breakouts, fast recovery entries, nominal 90% cash allocation, and quick exits. It reaches the requested turnover range, but loses money. It is not a qualifying entry and is not submitted to replace the previously accepted bot.

## Official complete dev replay

| Metric | Result |
| --- | ---: |
| Starting paper capital | 1,000 USDC |
| Net PnL after every fee, slippage, and impact | -156.479683 USDC |
| Return | -15.6479683% |
| Maximum drawdown | 15.6479683% |
| Filled own orders | 310 |
| Rejected orders | 0 |
| Fees alone | 54.107452 USDC |
| Time-weighted marked exposure | 5.1231389% |
| Average entry | 436.766790 USDC |
| Maximum entry | 611.664194 USDC |
| Maximum marked exposure | 66.068796% |
| Fixed-action PnL with doubled fees | -210.494043 USDC |
| Positive-PnL dev gate | Failed |
| L1 replay verification | Reproduced |

The 6 bps impact budget clips orders below the nominal 90% cash allocation. The largest observed filled entry impact was 6.089330 bps because the next open's pool depth differs from the last known close's. The one-bar holding configuration is very fast, but its capital is in cash while orders wait for the next open. Nominal allocation must not be reported as average active capital.

The official action-log SHA-256 is:

```text
0a42702b4af4b57b193579407b50868a02cf765028bf52e054c93058bdb07430
```

This uses the published dev dataset `d81f50d5f663994f1b3088c7627f1a9c830ae419e0b21ec215f4884ca7fab30f`, the official kit, and the process driver on Node 22.23.5. Docker was unavailable. The financial results and exact orders were independently reproduced; the whole local result envelope is not claimed to match a server Docker score's hash.

## Measured search and alternatives

The build tested 144 initial configurations, 216 refined configurations, and 72 execution-price-guard configurations. The initial prototype's holding-bar accounting and reversal-exit behavior were corrected before the refined phase. These are related exploratory trials, not independent statistical samples. Initial selection inspected only the first 960 bars with two restarted eight-hour diagnostics; the final 480 bars were then checked on selected profiles. The dev tape had already been inspected during previous project work, so this is not an unseen holdout and does not establish freedom from overfitting.

| Profile | Net PnL, full 24h (USDC) | Trades | Max drawdown |
| --- | ---: | ---: | ---: |
| Committed mixed scalp, 6 bps impact cap | -156.479683 | 310 | 15.6479683% |
| Larger 12 bps impact cap | -182.090903 | 330 | 18.2090903% |
| Smaller 2 bps cap and tighter execution guards | -48.613086 | 358 | 4.8613086% |
| Sparse guarded profile, mixed signals | +0.286096 | 4 | 0.7986100% |

The sparse positive profile neither meets the requested turnover nor beats the already accepted bot's dev result; its final eight-hour diagnostic loses 6.406048 USDC. None of these measured profiles achieves the requested combination of 250–450 trades, 85–95% actual capital use, and +80–120 USDC net PnL.

The public leaderboard read during this build showed a rounded dev leader near +92.4 USDC with 390 trades. That is a benchmark from another entry, not evidence that this implementation achieves the same result or a prediction of the future race. Its source was withheld and was not used.

## Chronological four-hour diagnostics

Each sub-window starts with 1,000 USDC and no position. Later sub-windows receive 120 non-trading warmup bars. Its remaining position is flattened at its own end. These independent-account PnLs do not sum to the continuous run, whose cash and drawdown mode carry across boundaries.

| Zero-based bars | Net PnL (USDC) | Trades |
| --- | ---: | ---: |
| 0–239 | -36.157974 | 58 |
| 240–479 | -33.578547 | 60 |
| 480–719 | -32.208206 | 50 |
| 720–959 | -26.154183 | 42 |
| 960–1199 | -14.810829 | 26 |
| 1200–1439 | -29.266816 | 48 |

Every sub-window loses money. An adaptive replay with the fee doubled in `hello` loses 162.077230 USDC with 250 trades. These adverse results are reported rather than replaced by the best-looking training fragment.

## Correctness checks and risk limits

`verify-aggressive.mjs` confirms exact official order/PnL parity, identical repeated orders, prefix causality at four cut points, timestamp-shift invariance, and exact output from the real Node process. It verifies that a future-dated input bar is rejected. The runtime uses only standard `node:readline`; no network, filesystem, environment, random source, or wall clock is accessed by the trading code.

Risk-unit scenarios isolate the cash allocation: 18% drawdown produces a 25% cash order, reduced sizing persists below the previous equity peak, and 90% sizing resumes only when that peak recovers. At 18%, a held position gets an unrestricted emergency exit; at 22%, new trading halts permanently. A 14% early reduction supplies a buffer. Stops still fill at a later open, so these triggers cannot guarantee a maximum realized drawdown under arbitrary price gaps.

## Submission decision

The dev gate requires final net PnL above zero. The committed aggressive profile ends at -156.479683 USDC, so submitting it would replace a previously qualifying entry with one that cannot race. No such replacement is sent. The default `main` branch stays at the conservative candidate, and the already accepted submission remains `01a1efbe-1c27-741e-aba5-e4a8a5bf6869` at commit `7d59a1fd9fa9dd5234c9cdc387f6e255567d5e54`.
