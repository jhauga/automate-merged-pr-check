---
title: Quickstart
parent: Assistants
grand_parent: Features
nav_order: 1
---

# Assistants quickstart

```sh
auto-check doctor                      # which commands are installed and signed in
auto-check setup --assistant claude    # make one the default and check it
```

## Name one for a single test

In `context.md`:

```md
- Command: claude
- Model: Opus 5.5
- Thinking Effort: high
```

Then confirm the machine agrees:

```sh
auto-check context validate
```

```text
A.I. Tool  claude 2.1.261 (Claude Code), signed in; model Opus 5.5 (runs as opus); effort high  pass
```

## Name one for a single run

```sh
auto-check https://github.com/acme/demo-app/pull/123 --assistant copilot --model auto
```

## Change the models

```sh
auto-check config set models.claude.generate opus
auto-check config set models.claude.analyze opus
auto-check config set models.claude.testDriver haiku
```

`testDriver` runs every night. Keep it low cost.

## Sign in for scheduled runs

```sh
claude setup-token                     # prints a token
auto-check doctor                      # says whether the variable is set
```

Put the token in the environment of the account that runs the schedule, as `CLAUDE_CODE_OAUTH_TOKEN`.

## Ask a skill for help

Inside a test folder, start your assistant and ask in plain words:

```text
help me fill in context.md for this pull request
review run.mjs against the check contract
read found-issue/02-03-2026/found-issue.md and write the plan that fixes it
```

The four `auto-check-*` skills are already in the folder, in the right place for the assistant the form names.

## When the model is refused

```text
Claude Code 2.1.261 does not accept claude-opus-5-5
```

The tool falls back to the family alias and says so. To pin a new model, update the command first:

```sh
claude update
```
