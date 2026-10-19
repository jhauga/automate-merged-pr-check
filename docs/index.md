---
title: Home
nav_order: 1
---

# auto-check

Helps you be a responsible contributor: an AI coding assistant writes an automated, scheduled test that keeps checking that a merged pull request still works as expected, and that its documentation still works as documented.
{: .fs-6 .fw-300 }

[Quickstart](QUICKSTART.md){: .btn .btn-primary } [Cheatsheet](CHEATSHEET.md){: .btn } [Features](features/index.md){: .btn }

---

You contributed something, it was merged, and the repository moved on. Six months later the feature is quietly broken, or the install steps you documented no longer work, and nobody notices because no test covers them. `auto-check` turns that pull request into a check that runs on its own, on a schedule, against the newest commit of the base branch.

## What it does

1. You give it a merged pull request.
2. It reads the pull request, decides what kind of change it was, and asks an AI coding assistant to write a check for it.
3. It proves the check is sound: the check must fail when the subject is replaced with a black picture, and captures that are supposed to move must move.
4. It captures a baseline and installs a schedule.
5. Every scheduled run compares the subject with that baseline and writes a result. When something breaks, a form in the test folder decides how far the follow-up goes: a report, a proposed fix, a branch in your clone, a push, a pull request.

## The shape of it

`auto-check` is one command-line tool, installed once. Everything it produces lives outside its own repository:

```text
<root folder>/                     the folder you pick once
  automate-pr-demo-app/            one test folder per pull request
    context.md                     the form: what to watch, and what to do when it breaks
    test-configuration.md          results kept, skip after a failure, notifications
    check.config.json              what the assistant decided about the check
    run.mjs                        the check itself
    baseline/                      the captures a passing run is compared with
    results/<timestamp>/           one folder per run, the newest kept
    found-issue/MM-DD-YYYY/        failure reports
    proposed-solution/MM-DD-YYYY/  plans that fix them
    logs/, schedule/, repo/        the run log, the schedule files, the code under test
  automate-pr-sample-app/          the next pull request, in its own folder
```

A test folder is a check folder. `context.md` is its marker file and its source of truth: the tool finds a test folder by looking for that file in the current folder or above it, which is why most commands take no argument.

## Install

```sh
git clone https://github.com/jhauga/automate-merged-pr-check
cd automate-merged-pr-check
npm install
npm link
```

`npm link` puts `auto-check` on your PATH. You need Node.js 20.19 or newer, git, the GitHub CLI (`gh`, signed in), and one assistant command installed and signed in: Claude Code, GitHub Copilot CLI, or Codex. `auto-check doctor` reports all of it, along with your settings and your root folder.

## The first check

```sh
auto-check https://github.com/acme/demo-app/pull/123
```

The first run asks where test folders should live, and saves that answer. Then it suggests a folder name, writes the form, and, once the form is filled in, writes the check. Writing a check takes about an hour, because the assistant also runs it, repairs it, and proves it fails when it should.

To fill the form in first and start the work later, make the folder on its own:

```sh
auto-check --name automate-pr-demo-app --edit-context
cd <root folder>/automate-pr-demo-app
auto-check
```

A bare `auto-check` inside a test folder validates the form and then does the obvious next thing: write the check when there is none, or print where the test stands when there is one.

## The form decides the follow-up

```text
Find Issue -> Resolve Issue -> Commit Solution -> Local Commit -> Remote Push -> Make PR
```

Each step needs the one before it, and `context.md` turns them on one at a time. A fix is applied in a git worktree of your clone, so your own checkout, branch, and files are never touched. Nothing is pushed unless you asked for it, and no commit message or pull request text leaves the machine carrying a local path, an account name, or an email address.

## Settings are per user

Settings live in your own configuration folder, not in any repository. `auto-check config path` prints the file, and `auto-check.config.schema.json` in this repository describes every key.

```sh
auto-check config set root "C:\Users\<user>\Documents\auto-checks"   # Windows
auto-check config set root ~/auto-checks                            # macOS and Linux
auto-check config set assistant claude
auto-check config list
```

Secrets never go in the settings file: a setting names an environment variable, and the value comes from the environment or from a `.env` file beside the settings file.

## Where to go next

| Page | What it covers |
| --- | --- |
| [Quickstart](QUICKSTART.md) | The shortest path from an installed tool to a scheduled check. |
| [Cheatsheet](CHEATSHEET.md) | Every command, option, path, and exit code, in tables. |
| [Test folders](features/test-folders/index.md) | The root folder, folder names, the editor, and the guard. |
| [The context.md form](features/context-form/index.md) | Every field, every flag, and how the form is validated. |
| [test-configuration.md](features/test-configuration/index.md) | Results kept, skipping scheduled runs after a failure, and each test's notifications. |
| [Configuration](features/configuration/index.md) | Per-user settings, the schema, and secrets. |
| [Checks](features/checks/index.md) | Check kinds, the capability ladder, the contract, baselines, and motion pairs. |
| [Running and scheduling](features/running-and-scheduling/index.md) | What a run does, and the schedule on each platform. |
| [The failure pipeline](features/failure-pipeline/index.md) | Reports, proposed solutions, fix branches, and pull requests. |
| [Notifications](features/notifications/index.md) | Email, text messages, and webhooks. |
| [Assistants](features/assistants/index.md) | Commands, models, effort, skills, and permissions. |
| [Safety](features/safety/index.md) | The guard, the outbound checks, and every dry run. |

## Status

This is an alpha release. It is proven on Windows with Claude Code; the macOS and Linux schedules and the Codex adapter are written and unit tested but not yet run on those systems. The repository's `ROADMAP.md` says what each milestone needs.
