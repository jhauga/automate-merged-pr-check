## The check contract

auto-check validates the check folder against this contract when you finish, and once more after one repair round. A check that still breaks it is rejected.

### Files in the check folder

| File | Written by | What it holds |
| --- | --- | --- |
| `check.config.json` | auto-check, then you | The settings below. |
| `run.mjs` | you | The check itself, built on the check kit. |
| `README.md` | you | What the check proves, the rung and why, how to run it by hand, what the baseline shows, and every manual step. |
| `package.json` | you | The check's own dependencies, such as `playwright-core`. Leave it with no dependencies when the check needs none. |
| `baseline/` | auto-check | The artifacts of a passing run, captured with `--capture-baseline` after you finish. Do not write it yourself. |
| `state.json` | auto-check and the check | Run history and any state the check keeps, such as a stored conversation. |
| `repo/` or `worktree/` | auto-check | The code under test. Discarded and rebuilt before each run. |

### check.config.json

Keep every key auto-check wrote. Change values that do not fit what you build, and set these:

- `layers.page` and `layers.hostApp`: `enabled` and `driver` for each layer. The `page` layer is the subject on its own: a page, a command, or a procedure. The `hostApp` layer is the subject inside the desktop app that hosts it. Drivers are `headless-browser`, `process`, `cdp`, `cli`, `desktop-automation`, or `manual`. An enabled layer must not keep the driver `pending`. Disable a layer you do not build, and say why in the README.
- `subject.installedPath`: the folder the host app loads the subject from, when it has an installed copy. `subject.hostApp`: `{ "name", "exe", "versionCommand" }` for the host app, or `null`. Write these paths with environment variables or `~`, such as `%LOCALAPPDATA%\Programs\SampleApp\sample-app.exe` or `~/.sample-app/extensions`, never with a user name; auto-check expands them when it records the machine fingerprint.
- `runMode`: `single`, or `two-step` when the work must start in one run and be collected in a later one, such as a long procedure in a sandbox.
- `timeoutMinutes`: how long one run may take before auto-check stops it.
- `compare`: `strategy` (`pixel`, `color-sample`, `liveness`, `text`, or `composite`; never `auto`), `threshold`, `masks` (rectangles `{ "artifact", "x", "y", "width", "height" }` in capture pixels), `minRunSeconds`, and optionally `motion`, pairs of image names such as `[["page-flying", "page-flying-later"]]` that must differ. A scheduled run fails a pair that changes 0.5% of its pixels or less, and auto-check accepts a new check only when every pair changes more than 2% in the baseline run, measured as `checkMotion` in `{{toolRoot}}/lib/compare/liveness.mjs` measures it. After `run.mjs` finishes, auto-check compares each capture with the one of the same name in `baseline/`, so `run.mjs` itself asserts facts and does not compare with the baseline:
  - `pixel`: images pixel by pixel; `threshold` is the share of pixels allowed to differ, 0.01 when left out.
  - `color-sample`: the palette of each image, wherever its colors sit; `threshold` is the palette distance allowed, from 0 to 1, 0.25 when left out. A uniform image always fails.
  - `liveness`: each image must not be uniform. No baseline is needed.
  - `text`: text captures by lines, in any order, and JSON captures by their fields and types, not their values; `threshold` is the share allowed to differ, 0 when left out.
  - `composite`: `color-sample` and `liveness` for images, and `text` for text and JSON.

  A capture with no baseline yet is skipped, and a capture the baseline has but the run did not make fails. A comparison that fails turns a passing run into a failure.
- `models.testDriver`: the low-cost model that drives the subject when a step needs a model, such as a prompt that opens the subject inside a host app.

### run.mjs

`run.mjs` imports `runCheck` from the check kit and hands it a function that does the work:

```js
import { runCheck } from '../../lib/check-kit.mjs';

await runCheck(import.meta.url, async (ctx) => {
  await ctx.layer('page', async () => {
    const shot = await ctx.image('page-initial', (file) => page.screenshot({ path: file }));
    ctx.assertNotBlank('page-initial is not blank', shot);
  });
});
```

