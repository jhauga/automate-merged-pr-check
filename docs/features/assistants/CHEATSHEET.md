---
title: Cheatsheet
parent: Assistants
grand_parent: Features
nav_order: 2
---

# Assistants cheatsheet

## Who decides

```text
--assistant  ->  context.md Command  ->  assistant setting  ->  claude
--model      ->  context.md Model    ->  models.<assistant>.<role>  ->  the command's default
```

## Commands

| Assistant | Command | Skills folder | Instructions |
| --- | --- | --- | --- |
| Claude Code | `claude` | `.claude/skills/` | `CLAUDE.md` |
| GitHub Copilot CLI | `copilot` | `.github/skills/`, `.agents/skills/`, `.claude/skills/` | `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` |
| Codex | `codex` | `.agents/skills/` | `AGENTS.md` |

## Roles and models

| Role | Setting | Default | Used for |
| --- | --- | --- | --- |
| generate | `models.<assistant>.generate` | `opus`, `auto`, empty | writing the check |
| analyze | `models.<assistant>.analyze` | `opus`, `auto`, empty | proposing and applying fixes |
| testDriver | `models.<assistant>.testDriver` | `haiku`, `auto`, empty | driving the subject during a run |

## Effort

| Command | Levels | Flag |
| --- | --- | --- |
| `claude` | low, medium, high, xhigh, max | `--effort` |
| `copilot` | none, minimal, low, medium, high, xhigh, max | `--reasoning-effort` |
| `codex` | not passed | set it in the Codex configuration |

## Permission modes

| Setting | Assistant | Flag |
| --- | --- | --- |
| `bypass` | Claude Code | `--dangerously-skip-permissions` |
| `acceptEdits` | Claude Code | `--permission-mode acceptEdits` |
| `allow-all-tools` | Copilot CLI | `--allow-all-tools` |
| `workspace-write` | Codex | `--sandbox workspace-write` |
| `read-only` | Codex | `--sandbox read-only` |
| `danger-full-access` | Codex | `--sandbox danger-full-access` |
| `default` | Claude Code, Codex | none |

## Skills

| Skill | For |
| --- | --- |
| `auto-check-context` | the form |
| `auto-check-write-check` | the check |
| `auto-check-propose-solution` | the plan that fixes a failure |
| `auto-check-resolve-issue` | the branch, the commit message, the pull request text |

They live in `skills/` in this repository and are copied into each test folder by a generate.

## Signing in

| Assistant | At the keyboard | Unattended |
| --- | --- | --- |
| Claude Code | `claude auth login` | `claude setup-token`, then `CLAUDE_CODE_OAUTH_TOKEN` |
| Copilot CLI | `copilot login` | the same sign-in |
| Codex | `codex login` | the same sign-in |

## Lines

```sh
auto-check doctor                                   # installed, signed in, versions
auto-check setup --assistant copilot                # switch the default
auto-check config set models.claude.effort high     # effort when a form names none
auto-check context validate                         # what this test resolves to
```

## The model cache

| Where | `model-cache.json` beside your settings |
| --- | --- |
| Keyed by | command and version |
| Holds | the name that was accepted, and the reason a name was refused |
| Clear it | delete the file; the next run probes again |
