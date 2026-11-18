# Development validation

The bot was built in one OpenCode session for the account `@argaromit`. The source is original code written in that session. No existing baseline implementation or third-party strategy was copied into the bot.

## Official frozen development window

Evaluated using the downloaded, unmodified make.fun kit with the process driver. The official grader verifies the kit hashes, re-derives its bars from the recorded pool-state samples, executes the bot twice, checks both action logs, and performs an L1 regrade.

| Metric | Result |
| --- | ---: |
| Starting cash | 1,000 USDC |
| Net PnL after all costs | +1.566448 USDC |
| Return | +0.1566448% |
| Maximum drawdown | 0.159765% |
| Filled own orders, excluding final flatten | 13 |
| Rejected orders | 1 |
| Fees paid | 1.001909 USDC |
| Net PnL at doubled fees, official action-log replay | +0.563915 USDC |
| Official guardrails | Compliant |
| L1 regrade | Reproduced |

Official action-log SHA-256:

```text
6236b921ea3a2115568fad925d2e1d015a757d41144972b229d73bba399d7716
```

Kit dataset digest:

```text
d81f50d5f663994f1b3088c7627f1a9c830ae419e0b21ec215f4884ca7fab30f
```

Measured with Node 22.23.5 and Node 24.15.0; both produced that same official action-log digest and the same financial metrics. Docker was unavailable. The kit's server runtime metadata differs, so the process driver's result hash is not claimed to reproduce a Docker score's complete envelope.

## Chronological diagnostics

Six four-hour sub-windows were restarted with 1,000 USDC and no position. Windows after the first receive the preceding 120 bars as non-trading warmup. Any remaining position is sold with costs at each sub-window's end. The independent verifier's BigInt fill arithmetic was first checked against a saved official action log, matching its exact PnL, filled order count, and rejections.

| Zero-based scored bars | Net PnL (USDC) | Max drawdown | Filled own orders |
| --- | ---: | ---: | ---: |
| 0–239 | +1.425492 | 0.159765% | 8 |
| 240–479 | 0 | 0% | 0 |
| 480–719 | 0 | 0% | 0 |
| 720–959 | +0.598044 | 0.033510% | 3 |
| 960–1199 | -0.096725 | 0.029974% | 1 |
| 1200–1439 | 0 | 0% | 0 |

Sub-window returns do not sum to the continuous-window result: each sub-window resets the portfolio and marks and flattens at its own boundary. Some trade opportunities straddle those boundaries.

These are diagnostics on an already inspected dev window. Exploratory parameter sweeps of momentum and reversion were performed on this same tape; the final strategy therefore has selection bias. Neither these diagnostics nor the small positive full-window PnL establish that the strategy generalizes. No independent historical window or genuine unseen validation set was available from this kit.

## Deterministic and defensive checks

`verify.mjs` checks:

- Repeat simulations produce identical order bytes.
- Mutating every price after bar 999 cannot change orders through bar 999.
- Shifting all input timestamps ten days leaves orders identical.
- The real `node main.ts` process produces the same reply bytes as the audited decisions.
- Original action-log PnL is reproduced using independent integer fill arithmetic.
- Partial take profits are exercised, and the marked-equity circuit breaker issues a full sell and remains latched afterward.
- Runtime imports are limited to `node:readline`; no clock, randomness, filesystem, environment, network, or child-process APIs appear in the runtime source.

Deterministic illustrative scenarios also exercise the strategy:

| Scenario | Net PnL (USDC) | Max drawdown | Filled own orders |
| --- | ---: | ---: | ---: |
| Dev prices, one-tenth pool liquidity | +0.135343 | 0.023914% | 10 |
| Smooth synthetic rising trend | +61.443809 | 0.025977% | 32 |
| Smooth synthetic falling trend | 0 | 0% | 0 |
| Low-edge synthetic oscillation | 0 | 0% | 0 |
| Repeated synthetic 6% crash gaps | -7.578897 | 0.757890% | 35 |

These constructed paths verify implementation behavior; they are not historical backtests or estimates of future profit. The rising trend exercises the momentum sleeve after its shadow setups mature. The flat and falling cases intentionally remain in cash and would not meet the race's minimum-trade rule. Arbitrary gaps and changing liquidity can still exceed a stop's intended loss.

A separate adaptive fee test doubles the fee in `hello` and allows the bot to change its trades in response: +0.128673 USDC, 7 fills. That differs intentionally from the official +0.563915 USDC fixed-action cost-sensitivity figure above.

## Audit and publication checkpoint

The public repository contains the MIT license, `main.ts`, `verify.mjs`, and these explanations. Downloaded kit files, raw grader output, parameter-exploration scratch code, transcript bundles, and redacted setup context are ignored by Git. The transcript bundle is collected directly from OpenCode's own recorded database by the kit's CLI, with no fabricated timestamps or token counts and no edits to the underlying session store.

The final pre-submit check must run on the pushed commit and the current transcript bundle. `makefun check` performs intake and transcript checks; it does not register an entry, run the live race, or certify future trading performance. GitHub-only checks and signed-entry checks remain for submission time.
