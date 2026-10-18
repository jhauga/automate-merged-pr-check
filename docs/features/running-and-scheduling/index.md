---
title: Running and scheduling
parent: Features
nav_order: 5
has_children: true
---

# Running and scheduling

A check is only useful if it keeps running. `auto-check <pr-url>` installs a schedule for the check it writes, unless you pass `--no-schedule`, and you can manage it yourself at any time.
{: .fs-5 .fw-300 }

## What one run does

```sh
auto-check run
```

1. Refreshes the code under test: the managed clone at the tip of the base branch, or, for a pull request that has not merged yet, a worktree of its branch rebased onto the newest base. When such a pull request has since merged, the check switches to the base branch for good. When it was closed without landing, the run reports an error.
2. Records the machine fingerprint: the operating system, Node.js, the browser, the command-line tools, the desktop app's version, and a hash of the installed copy of the subject.
3. Runs `run.mjs` with the check's timeout, holding the machine-wide lock while it drives a desktop app.
4. Compares the captures with `baseline/`, as `compare.strategy` says.
5. Writes `results/<timestamp>/result.json`, updates `state.json`, and hands a failure to [the failure pipeline](../failure-pipeline/index.md).

```text
automate-pr-demo-app: pass
  code under test: upstream a1b2c3d
  assertions: 24 of 24 pass
  comparison (composite): 9 of 9 match the baseline
  result: results\2026-02-03T03-00-12\result.json
```

| Exit code | Meaning |
| --- | --- |
| 0 | The check passed, or the first phase of a two-phase check started. |
| 1 | The check failed: an assertion, or a comparison with the baseline. |
| 2 | The check could not run, such as a missing browser or a clone that could not be fetched. |

A failure is recorded with a signature built from what failed, the upstream commit, and the machine fingerprint. The same signature next time is a repeat: no new report, no new notification. A pass after a failure is a recovery.

## Trying the failure path

```sh
auto-check run --simulate-fail black
auto-check run --no-notify
```

A simulated failure writes a report marked as simulated, keeps its memory under `state.simulated`, and leaves the real run history alone.

## Installing a schedule

```sh
auto-check schedule install
auto-check schedule status
auto-check schedule remove
auto-check schedule install --dry-run
```

Every scheduled run starts `auto-check run` in the test folder, with its standard input closed, and appends its output to `logs/schedule.log`. The schedule holds the full path of the tool and of Node.js, so after you move a folder or install Node.js somewhere else, run `auto-check schedule install` again.

## When checks run

```json
"schedule": {
  "windows": { "schedule": "DAILY", "startTime": "03:00", "interactive": "auto" },
  "macos": { "hour": 3, "minute": 0 },
  "linux": { "cron": "0 3 * * *", "unit": "systemd-user" }
}
```

A check can override any of this in its own `check.config.json`, by replacing `"schedule": "inherit"` with the parts it changes. Run `auto-check schedule install` again after a change.

A check whose `runMode` is `two-step` gets two scheduled runs: `--phase start` at the set time, and `--phase collect` an hour later.

### Staggering

Several tests on one machine would otherwise all start at 03:00 and fight over the browser, the desktop app, and the network. Each new schedule is offset from the ones already installed, in half-hour steps, so the second test starts at 03:30, the third at 04:00, and so on. `auto-check schedule status` prints the time each one actually got.

### The machine-wide lock

A check that drives a desktop app takes a lock before it starts, and holds it until it is done. A second check waits. The lock lives with the machine's state, not in any test folder:

| Platform | Folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\auto-check\locks\` |
| macOS and Linux | `~/.local/state/auto-check/locks/` |
| Any | `AUTO_CHECK_STATE_DIR`, when set |

A lock left behind by a run that was killed goes stale and is taken over, so a crash never blocks tomorrow night.

## Windows

The tool writes `schedule/run.cmd` and a Task Scheduler definition beside it, then imports the task with `schtasks /Create /XML`. The task is named `auto-check <folder>`, and `auto-check <folder> collect` for the second phase of a two-phase check. Importing a definition, rather than creating the task from the command line, sets these:

- A run missed while the computer was off or asleep starts as soon as it is back.
- Runs start and continue on battery power.
- A run that is still going when the next one is due is not started twice.
- A run is stopped after twice the check's `timeoutMinutes`, plus 15 minutes.

`schedule.windows.interactive` decides how the task signs in:

| Setting | Runs |
| --- | --- |
| `auto` (default) | While you are signed in. A check that drives no desktop app can run without a session when `schedule install` is run from an elevated prompt. |
| `always` | While you are signed in. |
| `never` | Whether or not anyone is signed in. Windows allows this only from an elevated prompt, and a check that drives a desktop app cannot use it. |

Verified on Windows 11 with Task Scheduler.

## macOS

The tool writes a launchd agent, `~/Library/LaunchAgents/auto-check.<folder>.plist`, and loads it with `launchctl bootstrap gui/<uid>`. It runs daily at `schedule.macos.hour` and `schedule.macos.minute`, while you are signed in.

Not yet run on a Mac: the files and the commands are covered by unit tests only.

## Linux

With `"unit": "systemd-user"`, the tool writes `auto-check-<folder>.service` and `auto-check-<folder>.timer` into `~/.config/systemd/user/` and enables the timer. `schedule.linux.cron` must then have a fixed minute and hour, such as `0 3 * * *` or `30 4 * * 1-5`. Systemd user timers run only while you have a session, unless you turn on lingering with `loginctl enable-linger`.

With `"unit": "cron"`, the tool adds two lines to your crontab instead: a comment that names the check, and the job. Installing again replaces those lines, and removing deletes them, leaving every other line alone.

Not yet run on Linux: the files and the commands are covered by unit tests only.

## Keeping results

Each run keeps its folder under `results/`. `results.keep` sets how many of the newest to keep, 14 by default. The folders of the last pass and the last run are always kept, whatever that number says.
