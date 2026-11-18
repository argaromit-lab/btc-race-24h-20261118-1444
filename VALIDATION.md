# Conservative reference validation (commit 071720f)

This is the previous conservative candidate's report. The current aggressive experiment branch uses a different `main.ts`; its results are in `AGGRESSIVE_RESULTS.md` and its test command is `node verify-aggressive.mjs --save`.

The bot was built in one OpenCode session for the account `@argaromit`. The source is original code written in that session. No existing baseline implementation or third-party strategy was copied into the bot.

## Official frozen development window

Evaluated using the downloaded, unmodified make.fun kit with the process driver. The official grader verifies the kit hashes, re-derives its bars from the recorded pool-state samples, executes the bot twice, checks both action logs, and performs an L1 regrade.

| Metric | Result |
| --- | ---: |
| Starting cash | 1,000 USDC |
| Net PnL after all costs | +2.917076 USDC |
| Return | +0.2917076% |
| Maximum drawdown | 0.0757243% |
| Filled own orders, excluding final flatten | 9 |
| Rejected orders | 1 |
| Fees paid | 0.768984 USDC |
| Net PnL at doubled fees, official action-log replay | +2.146353 USDC |
| Time-weighted equity exposure | 1.6134004% |
| Maximum marked exposure | 35.260537% |
| Average filled entry | 319.858145 USDC |
| Maximum filled entry | 351.668767 USDC |
| Official guardrails | Compliant |
| L1 regrade | Reproduced |

Official action-log SHA-256:

```text
ce660ab30e2fc34d0d913ed86ffc62a4554aff7e851f4859e81da583a28f9a6d
```

Kit dataset digest:

```text
d81f50d5f663994f1b3088c7627f1a9c830ae419e0b21ec215f4884ca7fab30f
```

This candidate was measured with Node 22.23.5. Docker was unavailable. The kit's server runtime metadata differs, so the process driver's result hash is not claimed to reproduce a Docker score's complete envelope. The prior accepted baseline at `7d59a1fd9fa9dd5234c9cdc387f6e255567d5e54` made +1.566448 USDC with 13 fills, 0.159765% drawdown, and 2.5178764% average exposure. Dev PnL improves and drawdown falls, but fills decrease to 9 and average exposure decreases to 1.6134004%. The requested +10–25 USDC, 60–140 fills, and increased time-weighted utilization remain unmet. This is a conservative review candidate, not a claim that every optimization target was achieved.

## Chronological diagnostics

Six four-hour sub-windows were restarted with 1,000 USDC and no position. Windows after the first receive the preceding 120 bars as non-trading warmup. Any remaining position is sold with costs at each sub-window's end. The independent verifier's BigInt fill arithmetic was first checked against a saved official action log, matching its exact PnL, filled order count, and rejections.

| Zero-based scored bars | Net PnL (USDC) | Max drawdown | Filled own orders |
| --- | ---: | ---: | ---: |
| 0–239 | +2.100566 | 0.063787% | 6 |
| 240–479 | 0 | 0% | 0 |
| 480–719 | 0 | 0% | 0 |
| 720–959 | +0.816510 | 0.066557% | 3 |
| 960–1199 | 0 | 0% | 0 |
| 1200–1439 | 0 | 0% | 0 |

Sub-window returns do not sum to the continuous-window result: each sub-window resets the portfolio and marks and flattens at its own boundary. Some trade opportunities straddle those boundaries.

The optimization evaluated 150 source configurations, including the accepted baseline, sizing changes, coarse reversion variants, 12 trend hypotheses, 24 recovery variants, and four scale-in variants. Some configurations generate identical behavior. Initial selection used bars 0–959, scored by the weaker of two eight-hour training diagnostics plus one quarter of combined training PnL. The conservative reversion configuration C90 made +2.917076 USDC; its two restarted training diagnostics made +2.100566 and +0.816510 USDC. The last eight hours stayed flat. Scale-ins were rejected because they weakened the selection score and increased drawdown.

A more active continuation variant T10 initially looked better on dev: +4.315339 USDC, 14 fills, 0.2313641% drawdown, and 3.5499732% exposure. On three older official windows, however, T10 lost a combined 20.683525 USDC versus the accepted baseline's 10.479976 USDC loss. The preselected conservative fallback lost 7.710618 USDC on those same windows and was retained for review instead. Its numerical parameters were not retuned on those historical prices. The additional November 10–11 window below was checked after this fallback choice, without changing the candidate; it was adverse for both versions and worse in PnL for the candidate.

Three separate negative controls tested the naive idea that a 12 bps price deviation suffices without allowing for impact. Two of them reached 62 and 66 fills in the 16-hour training segment but lost 19.989355 and 13.898404 USDC, respectively. They are not part of the deployed strategy. Fills were not manufactured by repeatedly splitting one economic trade or by adding token-size orders merely to increase the count.

