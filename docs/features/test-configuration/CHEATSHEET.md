---
title: Cheatsheet
parent: test-configuration.md
grand_parent: Features
nav_order: 2
---

# test-configuration.md cheatsheet

## Fields

| Label | Value | Default | Effect |
| --- | --- | --- | --- |
| `Turn Off on Failed Test` | `true`, `false` | `true` | Skip a scheduled run while the newest run failed. |
| `Keep Prior Results` | `true`, `false` | `true` | `false` keeps only the newest run folder. |
| `Number of Test` | 1 or more | `7` | Run folders kept, oldest deleted first. |
| `Send Notifications` | `true`, `false` | `false` | `false` sends nothing for this test. |
| `Notify when Test` | `pass`, `fail`, `both` | none | Which outcomes notify. |
| `Email` | an address, or `%NAME%`, `$NAME`, `${NAME}` | `null` | The account that sends and receives. `null` uses your settings' channels. |
| `Password` | `%NAME%`, `$NAME`, `${NAME}` | `null` | The variable that holds the account's password. |

## Notify when Test

| Value | Notifies on |
| --- | --- |
| `fail` | a failure, and a run that could not run |
| `pass` | a pass, and the first pass after a failure |
| `both` | all of them |

A repeat of the open failure notifies once.

## Run folders

| Counted and deleted | Never touched |
| --- | --- |
| `2026-02-03T03-00-12` | `<timestamp>-baseline` |
| `2026-02-03T03-00-12-2` | `<timestamp>-simulated-failure` |
| `2026-02-03T03-00-12-start` | `<timestamp>-simulated` |
| `2026-02-03T04-00-12-collect` | `generate-try`, `generate-try-simulated`, `manual` |

Kept past the count while read: the open failure's folder, and a start waiting for its collect.

## Scheduled runs

| Newest finished run | `auto-check run --scheduled` |
| --- | --- |
| failed | skipped: one line, exit 0, nothing written |
| passed, could not run, unreadable, or none | runs |

`auto-check run` without `--scheduled` always runs. Every installed schedule passes `--scheduled`; on Windows, `schedule\run.cmd` passes it itself.

## Mail server for Email

| Order | Source |
| --- | --- |
| 1 | the provider nodemailer knows for the address's domain |
| 2 | `notify.email.smtp.service`, or `.host` other than `smtp.example.com` |
| 3 | none: the email channel fails and says which setting to fill in |

## Commands

| Line | What it does |
| --- | --- |
| `auto-check` | Write the file if it is missing, then check both forms. |
| `auto-check context validate test-configuration.md` | Check this file alone. |
| `auto-check context validate` | Check both forms of this test folder. |
| `auto-check notify test --dry-run` | Print what this test would send. |
| `auto-check doctor` | Report the file and whether its password variable is set. |
| `auto-check run` | Run now, and turn a skipped test back on when it passes. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The file is valid, or a scheduled run was skipped. |
| 2 | `auto-check run` refused a file with problems. |
| 4 | Validation found a problem. |
