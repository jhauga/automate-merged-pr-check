---
title: Quickstart
parent: Running and scheduling
grand_parent: Features
nav_order: 1
---

# Running and scheduling quickstart

```sh
auto-check run                 # run the check now
auto-check                     # where it stands, and when it runs next
auto-check schedule status     # the task itself
```

## Install, check, remove a schedule

```sh
auto-check schedule install
auto-check schedule status
auto-check schedule remove
```

See what it would do first:

```sh
auto-check schedule install --dry-run
```

## Change the time

Open `check.config.json` and replace `"schedule": "inherit"`:

```json
"schedule": { "windows": { "startTime": "05:30" } }
```

Then install again:

```sh
auto-check schedule install
```

To change it for every test, set it once:

```sh
auto-check config set schedule.windows.startTime 02:00
```

## Read a scheduled run

```sh
tail -40 logs/schedule.log
```

Or look at the newest result folder:

```sh
cat results/*/result.json | tail -40
```

## When a run did not happen

| Symptom | Likely cause |
| --- | --- |
| The task says it never ran | The machine was off, and the catch-up run has not started yet. |
| It ran and exited 2 | The clone could not be fetched, or the browser is missing. Run `auto-check doctor`. |
| A `hostApp` layer stopped with an error | Nobody was signed in. Keep the task interactive, or run it when you are. |
| Two checks collided | They did not: the second waited for the machine-wide lock. Look at the second one's log. |
| Everything broke after moving the folder | The schedule holds full paths. Run `auto-check schedule install` again. |

## Run it by hand, without the tool

```sh
node run.mjs --out results/manual
```

Useful when you want the check's own output and nothing else.
