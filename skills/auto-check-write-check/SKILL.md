---
name: auto-check-write-check
description: 'Write, repair, or review a scheduled check that auto-check generated for a pull request, in its test folder. Use when auto-check asks for a check, when a check breaks its contract, fails for the wrong reason, or needs a new layer, or when someone asks how a generated check proves that a pull request still works.'
---

# auto-check: write a check

A check is a test folder that proves what a pull request delivered still works at the newest commit of its base branch, or that its documentation is still accurate. auto-check runs it on a schedule, with nobody watching, and compares its artifacts with the baseline.

## When to use this skill

- `auto-check <pr-url>` gave you `generate.prompt.md` or `repair.prompt.md`. The prompt file is the whole task, and this skill only summarizes it.
- A check breaks the contract, fails because of the check rather than the subject, or needs a layer it lacks.
- Someone asks how a check works or why it chose its rung.

## The full rules

Read these files at the repository root before changing a check. They are the text auto-check sends to the assistant:

- `prompts/harness-contract.md`: the files, `check.config.json`, the check kit API, exit codes, `result.json`, and baseline rules.
- `prompts/capability-ladder.md`: how to choose the approach for each kind of pull request, including the host app steps.
- `lib/check-kit.mjs`: the kit every `run.mjs` builds on.

## Steps

1. Run `auto-check inspect <pr-url>` for the pull request's kind, subtype, and watched paths, and read `check.config.json` in the test folder.
2. Read the changed files in the code under test, `repo/` (or `worktree/` for an unmerged branch). That folder holds the base branch tip, never the pull request's own commit, and auto-check rebuilds it before every run.
3. Take the first rung of the capability ladder that fits. Say which rung and why in the README.
4. Write `README.md` before `run.mjs`: what the check proves, the rung, how to run it by hand, what the baseline should show, and every manual step.
5. Write `run.mjs` with `runCheck` from the check kit. Base every assertion on a value from `ctx.image`, `ctx.text`, or `ctx.json`.
6. In the check folder, run `npm install`, then `node run.mjs --out results/try`, which must exit 0. Then run `node run.mjs --out results/try-simulated --simulate-fail black`, which must exit 1.
7. Leave `baseline/` alone. auto-check captures it with `--capture-baseline`. To capture it again by hand, run `node run.mjs --out results/baseline --capture-baseline`.

## Rules

- Never test the pull request's head commit or branch, and never change `source.baseRef`, `source.mode`, or `source.upstreamUrl`.
- Judge every capture with code. Never ask a model whether a screenshot looks right. A blank or uniform view, a drawing surface that does not fill its view, and controls that never respond are failures.
- Pair two frames in `compare.motion` only when the subject itself moves between them in every run, by far more than film grain, a cursor, or a clock. When the view can rest on a still scene, take the second frame after an input that always changes it, such as a turn. auto-check accepts a new check only when every pair changes more than 2% of its pixels in the baseline run.
- Keep runs offline and repeatable: loopback servers on port 0, a fixed viewport, an installed browser, and nothing downloaded at run time.
- In a host app, delete every conversation the check creates, restore settings, and leave the app as you found it, never running with a debugging port open. Do it from a `finally` block that does not depend on the captures, so a failed, stopped, or simulated run cleans up too.
- Throw for a machine problem, such as a missing browser or no desktop session, so the run reports an error instead of a broken subject.
- Work only inside the check folder. Never push, open issues or pull requests, install anything globally, or write secrets into files.
- Never use em dashes or en dashes.
