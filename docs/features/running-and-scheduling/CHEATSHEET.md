---
title: Cheatsheet
parent: Running and scheduling
grand_parent: Features
nav_order: 2
---

# Running and scheduling cheatsheet

## Commands

| Line | What it does |
| --- | --- |
| `auto-check run` | Run the check of this folder once. |
| `auto-check run <name>` | Run the check of a test folder under the root. |
| `auto-check run --phase start` | First half of a two-phase check. |
| `auto-check run --phase collect` | Second half. |
| `auto-check run --simulate-fail black` | Run with every capture replaced, to try the failure path. |
| `auto-check run --no-notify` | Run without notifications. |
| `auto-check run --scheduled` | Run the way the schedule does: skipped while the newest run failed, when `test-configuration.md` says so. |
| `auto-check` | The status of this test, including the next run. |
| `auto-check schedule install` | Write the wrapper and install the task. |
| `auto-check schedule status` | What the system says about the task. |
| `auto-check schedule remove` | Remove the task and its files. |
| `auto-check schedule install --dry-run` | Print the files and commands, change nothing. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Pass, a first phase that started, or a scheduled run skipped after a failed one. |
| 1 | Failure: an assertion or a comparison. |
| 2 | Could not run. |

## Timing

| Setting | Default | Platform |
| --- | --- | --- |
| `schedule.windows.schedule` | `DAILY` | Windows |
| `schedule.windows.startTime` | `03:00` | Windows |
| `schedule.windows.interactive` | `auto` | Windows |
| `schedule.macos.hour`, `.minute` | `3`, `0` | macOS |
| `schedule.linux.cron` | `0 3 * * *` | Linux |
| `schedule.linux.unit` | `systemd-user` | Linux |

A schedule starts at the earliest time, in half-hour steps, that is half an hour from every other test's task. Its own tasks do not count, so installing again keeps its time.

## What gets written

| Platform | Files |
| --- | --- |
| Windows | `schedule/run.cmd`, which runs `auto-check run --scheduled`, `schedule/task.xml`, and a task named `auto-check <folder>`, in any Task Scheduler folder |
| macOS | `~/Library/LaunchAgents/auto-check.<folder>.plist` |
| Linux, systemd | `~/.config/systemd/user/auto-check-<folder>.service` and `.timer` |
| Linux, cron | two lines in your crontab |
| Any | `logs/schedule.log` |

## Run folders

| Path | Holds |
| --- | --- |
| `results/<timestamp>/result.json` | Assertions, comparisons, outcome, fingerprint. |
| `results/<timestamp>/*.png`, `*.txt`, `*.json` | The captures of that run. |
| `results/<timestamp>-simulated/` | A simulated run. |
| `state.json` | Last run, last pass, open failure, consecutive failures. |

`test-configuration.md` sets how many run folders stay, 7 in a new test folder; without it, `results.keep` does, 14 by default. Baseline, simulated, and generate-try folders always stay, and so do the open failure's folder and a start waiting for its collect.

## The lock

| Platform | Folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\auto-check\locks\` |
| macOS, Linux | `~/.local/state/auto-check/locks/` |
| Any | `AUTO_CHECK_STATE_DIR` |

Taken by any check that drives a desktop app. A stale lock from a killed run is taken over.