The kit parses the command line, so `run.mjs` adds no options of its own:

```text
node run.mjs --out <folder> [--source <folder>] [--phase start|collect] [--layers page,hostApp]
             [--capture-baseline] [--simulate-fail <png>|black]
```

What `ctx` offers:

| Member | Use |
| --- | --- |
| `ctx.layer(name, fn)` | Runs `fn` when the layer is enabled, and files what it records under that layer. |
| `ctx.image(name, capture)` | `capture(file)` writes a PNG to `file`. Returns `{ file, width, height, data }`. |
| `ctx.text(name, produce)` | Saves the text `produce()` returns and returns it. |
| `ctx.json(name, produce)` | Saves the value `produce()` returns as JSON and returns a copy of it. |
| `ctx.assert(name, ok, detail)` | Records one assertion. Name it after the fact it proves. |
| `ctx.assertNotBlank(name, image)` | Fails when nearly every pixel shares one color, as in a black or empty view. |
| `ctx.note(text)` | Adds a remark to the result, such as a version or a drift warning. |
| `ctx.readState()`, `ctx.writeState(patch)` | Reads and merges into `state.json`. |
| `ctx.baselinePath(file)` | Path of a file in `baseline/`. |
| `ctx.source`, `ctx.dir`, `ctx.out`, `ctx.config` | The code under test, the check folder, the output folder, and `check.config.json`. |
| `ctx.phase`, `ctx.capturingBaseline`, `ctx.simulatingFailure`, `ctx.layers` | How this run was started. |

Rules for `run.mjs`:

- Exit codes come from the kit: 0 when every assertion passes, 1 when one fails, 2 when the check throws or asserts nothing. Throw for a problem with the machine, such as a missing browser, a missing desktop session, or a host app that never starts. That reports an error, not a broken subject. A layer that throws stops only itself, so the other layer still runs and can still save its baseline.
- Base every assertion on a value that came back from `ctx.image`, `ctx.text`, or `ctx.json`. Under `--simulate-fail` every capture still runs, and the kit then replaces its value (a black image, empty text, or `null` from `ctx.json`) so that a sound check fails with exit 1. Save exit codes and page facts through `ctx.text` or `ctx.json` too, and read fields with optional chaining (`facts?.canvas?.width`) so a simulated failure fails an assertion instead of throwing.
- Give artifacts stable names, such as `page-initial` and `page-after-click`. The comparison matches them with the baseline by name.
- Keep captures stable between runs: a fixed viewport and scale, the same steps in the same order, and a wait for the subject to settle before each capture.
- Clean up everything the run started, even after a failure: servers, browsers, sandboxes, temporary files, and anything opened in a host app.
- Never ask a model to judge a capture. Decide with code: blank or uniform views, sizes, visible elements, text, and exit codes.

### result.json

The kit writes `<out>/result.json`:

```json
{
  "outcome": "pass",
  "startedAt": "2026-01-01T03:00:00.000Z",
  "finishedAt": "2026-01-01T03:00:42.000Z",
  "phase": null,
  "layers": { "page": "ran", "hostApp": "skipped" },
  "artifacts": [{ "name": "page-initial", "file": "page-initial.png", "kind": "image", "layer": "page" }],
  "assertions": [{ "name": "page-initial is not blank", "ok": true, "detail": "41% of pixels share one color", "layer": "page" }],
  "notes": []
}
```

`outcome` is `pass`, `fail`, `error`, or `baseline`. auto-check adds the upstream commit, the machine fingerprint, and the comparison when it records a scheduled run.

### Baseline

`--capture-baseline` saves the artifacts of every layer whose assertions all pass into `baseline/`. A layer with a failing assertion saves nothing and the run exits 1, so a broken subject never becomes the expected result. The README tells the user to look at the baseline once and confirm it shows a working subject.
