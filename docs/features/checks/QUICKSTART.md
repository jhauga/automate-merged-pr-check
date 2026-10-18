---
title: Quickstart
parent: Checks
grand_parent: Features
nav_order: 1
---

# Checks quickstart

```sh
auto-check https://github.com/acme/demo-app/pull/123   # write one
auto-check run                                         # run it
auto-check run --simulate-fail black                   # prove it can fail
node run.mjs --out results/manual                      # run it without the tool
```

## Watch it being written

The generate step prints what it is doing:

```text
Pull request: acme/demo-app#123, source / gui-web
The pull request is already merged, so the check tests main at its tip.
Preparing main at its tip
Code under test: a1b2c3d
Asking Claude Code to write the check
The check breaks 1 contract rule(s); asking for one repair
Installing the check's dependencies
Running the check with black captures, which must fail
Capturing the baseline
```

About an hour, most of it the assistant writing and trying the check.

## Read the check

`README.md` in the test folder says what the check does and why it took that rung of the ladder. `run.mjs` is plain Node, and `check.config.json` holds the decisions:

```sh
cat README.md
cat check.config.json
```

## Change what it asserts

Edit `run.mjs`. It is yours. Keep the contract: `--out`, named captures, assertions as `{ name, ok, detail }`, exit 0, 1, or 2, and `--capture-baseline` and `--simulate-fail` still working.

Then prove it still fails when it should, and capture a baseline again:

```sh
node run.mjs --out results/try --simulate-fail black   # must exit 1
node run.mjs --out results/baseline-again --capture-baseline
```

## When the subject changes on purpose

A deliberate change upstream makes the baseline wrong, not the code. Capture a new one:

```sh
node run.mjs --out results/baseline-again --capture-baseline
```

## When a comparison is too strict

Open `check.config.json` and loosen `compare`:

```json
"compare": { "strategy": "composite", "threshold": 0.35, "minRunSeconds": 5 }
```

| Symptom | Try |
| --- | --- |
| A generated scene fails `pixel` every night | `color-sample`, or `composite` |
| A clock or a cursor fails `pixel` | `masks`, or a higher `threshold` |
| A motion pair fails although the subject moves | A real input between the two frames |
| A text capture fails on line order | `text`, which compares lines in any order |
