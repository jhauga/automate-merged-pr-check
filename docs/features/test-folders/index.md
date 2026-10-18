---
title: Test folders
parent: Features
nav_order: 1
has_children: true
---

# Test folders

One pull request, one folder. Every test folder is a check folder: it holds the form that describes the test, the check an assistant wrote for it, the baseline, the results, and anything a failure produced.
{: .fs-5 .fw-300 }

## The root folder

Test folders live together under one root that you pick once, outside the tool's own repository:

```sh
auto-check config set root "C:\Users\<user>\Documents\auto-checks"   # Windows
auto-check config set root ~/auto-checks                            # macOS and Linux
auto-check config get root
```

If no root is set, the first run that needs one asks:

```text
Where should test folders live? [C:\Users\<user>\Documents\auto-checks]
```

The answer is saved, so the question is asked once. `--root <folder>` overrides it for a single command without saving anything.

A root must exist, and it must not be inside the tool's repository. The root itself is never a test folder: it only holds them.

## Making one

There are three ways, and they end in the same place.

### From a pull request

```sh
auto-check https://github.com/acme/demo-app/pull/123
```

The tool reads the pull request, suggests a folder name from the repository and the change, creates the folder under the root, writes `context.md` with the parts it already knows, and opens your editor so you can fill in the rest. When you close the editor it validates the form and, if the form passes, writes the check.

### The form first

```sh
auto-check --name automate-pr-demo-app --edit-context
```

This writes only `context.md` and `.gitignore`, with the root, the folder name, and `Find Issue: true` filled in. Nothing else happens, so you can fill in the form at your own pace, hand it to someone else, or keep it in version control. When it is ready:

```sh
cd <root>/automate-pr-demo-app
auto-check
```

### In a folder you already have

Run `auto-check` in a folder that already holds a `context.md`. The tool treats that folder as the test folder, whether or not it sits under the root.

## Folder names

A name must be a plain folder name: letters, digits, dots, dashes, and underscores, no path separators, and no leading dot. The suggested name is built from the repository and the subject of the pull request, in the shape `automate-pr-<subject>`, such as `automate-pr-demo-app`.

The name in the form and the name of the folder must agree. Renaming a folder means editing the `Test folder name` line to match, and `auto-check context validate` says so when they differ.

## What a new folder holds

Straight after `--name`:

```text
automate-pr-demo-app/
  context.md
  .gitignore
```

After a check has been written:

```text
automate-pr-demo-app/
  context.md                     the form
  check.config.json              what the assistant decided
  run.mjs                        the check
  package.json                   the check's own dependencies
  .auto-check/check-kit.mjs      the kit the check imports, stamped with the version
  AGENTS.md, CLAUDE.md           what an assistant reads here
  .claude/skills/auto-check-*    the tool's own skills, copied in for the named assistant
  baseline/                      the captures runs are compared with
  results/<timestamp>/           one folder per run
  repo/ or worktree/             the code under test
  logs/schedule.log              what scheduled runs printed
  schedule/                      the wrapper and the task definition
  state.json                     last run, last pass, open failure
  README.md                      what this check does, written with the check
```

Everything in the folder is plain: `node run.mjs --out results/manual` works without the tool.

## The marker file

`context.md` is what makes a folder a test folder. Commands that take `[<folder>]` look for it in the folder you are in, then in each folder above, so from anywhere inside a test folder these all work:

```sh
auto-check
auto-check run
auto-check schedule status
auto-check resolve --propose
```

You can also name a test folder from anywhere by its name under the root, or by a path:

```sh
auto-check run automate-pr-demo-app
auto-check run ../automate-pr-sample-app
```

## The editor

`--edit-context` opens the new form in your editor and waits. The editor is the first of these that is set: `VISUAL`, `EDITOR`, git's `core.editor`, then Notepad on Windows and `vi` elsewhere.

When the form still has problems and you are at a terminal, the tool prints them with line numbers and offers another round in the editor. With no terminal, as in a scheduled run, it prints the problems and stops instead of waiting for an answer that cannot come.

## The guard

The guard refuses two mistakes, both with exit code 3:

- A test folder inside the tool's own repository. The repository holds the tool, and nothing else.
- A test folder inside another test folder. Nested test folders would share results and schedules.

The guard compares folder paths, so nothing about your account or your machine is stored anywhere.

## Several tests on one machine

Each test folder is independent: its own form, its own check, its own schedule, its own results. Two tests that drive the same desktop app are kept apart by a machine-wide lock, and their schedules are staggered, so they do not fight over it. See [Running and scheduling](../running-and-scheduling/index.md).

## Removing a test

Remove its schedule first, then delete the folder:

```sh
auto-check schedule remove automate-pr-demo-app
rm -r <root>/automate-pr-demo-app
```

Deleting the folder without removing the schedule leaves a task that fails every night.
