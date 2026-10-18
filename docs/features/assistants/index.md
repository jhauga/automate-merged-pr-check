---
title: Assistants
parent: Features
nav_order: 8
has_children: true
---

# Assistants

auto-check writes checks, proposes fixes, and applies them through an AI coding assistant. It supports Claude Code, GitHub Copilot CLI, and Codex, each behind one adapter, so changing assistants changes nothing else.
{: .fs-5 .fw-300 }

## Which one runs

```text
--assistant on the command line  ->  the form's Command  ->  the assistant setting  ->  claude
```

```sh
auto-check config set assistant claude          # for every test that names none
auto-check setup --assistant copilot            # set it and check it
auto-check https://github.com/acme/demo-app/pull/123 --assistant codex
```

In a test folder, the form decides:

```md
## A.I. Tool

- Command: claude
- Model: Opus 5.5
- Thinking Effort: xhigh
```

The check records what was resolved, so a run years later uses the command, model, and effort the check was built with.

## Models

Write the model the way a person would. The tool normalizes it, asks the command once whether it accepts it, and remembers the answer:

| You write | The tool tries | If refused |
| --- | --- | --- |
| `Opus 5.5` | `claude-opus-5-5` | the alias `opus` |
| `Haiku 4.5` | `claude-haiku-4-5` | the alias `haiku` |
| `opus`, `haiku` | the alias, unchanged | nothing to fall back to |
| `auto` | Copilot's own choice | nothing to fall back to |
| empty | the `models.<assistant>.generate` setting | the command's default |

The probe runs once per command version and is cached in `model-cache.json` beside your settings, so the hour-long generate step never spends its time finding out that a name is wrong. The validation line says what it settled on:

```text
A.I. Tool  claude 2.1.261 (Claude Code), signed in; model Opus 5.5 (runs as opus: Claude Code 2.1.261 does not accept claude-opus-5-5); effort xhigh  pass
```

Three roles take a model each:

| Role | Setting | Default |
| --- | --- | --- |
| `generate` | `models.<assistant>.generate` | `opus`, `auto`, empty |
| `analyze` | `models.<assistant>.analyze` | `opus`, `auto`, empty |
| `testDriver` | `models.<assistant>.testDriver` | `haiku`, `auto`, empty |

`testDriver` is the low-cost model a check uses while it runs, such as to ask a desktop app to open the subject. Keep it cheap: it runs every night.

## Thinking effort

| Command | Levels |
| --- | --- |
| `claude` | low, medium, high, xhigh, max |
| `copilot` | none, minimal, low, medium, high, xhigh, max |
| `codex` | not passed; set it in the Codex configuration |

An effort the command does not offer is refused by `auto-check context validate`, with the levels it does offer.

## How each one is started

| Assistant | Command line | Prompt |
| --- | --- | --- |
| Claude Code | `claude --print [--model <id>] [--effort <level>] [--output-format json] [--name <name>] [--session-id <uuid>] [--resume <id>] <permission flags> --add-dir <folder>...` | On standard input. Attached files are listed at the end, and their folders are added with `--add-dir`. |
| GitHub Copilot CLI | `copilot -p "<pointer>" --allow-all-tools (-s or --output-format json) [--model <id> [--auto-tier <tier>]] [--reasoning-effort <level>] [--name <name>] [--session-id <id>] [--resume <name>] --add-dir <folder>... --attachment <file>...` | A one-line pointer to the prompt file, which keeps long prompts off the command line. |
| Codex | `codex --add-dir <folder>... exec [--sandbox <mode>] [--model <id>] [--image <file>...] -` | On standard input. Images go through `--image`; other files are listed in the prompt. |

On Windows, npm installs Copilot CLI as a `.cmd` shim. The tool starts the script behind the shim with Node directly, which avoids the length and quoting limits of `cmd.exe`.

When `auto-check` itself runs inside a Claude Code session, the variables that session sets for its children, such as its session id and its link to the editor, are removed before Claude Code starts, so the assistant gets a clean session of its own.

## Skills

The tool ships four skills of its own. They live once, in `skills/` in this repository, and a generate copies them into the test folder, into the skills folder of the assistant that test names:

| Skill | Use it to |
| --- | --- |
| `auto-check-context` | Fill in, review, or explain the `context.md` form of a test folder. |
| `auto-check-write-check` | Write, repair, or review the check in a test folder, following the contract and the ladder. |
| `auto-check-propose-solution` | Find the cause of a failing check and write the plan that fixes it. |
| `auto-check-resolve-issue` | Apply a proposed solution on a branch in a local clone, and write the commit message and pull request text with no local data in them. |

Each assistant finds them in its own folder, so in a test folder you can simply ask:

```text
help me fill in context.md for this pull request
```

| Assistant | Project skills | Project instructions |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `CLAUDE.md`, which imports `AGENTS.md` |
| GitHub Copilot CLI | `.github/skills/`, `.agents/skills/`, `.claude/skills/` | `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` |
| Codex | `.agents/skills/` | `AGENTS.md` |

A test folder also gets its own `AGENTS.md` and `CLAUDE.md`, which tell an assistant started there to treat the prompt file as the whole task, stay inside the folders it names, never push or open a pull request unless asked, and keep local data out of anything that leaves the machine.

## Permissions

A scheduled run has nobody at the keyboard, so each assistant runs in the most permissive mode its command line offers for unattended work, limited to the folders passed with `--add-dir`:

| Setting | Assistant | Flags |
| --- | --- | --- |
| `bypass` (default) | Claude Code | `--dangerously-skip-permissions` |
| `acceptEdits` | Claude Code | `--permission-mode acceptEdits` |
| `allow-all-tools` (default) | GitHub Copilot CLI | `--allow-all-tools` |
| `workspace-write` (default) | Codex | `--sandbox workspace-write` |
| `read-only`, `danger-full-access` | Codex | `--sandbox read-only`, `--sandbox danger-full-access` |
| `default` | Claude Code, Codex | no flag |

Lower it with `auto-check config set assistants.claude.permissionMode acceptEdits`, at the cost of runs that stop to ask.

## Signing in

| Assistant | At the keyboard | For scheduled runs |
| --- | --- | --- |
| Claude Code | `claude auth login` | `claude setup-token`, then set `CLAUDE_CODE_OAUTH_TOKEN` for the account that runs the schedule |
| GitHub Copilot CLI | `copilot login` | the same sign-in, kept for the account |
| Codex | `codex login` | the same sign-in, kept for the account |

A session signed in inside an editor does not sign in the command-line assistant. auto-check always starts the command line, so sign that in too. `auto-check doctor` reports a command that is installed but not signed in.

## Codex status

The Codex adapter follows the published Codex reference, and has not yet been run against an installed Codex. It passes no reasoning effort, and does not name or resume sessions.
