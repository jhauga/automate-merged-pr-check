---
title: Cheatsheet
parent: Test folders
grand_parent: Features
nav_order: 2
---

# Test folders cheatsheet

## Commands

| Line | What it does |
| --- | --- |
| `auto-check config set root <folder>` | Set the folder that holds test folders. |
| `auto-check config get root` | Print it. |
| `auto-check <pr-url>` | Make a test folder for that pull request, then write the check. |
| `auto-check <pr-url> --name <folder>` | Same, with a name of your own. |
| `auto-check <pr-url> --root <folder>` | Same, under another root, without saving it. |
| `auto-check --name <folder>` | Make the folder and its form, and stop. |
| `auto-check --name <folder> --edit-context` | Same, and open the form in your editor. |
| `auto-check --name <folder> -y` | Same, taking every suggested answer. |
| `auto-check` | In a test folder: write a missing `test-configuration.md`, validate both forms, then write the check, or refresh the instructions, skills, and schedule wrapper and print the status. |
| `auto-check run <name>` | Work on a test folder by name under the root. |

## Layout

| Path | Written by | Holds |
| --- | --- | --- |
| `context.md` | `--name`, or the first step of a generate | The form, and the marker that makes this a test folder. |
| `test-configuration.md` | the same, or a bare `auto-check` when it is missing | Results kept, skipping scheduled runs after a failure, notifications. |
| `.gitignore` | the same | Results, logs, clones, `.env`, and node_modules. |
| `check.config.json` | the generate | Pull request, classification, layers, comparison, assistant. |
| `run.mjs`, `package.json` | the assistant | The check and its dependencies. |
| `.auto-check/check-kit.mjs` | every generate and run | The kit the check imports, version stamped. |
| `AGENTS.md`, `CLAUDE.md` | the generate, and a bare `auto-check` | What an assistant reads in this folder. |
| `.claude/skills/auto-check-*` | the generate, and a bare `auto-check` | The tool's skills, in the named assistant's folder. |
| `baseline/` | the baseline run | What every run is compared with. |
| `results/<timestamp>/` | every run | `result.json`, captures, prompts. The newest are kept, as `test-configuration.md` says. |
| `found-issue/MM-DD-YYYY/` | a failing run with Find Issue | The failure report. |
| `proposed-solution/MM-DD-YYYY/` | the resolve steps | The plan, the commit message, the pull request text. |
| `repo/`, `worktree/` | every run | The code under test. |
| `logs/schedule.log` | scheduled runs | Their output. |
| `schedule/` | `schedule install` | The wrapper, which a bare `auto-check` refreshes, and the task definition. |
| `state.json` | every run | Last run, last pass, open failure, stored conversation. |
| `.env` | you | Variables such as the password `test-configuration.md` names. |

## Naming

| Rule | Detail |
| --- | --- |
| Allowed | Letters, digits, `.`, `-`, `_`. |
| Refused | Path separators, a leading dot, an empty name, a name that exists already with files in it. |
| Suggested | `automate-pr-<subject>`, from the repository and the change. |
| Must match | The `Test folder name` line of the form. |

## Guard

| Situation | Result |
| --- | --- |
| Inside the auto-check repository | Refused, exit code 3. |
| Inside another test folder | Refused, exit code 3. |
| Under the root | Allowed. |
| Anywhere else, with a `context.md` | Allowed, and used as is. |

## Editor

| Source | Order |
| --- | --- |
| `VISUAL` | 1 |
| `EDITOR` | 2 |
| `git var GIT_EDITOR` | 3 |
| `notepad.exe` on Windows, `vi` elsewhere | 4 |