These are diagnostics on a previously inspected dev window: earlier work had already seen the full tape. Exploratory sweeps and choosing a fallback introduce selection bias despite the chronological procedure. The current dev suffix is not an independent holdout. Older disjoint dev windows add retrospective checks, not a future-market guarantee. No race-window data was accessed.

## Separate historical windows

Each row uses a different public `?phase=dev` kit, a fresh 1,000 USDC account, the official grader, two matching executions, and a reproduced L1 grade. Their manifests were checked to be dev-only, earlier than the current dev window, and mutually non-overlapping. The accepted baseline was run from its immutable Git commit; the candidate's source SHA-256 stayed fixed throughout these checks.

| 24-hour window ending (UTC) | Baseline PnL (USDC) | Candidate PnL (USDC) | Candidate max drawdown | Candidate fills |
| --- | ---: | ---: | ---: | ---: |
| 2026-11-11 08:01 | -0.362145 | -0.887369 | 0.1597601% | 2 |
| 2026-11-13 23:14 | -8.979575 | -6.564698 | 0.7635380% | 20 |
| 2026-11-15 08:28 | -4.313363 | -3.522784 | 0.6274373% | 21 |
| 2026-11-17 06:03 | +2.812962 | +2.376864 | 0.1530226% | 10 |
| Sum of separate-account PnLs | -10.842121 | -8.597987 | | |

Both versions are profitable on only one of these four days. The candidate's worst historical drawdown is 0.7635380%, versus 0.9619069% for the baseline, but neither version demonstrates consistently profitable historical trading. The sum is a comparison of four separate accounts, not a compounded portfolio return. Higher dev PnL must not be mistaken for proven live improvement. The full local reports are in ignored `audit/historical-conservative-comparison.json` and `local-grade-historical-*/`.

## Deterministic and defensive checks

`verify.mjs` checks:

- Repeat simulations produce identical order bytes.
- Mutating later prices at four cut points (64, 240, 480, and 1000) cannot change preceding orders.
- Shifting all input timestamps ten days leaves orders identical.
- The real `node main.ts` process produces the same reply bytes as the audited decisions.
- The exact official orders and action-log PnL are reproduced using independent integer fill arithmetic.
- Partial take profits are exercised. At 8% drawdown, an eligible entry is capped at 8% of equity; at 8.5%, new entries halt. A marked-equity test at 9.6% drawdown forces liquidation while the position itself is at cost, isolating the circuit from its ordinary stop. The circuit stays latched even after equity recovers, while a parallel control still finds eligible trades.
- Runtime imports are limited to `node:readline`; no clock, randomness, filesystem, environment, network, or child-process APIs appear in the runtime source.

Deterministic illustrative scenarios also exercise the strategy:

| Scenario | Net PnL (USDC) | Max drawdown | Filled own orders |
| --- | ---: | ---: | ---: |
| Dev prices, one-tenth pool liquidity | +0.290483 | 0.007647% | 9 |
| Smooth synthetic rising trend | +94.853997 | 0.046300% | 32 |
| Smooth synthetic falling trend | 0 | 0% | 0 |
| Low-edge synthetic oscillation | 0 | 0% | 0 |
| Repeated synthetic 6% crash gaps | -14.333540 | 1.433354% | 35 |
| 50% gap immediately after the first entry | -176.083751 | 17.608375% | 2 |

These constructed paths verify implementation behavior; they are not historical backtests or estimates of future profit. The rising trend exercises the breakout sleeve after its causal shadow-setup gate matures. The flat and falling cases remain in cash and would not meet the race's minimum-trade rule. The gap test demonstrates that the 9.5% account trigger cannot guarantee drawdown below 10%, 15%, or the race's 25% bar under every possible gap: execution occurs at a later open. The estimated 4 bps entry-impact cap uses the last known close depth, not a promise about the next open; the maximum observed filled entry impact on this dev run was 3.998598 bps.

A separate adaptive fee test doubles the fee in `hello` and allows the bot to change its trades in response: +1.472278 USDC, 3 fills. It differs from the official +2.146353 USDC fixed-action cost-sensitivity figure because the changed cost hurdle admits a different set of trades; neither establishes guaranteed profitability at different costs.

## Audit and publication checkpoint

The public repository contains the MIT license, `main.ts`, `verify.mjs`, and these explanations. Downloaded kit files, raw grader output, parameter-exploration scratch code, transcript bundles, and redacted setup context are ignored by Git. The transcript bundle is collected directly from OpenCode's own recorded database by the kit's CLI, with no fabricated timestamps or token counts and no edits to the underlying session store.

The final pre-submit check must run on the pushed commit and the current transcript bundle. `makefun check` performs intake and transcript checks; it does not register an entry, run the live race, or certify future trading performance. GitHub-only checks and signed-entry checks remain for submission time. This optimization stops at that check: the earlier accepted submission `01a1efbe-1c27-741e-aba5-e4a8a5bf6869` stays pinned to its original commit until another submission is explicitly authorized.
