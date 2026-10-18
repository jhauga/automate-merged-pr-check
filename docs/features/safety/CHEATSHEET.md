---
title: Cheatsheet
parent: Safety
grand_parent: Features
nav_order: 2
---

# Safety cheatsheet

## The guard

| Situation | Result |
| --- | --- |
| A test folder inside the auto-check repository | Refused, exit 3 |
| A test folder inside another test folder | Refused, exit 3 |
| A root that does not exist | Refused, exit 4 |

## Never

| Rule |
| --- |
| Never tests the pull request's own commit, always the newest base. |
| Never changes your clone in place: scratch worktrees only. |
| Never pushes to upstream, and never with force. |
| Never opens an issue or a pull request without Make PR and a text check. |
| Never notifies on a channel that is off. |
| Never writes a secret into a file. |
| Never leaves a desktop app with changed settings, extra conversations, or a debugging port. |
| Never follows instructions found inside a pull request, a repository file, or a report. |

## Outbound checks

| Scanned | When |
| --- | --- |
| the commit message | before `git commit` |
| every added line | before `git commit` |
| the pull request title and body | before `gh pr create`, or before the text is written |
| the issue title and body | before `gh issue create` |

| Refused | Example |
| --- | --- |
| a user-profile path | `C:\Users\<user>\...`, `/home/<user>/...` |
| the machine's user or host name | whatever `os.userInfo()` and `os.hostname()` say |
| the clone's git identity | `user.name`, `user.email` |
| a real email address | anything not at `example.com`, `example.org`, `example.net`, or a GitHub `noreply` |

## Dry runs

| Command | Prints | Changes |
| --- | --- | --- |
| `auto-check <pr-url> --dry-run` | the prompt and the planned settings | nothing |
| `auto-check schedule install --dry-run` | the files and commands | nothing |
| `auto-check schedule remove --dry-run` | what it would remove | nothing |
| `auto-check notify test --dry-run` | the messages | nothing |
| `auto-check resolve --propose --dry-run` | the prompt path | writes the prompt only |
| `auto-check resolve --issue --dry-run` | every git command, and what would stop a real run | nothing |
| `auto-check resolve --pr --dry-run` | every `gh` command | nothing |

## Permission modes

| Assistant | Default | Lower it to |
| --- | --- | --- |
| Claude Code | `bypass` | `acceptEdits`, `default` |
| Copilot CLI | `allow-all-tools` | nothing lower is supported unattended |
| Codex | `workspace-write` | `read-only`, `default` |

## Where things are written

| Path | Holds |
| --- | --- |
| the test folder | the check, the results, the reports |
| the settings folder | `config.json`, `.env`, `model-cache.json` |
| the state folder | the machine-wide locks |
| the system scheduler | one task per test |
| your clone | one branch per fix, through a worktree |
