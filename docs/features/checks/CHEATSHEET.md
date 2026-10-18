---
title: Cheatsheet
parent: Checks
grand_parent: Features
nav_order: 2
---

# Checks cheatsheet

## Rungs

| Kind and subtype | Rung | Layers |
| --- | --- | --- |
| `source / gui-web` | 1 | `page`: headless browser |
| `source / gui-canvas-extension` | 1 | `page`: headless browser, `hostApp`: DevTools protocol |
| `source / cli`, `source / library` | 2 | `page`: process |
| `documentation / install-procedure` | 3 | `page`: process, in a sandbox or scratch folder |
| `documentation / reference-docs` | 4 | `page`: process |
| `mixed` | one per part | both |

## The contract

| Rule | Detail |
| --- | --- |
| `--out <folder>` | Everything the run writes goes there, including `result.json`. |
| Assertions | `{ name, ok, detail }`, in the order they ran. |
| Captures | Named. Images as PNG, text as `.txt` or `.json`. |
| Exit 0 | Every assertion passed. |
| Exit 1 | An assertion failed. |
| Exit 2 | The check could not run. |
| `--capture-baseline` | Saves the captures of every layer that fully passed. |
| `--simulate-fail <png>\|black` | Replaces every capture before the assertions run. |
| Boundaries | Writes nothing outside the test folder, pushes nothing, opens nothing. |

## Comparison strategies

| Strategy | Images | Text and JSON | Use for |
| --- | --- | --- | --- |
| `pixel` | pixel by pixel, with `threshold` and `masks` | not compared | a deterministic view |
| `color-sample` | the palette | not compared | a generated scene |
| `liveness` | not uniform | not compared | anything that must simply be alive |
| `text` | not compared | lines in any order, JSON by field and type | commands and documents |
| `composite` | `color-sample` and `liveness` | as `text` | the usual mixed case |

## compare block

| Key | Means |
| --- | --- |
| `strategy` | One of the five above. |
| `threshold` | The share of pixels allowed to differ, for `pixel` and `color-sample`. |
| `masks` | Regions ignored in the comparison. |
| `motion` | Pairs of capture names that must differ from each other. |
| `minRunSeconds` | How long the subject must be observed before it is judged. |

## Motion pairs

| Where | Rule |
| --- | --- |
| Generate | Every pair must differ by more than 2 percent, or the check is sent back. |
| Scheduled run | A pair that differs by 0.5 percent or less fails. |

## Files

| File | Holds |
| --- | --- |
| `run.mjs` | The check. |
| `check.config.json` | Pull request, classification, source, layers, compare, assistant, schedule, notify. |
| `README.md` | What the check does, and which rung it took. |
| `.auto-check/check-kit.mjs` | The helpers the check imports, version stamped. |
| `baseline/` | The captures runs are compared with. |
| `results/<timestamp>/result.json` | Assertions, comparisons, outcome, fingerprint. |

## Lines

```sh
node run.mjs --out results/manual                        # run it
node run.mjs --out results/try --simulate-fail black     # must exit 1
node run.mjs --out results/base --capture-baseline       # new baseline
auto-check run                                           # run it the tool's way
auto-check run --phase start                             # first half of a two-phase check
auto-check run --phase collect                           # second half
```
