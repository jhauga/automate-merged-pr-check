---
title: Cheatsheet
nav_order: 3
---

# Cheatsheet

Everything the tool takes, in tables. Each feature has a cheatsheet of its own under [Features](features/index.md).
{: .fs-5 .fw-300 }

## Commands

| Command | What it does |
| --- | --- |
| `auto-check <pr-url>` | Make a test folder for a pull request and write its check. |
| `auto-check` | Inside a test folder: validate the form, then write the check or print the status. |
| `auto-check -n, --name <folder>` | Make a test folder and its form, and stop there. |
| `auto-check run [<folder>]` | Run the check once. |
| `auto-check inspect <pr-url>` | Print what the tool reads from a pull request. |
| `auto-check context validate [<path>]` | Check a form, rule by rule. |
| `auto-check schedule install\|remove\|status [<folder>]` | Manage the schedule of one test. |
| `auto-check notify test` | Send a sample on every enabled channel. |
| `auto-check resolve [<folder>]` | Work on the open failure of one test. |
| `auto-check config get\|set\|unset\|list\|path` | Read and write per-user settings. |
| `auto-check setup --assistant <name>` | Make an assistant the default and check it. |
| `auto-check doctor` | Report tools, settings, root folder, and skills. |
| `auto-check -h, --help`, `auto-check <command> --help` | Help, for everything or for one command. |
| `auto-check -v, --version` | The version. |

`<folder>` is a path, or the name of a test folder under the root. It defaults to the folder you are in.

## Options

| Option | Goes with | What it does |
| --- | --- | --- |
| `-n, --name <folder>` | `<pr-url>`, bare | Name of the test folder to create under the root. |
| `--root <folder>` | `<pr-url>`, `--name` | Use this root instead of the configured one. |
| `--edit-context` | `<pr-url>`, `--name` | Open the new `context.md` in your editor before finishing. |
| `--unmerged <local-repo>` | `<pr-url>` | Test a pull request that has not merged yet, from a clone. |
| `--branch <name>` | `--unmerged` | The branch of that clone to test. |
| `--assistant claude\|copilot\|codex` | `<pr-url>` | Assistant for this run. |
| `--model <name>` | `<pr-url>` | Model for this run. |
| `--dry-run` | `<pr-url>`, `schedule`, `notify test`, `resolve` | Print what would happen, change nothing. |
| `-y, --yes` | `<pr-url>`, `--name` | Accept every suggested answer instead of asking. |
| `--no-schedule` | `<pr-url>` | Write the check without installing a schedule. |
| `--no-baseline` | `<pr-url>` | Write the check without capturing a baseline. |
| `--phase start\|collect` | `run` | One half of a two-phase check. |
| `--simulate-fail <png>\|black` | `run` | Replace every capture, to try the failure path. |
| `--no-notify` | `run` | Send no notifications for this run. |
| `--propose`, `--issue`, `--pr` | `resolve` | Which follow-up step to take. |
| `--push` | `resolve` | Push the fix branch to your fork. |
| `--json` | `inspect` | Print the summary as JSON. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Pass, or the command finished. |
| 1 | The check failed: an assertion, or a comparison with the baseline. |
| 2 | The tool could not do the work, such as a clone it could not fetch. |
| 3 | The guard refused: a test folder in the wrong place. |
| 4 | Bad arguments, or a `context.md` that does not pass. |

## A test folder

| Path | What it holds |
| --- | --- |
| `context.md` | The form. The marker file that makes this a test folder. |
| `check.config.json` | The pull request, the classification, the layers, and the comparison. |
| `run.mjs` | The check. Plain Node, runnable on its own. |
| `.auto-check/check-kit.mjs` | The copy of the check kit the check imports. |
| `baseline/` | The captures every run is compared with. |
| `results/<timestamp>/` | One folder per run, with `result.json` and the captures. |
| `found-issue/MM-DD-YYYY/` | Failure reports. |
| `proposed-solution/MM-DD-YYYY/` | Plans that fix them, and the resolve files. |
| `repo/` or `worktree/` | The code under test. |
| `logs/schedule.log` | What the scheduled runs printed. |
| `schedule/` | The wrapper and the task definition. |
| `state.json` | Last run, last pass, open failure, stored conversation. |
| `AGENTS.md`, `CLAUDE.md`, `.claude/skills/auto-check-*` | What an assistant reads in this folder. |

