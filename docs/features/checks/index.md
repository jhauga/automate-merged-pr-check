---
title: Checks
parent: Features
nav_order: 5
has_children: true
---

# Checks

A check is a plain Node script, `run.mjs`, written by an assistant and kept in the test folder. It takes captures of the subject, asserts facts about them, and writes a result. Nothing in it is magic: `node run.mjs --out results/manual` runs it without the tool.
{: .fs-5 .fw-300 }

## Kinds and the capability ladder

`auto-check <pr-url>` classifies the pull request from the files it touched, then asks the assistant to write a check for that kind. The assistant takes the first rung of the ladder that fits, and says in the check's README why that rung and not a higher one.

| Kind | Rung | Layers and drivers | What the check asserts |
| --- | --- | --- | --- |
| `source / gui-web` | 1 | `page`: headless browser | The page renders, fills its view, is not blank, and responds to input, with no page errors. |
| `source / gui-canvas-extension` | 1 | `page`: headless browser; `hostApp`: DevTools protocol | The same facts, first on the subject's own page, then inside the desktop app that hosts it. |
| `source / cli`, `source / library` | 2 | `page`: process | The project's own tests for the touched paths pass, and the feature works as the pull request describes. |
| `documentation / install-procedure` | 3 | `page`: process, in a sandbox, a container, or a scratch folder | The documented steps complete, and the documented confirmation commands print what the documentation says. |
| `documentation / reference-docs` | 4 | `page`: process | Every command, flag, option, and path the touched section names still exists at the base tip. |
| `mixed` | one rung per part | both parts in one `run.mjs` | The assertions of both rungs. |

The `page` layer is the subject on its own: a page, a command, or a procedure. The `hostApp` layer is the subject inside the desktop app that hosts it. Each layer is judged on its own, and a layer that fails or stops with an error saves no baseline.

## The contract every check keeps

The check is free in how it works and strict in how it reports:

- It takes `--out <folder>` and writes everything there, including `result.json`.
- It writes assertions as `{ name, ok, detail }`, in the order it ran them.
- It names every capture, and saves images as PNG and text as `.txt` or `.json`.
- It exits 0 when every assertion passed, 1 when one failed, and 2 when it could not run.
- It takes `--capture-baseline`, which saves the captures of every layer whose assertions all passed.
- It takes `--simulate-fail <png>|black`, which replaces every capture before the assertions run.
- It never writes outside its own test folder, never pushes, and never opens anything.

The tool verifies the contract before it accepts a generated check, and gives the assistant one repair round when something is missing.

## Telling a working render from a broken one

A check for something with a screen decides in code, never by asking a model about a screenshot. These facts separate a working render from the usual ways one breaks:

| Fact | Catches |
| --- | --- |
| Nearly every pixel shares one color | A black or empty view. |
| The drawing surface is the size of its view | A surface left at its default size, or collapsed to a few pixels. |
| A prompt or overlay goes away after the interaction it invites | Controls that never engage. |
| Two captures differ, with the subject itself moving between them | A frozen frame. |
| No uncaught page errors and no console errors | Scripts that fail before drawing. |

## Proving the check can fail

```sh
auto-check run --simulate-fail black
```

Every capture becomes a black image, and every text capture becomes empty. A sound check fails, with exit code 1. `auto-check <pr-url>` runs that before it accepts a generated check: a check that passes with a black picture is not a check.

## Motion pairs

Captures that should show movement are named in pairs in `compare.motion`. A scheduled run fails a pair whose two frames differ by 0.5 percent of their pixels or less, so the generate step is stricter: on the baseline run, every pair must differ by more than 2 percent before the check is accepted.

Film grain, a cursor, or a ticking clock stays below that, so a view that can rest on a still scene needs a real input between its two frames, such as a turn or a click. When a check breaks this rule or the contract, the assistant gets one round to repair it.

## Baselines and comparisons

When the check is accepted, the tool runs it once with `--capture-baseline` and saves the captures of every passing layer into `baseline/`. Every later run compares its captures with those, as `compare.strategy` in `check.config.json` says:

| Strategy | Images | Text and JSON |
| --- | --- | --- |
| `pixel` | Pixel by pixel. `threshold` is the share allowed to differ, with `masks` for regions that always change. | Not compared. |
| `color-sample` | The palette, wherever its colors sit. A uniform image always fails. | Not compared. |
| `liveness` | Each image must not be uniform. No baseline needed. | Not compared. |
| `text` | Not compared. | Lines in any order. JSON by its fields and their types. |
| `composite` | `color-sample` and `liveness`. | As `text`. |

A generated subject, one that draws something different every time, cannot use `pixel`. The ladder sends those to `color-sample`, `liveness`, and structural assertions instead.

A failed comparison turns a passing run into a failure, and the report lists it with this run's capture beside the baseline's. A capture with no baseline yet is skipped, and the two frames of a motion pair are compared with each other, not with the baseline.

To capture a baseline again after a deliberate change upstream:

```sh
node run.mjs --out results/baseline-again --capture-baseline
```

## check.config.json

The generate step writes what it decided, and every run reads it:

```json
{
  "slug": "acme-demo-app-pr-123",
  "alias": "demo-app",
  "pr": { "url": "https://github.com/acme/demo-app/pull/123", "merged": true, "base": "main" },
  "classification": { "kind": "source", "subtype": "gui-web", "watchPaths": ["src/canvas/**"] },
  "source": { "mode": "upstream", "baseRef": "main", "clonePath": "repo" },
  "layers": { "page": { "enabled": true, "driver": "headless-browser" } },
  "compare": { "strategy": "composite", "threshold": 0.25, "motion": [["page-initial", "page-after-click"]] },
  "assistant": { "command": "claude", "model": "opus", "effort": "" },
  "schedule": "inherit",
  "notify": "inherit"
}
```

`schedule` and `notify` take `"inherit"`, meaning your settings, or an object that overrides part of them, such as `{ "windows": { "startTime": "05:30" } }`.

## The host app layer

A desktop app loads its own installed copy of the subject, not the copy in the clone. The `hostApp` layer therefore tests what users run, and it can fail while the base tip is fine, when the installed copy is older. Checks record a hash of both copies and note any difference, so a report can tell an outdated installed copy from a broken base tip.

A `hostApp` run needs a signed-in desktop session. Without one, the layer stops with an error, which is reported as an error, not a failure. Two checks that drive the same app are kept apart by a machine-wide lock.

## The kit

Each test folder holds `.auto-check/check-kit.mjs`, a copy of the helpers checks are written against: capture and compare helpers, the assertion recorder, the result writer, and the simulated-failure switch. The copy is stamped with the version that wrote it and refreshed by every generate and every run, so `node run.mjs` keeps working after `npm install` in the test folder, and no absolute path is written into any file.
