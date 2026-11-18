# High-conviction swing test: merge threshold not met

The testing branch is `high-conviction-swing`. The user's rule is strict: merge and submit only if the official complete dev grade has net PnL **above 15 USDC**, maximum drawdown **at most 12%**, and `makefun check` passes without failures. The selected swing candidate loses money. No merge or replacement submission is performed.

## Official complete development replay

| Metric | Result |
| --- | ---: |
| Starting capital | 1,000 USDC |
| Net PnL after all execution costs | -8.030987 USDC |
| Return | -0.8030987% |
| Maximum drawdown | 0.8600817% |
| Filled own orders | 20 |
| Rejected orders | 0 |
| Fees alone | 2.501960 USDC |
| Fixed-action net PnL with doubled fees | -10.528482 USDC |
| Average marked exposure | 7.0996562% |
| Maximum marked exposure | 81.4387412% |
| Average filled buy | 391.353574 USDC |
| Largest filled buy | 426.424181 USDC |
| Maximum observed normal buy/sell impact | 4.5241888 bps |
| L1 regrade | Reproduced |
| User's conditional merge gate | Failed: PnL |

Official action-log SHA-256:

```text
355e934c4a2028a6dfa45539ec22a3dc2fa374fff7b59d37a102d81e20caf537
```

Dataset digest: `d81f50d5f663994f1b3088c7627f1a9c830ae419e0b21ec215f4884ca7fab30f`. The official kit verifies its dataset and recorded pool-state bars and executes the program twice. The local process driver used Node 22.23.5; Docker was unavailable. An independent BigInt single-pool replay reproduces its exact orders and PnL. Local process result envelopes are not claimed to match server Docker hashes.

## Entry, holding, and staged capital

The selected policy uses EMA-12 > EMA-36 > EMA-96, a 30-minute high breakout, positive 15- and 30-minute momentum, and a relative-activity filter. True volume is used only when present; the official null-volume input falls back to a labeled true-range activity proxy. A momentum/slope projection must exceed 35 bps and the estimated round-trip friction plus a buffer. This heuristic does not establish a calibrated positive expected return.

The nominal equity target is 90%. A single order at the observed depth cannot invest 80–95% of a 1,000 USDC account while keeping estimated impact below 5 bps, so the bot builds with at most three separately filled minute orders. Additions require persistent conviction, positive target room, and an existing marked position worth at least its exact cost. Normal exits are also staged using a 4.5 bps estimate as a buffer below 5 bps. The observed complete dev run has two add-on buys and six partial-exit decisions. Trade count is not artificially inflated by same-bar round trips or dust orders.

Protective position stops can close a trade early. Otherwise the policy lets gains run under an adaptive trailing stop and allows regime-failure exits after fifteen holding bars, with a selected sixty-minute time limit. Staged exits can take additional bars to complete. Account risk reduces exposure at 6% drawdown and halts at 10%; a more severe emergency may liquidate the full remainder. Unknown next-open prices, changing depth, and forced final flattening mean a trigger is not a guaranteed global drawdown or impact ceiling.

## Calibration and caveats

An initial prototype had a runtime variable error and failed before its first reply; this was fixed, and that prototype's subsequent -2.459842 USDC result was not treated as a qualifying score. Review then corrected the actual entry-budget, position-room, and exit/staging rules. An overly wide exploratory search was terminated before completion; no unreported optimum from it is claimed.

The completed bounded search tested 32 policies spanning 15/30-minute breakouts, 35/50 bps move budgets, two activity thresholds, two trailing floors, and 60/90-minute maximum holding periods. Selection used bars 0–959 and two restarted eight-hour diagnostics. None of those completed training candidates exceeded 15 USDC. The selected policy was the best of that bounded training comparison, not a profitable finding. Its final exact non-losing-addition check corrected a sub-basis-point integer-rounding case; the official results above use that final code.

The complete current tape was already inspected during earlier work, and four older tapes were also available from earlier project diagnostics. Therefore these are retrospective checks with selection bias, not untouched future-market tests or evidence of freedom from overfitting. No race-window input was read.

## Restarted four-hour diagnostics

Each row starts with 1,000 USDC and no holding, with up to 120 preceding bars as non-trading warmup. Positions are flattened with costs at each sub-window's end. Separate-account PnLs need not sum to the continuous run.

| Scored zero-based bars | Net PnL (USDC) | Max drawdown | Fills |
| --- | ---: | ---: | ---: |
| 0–239 | 0 | 0% | 0 |
| 240–479 | -2.835172 | 0.4240693% | 9 |
| 480–719 | -2.271367 | 0.4761792% | 6 |
| 720–959 | -3.128273 | 0.3128273% | 6 |
| 960–1199 | -2.108950 | 0.2108950% | 3 |
| 1200–1439 | 0 | 0% | 0 |

## Earlier disjoint official dev windows

The same frozen candidate was run with the official grader on four older `phase=dev` kits. Their manifests are dev-only, mutually non-overlapping, and end before the current dev window. Every run completed twice with matching orders and a reproduced L1 grade. Parameters were not changed after these results.

| Window ending (UTC) | Net PnL (USDC) | Max drawdown | Fills |
| --- | ---: | ---: | ---: |
| 2026-11-11 08:01 | -14.797220 | 1.4797220% | 22 |
| 2026-11-13 23:14 | -14.565608 | 1.5364149% | 22 |
| 2026-11-15 08:28 | -3.192677 | 0.9040428% | 12 |
| 2026-11-17 06:03 | -13.971869 | 1.7437054% | 35 |

All four historical windows lose money, reinforcing the decision not to merge or submit. More capital and longer holding do not by themselves establish a predictive edge.

## Correctness and preservation checks

`verify-swing.mjs` verifies exact official order/PnL parity, repeated order bytes, four future-suffix perturbations, ten-day timestamp-shift invariance, native stdout parity, rejection of future-dated input, target-room sizing, exact non-losing additions, and observed normal-fill impact below 5 bps. Runtime main.ts imports only standard `node:readline`; it does not read a clock, environment, network, data file, or credential.

`makefun check` is a separate source/transcript check, not proof of profitable trading. Even a passing source check cannot satisfy the failed >15 USDC condition. The protected `main` remains `071720f14f9dd6b8875edb9f272eeb1f9408fc35`; the accepted live-race entry is still `01a1efbe-1c27-741e-aba5-e4a8a5bf6869` at commit `7d59a1fd9fa9dd5234c9cdc387f6e255567d5e54`.