## The form

| Field | Required | Value |
| --- | --- | --- |
| Command | Optional | `claude`, `copilot`, or `codex`. |
| Model | Optional | A model that command accepts, written plainly, such as `Opus 5.5`. |
| Thinking Effort | Optional | A level that command offers, such as `high`. |
| Test folder root | Optional | The folder that holds this test folder. |
| Test folder name | Required | This folder's name. |
| Merged PR URI | Required | A pull request URL `gh` can read. |
| Local Repository | Optional | Your clone of that repository. Required for Commit Solution and for an open pull request. |
| PR Context | Optional | What the change delivers, and what working and broken look like. |
| Find Issue | Flag | A failing run writes a report. |
| Resolve Issue | Flag | The assistant writes a plan that fixes it. |
| Commit Solution | Flag | The plan is applied on a branch of your clone. |
| Local Commit | Flag | That branch is committed. |
| Remote Push | Flag | The branch is pushed to your fork. |
| Make PR | Flag | The pushed branch becomes a pull request. |

Flags take `true`, `false`, `yes`, or `no`, in any case. Absent reads as false. Every flag needs the one above it.

## Settings

| Key | Default | What it does |
| --- | --- | --- |
| `root` | empty | The folder that holds every test folder. |
| `assistant` | `claude` | The assistant used when a form names none. |
| `models.<assistant>.generate` | `opus`, `auto`, empty | Model that writes checks. |
| `models.<assistant>.analyze` | `opus`, `auto`, empty | Model that proposes and applies fixes. |
| `models.<assistant>.testDriver` | `haiku`, `auto`, empty | Low-cost model a check uses to drive its subject. |
| `models.<assistant>.effort` | empty | Thinking effort when a form names none. |
| `notify.onFail`, `onError`, `onRecover`, `onPass` | `true`, `true`, `true`, `false` | Which outcomes notify. |
| `notify.dryRun` | `false` | Write notifications to the result folder instead of sending them. |
| `notify.email.*`, `notify.sms.*`, `notify.webhook.*` | off | The channels. |
| `schedule.windows.*`, `schedule.macos.*`, `schedule.linux.*` | 03:00 daily | When checks run. |
| `results.keep` | `14` | How many result folders each test keeps. |
| `repos.localRepo` | empty | Clone used when a form names none. |
| `repos.upstreamRemote`, `originRemote`, `branchPrefix` | `upstream`, `origin`, `resolve-issue-` | Remotes and branch names for fixes. |
| `assistants.<name>.skills`, `.instructions`, `.permissionMode` | per assistant | Where that assistant reads from, and how much it may do. |

```sh
auto-check config path          # where the file is
auto-check config list          # every key, with defaults marked
auto-check config get root
auto-check config set notify.email.enabled true
auto-check config unset models.claude.effort
```

## Environment

| Variable | What it does |
| --- | --- |
| `AUTO_CHECK_CONFIG_DIR` | Use another settings folder. Tests and trials use this. |
| `AUTO_CHECK_STATE_DIR` | Use another folder for locks and machine state. |
| `VISUAL`, `EDITOR` | The editor `--edit-context` opens. |
| `AUTO_CHECK_SMTP_PASSWORD` | Named by `notify.email.smtp.passwordEnv`. |
| `AUTO_CHECK_WEBHOOK_SECRET` | Named by `notify.webhook.secretEnv`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Keeps Claude Code signed in for scheduled runs. |

## Everyday lines

```sh
auto-check https://github.com/acme/demo-app/pull/123   # watch a merged pull request
auto-check --name automate-pr-demo-app --edit-context  # make the folder, fill the form later
auto-check                                             # status, or write the check
auto-check run                                         # run it now
auto-check run --simulate-fail black                   # try the failure path
auto-check context validate                            # check the form
auto-check schedule status                             # when it runs next
auto-check resolve --propose                           # ask for a plan that fixes it
auto-check resolve --issue --dry-run                   # see every command a fix would run
auto-check doctor                                      # what the machine is missing
```
