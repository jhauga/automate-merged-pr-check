---
title: Features
nav_order: 4
has_children: true
---

# Features

Each feature has three pages: a verbose page that explains it, a quickstart that gets you through it, and a cheatsheet for when you already know it.
{: .fs-5 .fw-300 }

| Feature | What it covers |
| --- | --- |
| [Test folders](test-folders/index.md) | The root folder, one folder per pull request, folder names, the editor, and the guard that keeps test folders out of the wrong places. |
| [The context.md form](context-form/index.md) | The marker file of a test folder: every field, every flag, how it is validated, and what never goes in it. |
| [test-configuration.md](test-configuration/index.md) | How many results a test keeps, skipping its scheduled runs after a failure, and whether, when, and from which account it notifies. |
| [Configuration](configuration/index.md) | Per-user settings, the JSON Schema that describes them, and secrets through environment variables. |
| [Checks](checks/index.md) | What a check is, the kinds the tool recognizes, the capability ladder, the contract every check keeps, baselines, comparisons, and motion pairs. |
| [Running and scheduling](running-and-scheduling/index.md) | What one run does, the exit codes, the schedule on Windows, macOS, and Linux, staggering, and the machine-wide lock. |
| [The failure pipeline](failure-pipeline/index.md) | Everything after a failing run: reports, repeats, proposed solutions, fix branches in a worktree, pushes, and pull requests. |
| [Notifications](notifications/index.md) | Email, carrier text messages, and webhooks, with secrets kept out of the settings file. |
| [Assistants](assistants/index.md) | Claude Code, GitHub Copilot CLI, and Codex: how each is started, model and effort resolution, skills, and permissions. |
| [Safety](safety/index.md) | The guard, what the tool never does, the outbound checks on anything that leaves the machine, and every dry run. |

## How they fit together

```text
auto-check <pr-url>
  |
  +-- test folder          one folder per pull request, under your root
        |
        +-- context.md               the form: assistant, pull request, clone, follow-up flags
        |
        +-- test-configuration.md    results kept, skip after a failure, notifications
        |
        +-- check          written by an assistant, proved by the harness, baselined
              |
              +-- schedule   a daily run on this machine, skipped while the last run failed
                    |
                    +-- pass     a result folder, the oldest past the count deleted
                    |
                    +-- fail     the failure pipeline, as far as the form allows
                          |
                          +-- report -> plan -> branch -> push -> pull request
```
