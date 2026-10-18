---
title: Cheatsheet
parent: The context.md form
grand_parent: Features
nav_order: 2
---

# Form cheatsheet

## Fields

| Label | Required | Value | Empty means |
| --- | --- | --- | --- |
| `Command` | no | `claude`, `copilot`, `codex` | the `assistant` setting |
| `Model` | no | a model that command accepts | the `models.<assistant>.generate` setting |
| `Thinking Effort` | no | a level that command offers | the command's own default |
| `Test folder root` | no | an absolute path that exists | the `root` setting |
| `Test folder name` | yes | this folder's name | an error |
| `Merged PR URI` | yes | a pull request URL `gh` can read | an error |
| `Local Repository` | no | a clone of that repository | no clone, which Commit Solution needs |
| `PR Context` | no | a sentence, or a `### PR Context` section | the assistant sees only the pull request |

## Flags

| Label | Needs | Effect |
| --- | --- | --- |
| `Find Issue` | nothing | `found-issue/MM-DD-YYYY/found-issue.md` |
| `Resolve Issue` | Find Issue | `proposed-solution/MM-DD-YYYY/proposed-solution.prompt.md` |
| `Commit Solution` | Resolve Issue, Local Repository | a worktree and a `resolve-issue-<alias>` branch |
| `Local Commit` | Commit Solution | a commit on that branch |
| `Remote Push` | Local Commit | a push to `origin`, which must be a fork |
| `Make PR` | Remote Push | `gh pr create` against the upstream base |

Values: `true`, `false`, `yes`, `no`, any case. Absent or empty reads as false.

## Effort levels

| Command | Levels |
| --- | --- |
| `claude` | low, medium, high, xhigh, max |
| `copilot` | none, minimal, low, medium, high, xhigh, max |
| `codex` | set it in the Codex configuration instead |

## Model names

| You write | The tool runs |
| --- | --- |
| `Opus 5.5` | `claude-opus-5-5`, or the alias `opus` when the installed Claude Code refuses the full name |
| `opus`, `haiku` | the alias, unchanged |
| `Haiku 4.5` | `claude-haiku-4-5` |
| `auto` | Copilot's own choice |
| empty | the setting, then the command's default |

The first time a name is resolved, the tool asks the command whether it accepts it, and remembers the answer in `model-cache.json` beside your settings.

## Commands

| Line | What it does |
| --- | --- |
| `auto-check context validate` | Validate the form of the folder you are in. |
| `auto-check context validate <path>` | Validate another form, by path. |
| `auto-check` | Validate, then write the check or print the status. |
| `auto-check --name <folder> --edit-context` | Make a form and open it. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every rule passed. |
| 4 | A rule failed, or an argument was wrong. |

## Lines that are warnings, not errors

| Warning | Why |
| --- | --- |
| A clone whose remotes do not include the pull request's repository | It may be a fork whose remote is named differently. |
| A line that looks like a password or a token | The form reaches an assistant, so keep keys out of it. |
| A `Model` the command has not been asked about yet | The first run resolves it and caches the answer. |
