---
title: Cheatsheet
parent: The failure pipeline
grand_parent: Features
nav_order: 2
---

# Failure pipeline cheatsheet

## The chain

| Flag | Needs | Writes or does |
| --- | --- | --- |
| `Find Issue` | nothing | `found-issue/MM-DD-YYYY/found-issue.md` |
| `Resolve Issue` | Find Issue | `proposed-solution/MM-DD-YYYY/proposed-solution.prompt.md` |
| `Commit Solution` | Resolve Issue, Local Repository | a worktree and the branch `resolve-issue-<alias>` |
| `Local Commit` | Commit Solution | the commit |
| `Remote Push` | Local Commit | `git push origin refs/heads/<branch>:refs/heads/<branch>` |
| `Make PR` | Remote Push | `gh pr create` against the upstream base |

## Commands

| Line | What it does |
| --- | --- |
| `auto-check resolve --propose` | Ask the assistant for the plan. |
| `auto-check resolve --issue` | Apply it on a branch, in a worktree, and commit. |
| `auto-check resolve --issue --push` | And push the branch to your fork. |
| `auto-check resolve --pr` | Open the pull request, or write the text to open it later. |
| `auto-check resolve --pr --push` | Push first, then open it. |
| `auto-check resolve <step> --dry-run` | Print every command, change nothing. |
| `auto-check` | Show whether a failure is open. |

## Files

| Path | Written by |
| --- | --- |
| `found-issue/MM-DD-YYYY/found-issue.md` | a failing run with Find Issue |
| `found-issue/MM-DD-YYYY/found-issue-2.md` | a second, different failure the same day |
| `proposed-solution/MM-DD-YYYY/proposed-solution.prompt.md` | `--propose` |
| `.../resolve/resolve-issue.prompt.md` | `--issue` |
| `.../resolve/commit-message.txt` | the assistant, for `--issue` |
| `.../resolve/resolve-issue.summary.md` | the assistant, for `--issue` |
| `.../resolve/pr-title.txt`, `pr-body.md` | the assistant, for `--pr` |
| `.../resolve/pull-request.md`, `patch.diff` | `--pr` without Make PR |
| `resolve-worktree/` | `--issue`, removed when it is done |

## The report

| Section | Holds |
| --- | --- |
| Check | Test folder, pull request, kind, watched paths. |
| Run | Finished at, outcome, exit code, code under test, result file, signature. |
| Observed and expected | Failed assertions, failed comparisons, captures beside the baseline. |
| What changed since the last pass | Upstream commits, machine differences, installed copy differences. |
| Context | What `context.md` says. |
| Your task | The ask for the plan. |

## Signatures

| Event | Effect |
| --- | --- |
| Same signature as the open failure | Repeat: no new report, no new notification. |
| New upstream commit, or a changed machine | New signature: a new report. |
| A pass | The open report is closed. |
| `--simulate-fail` | Its own memory under `state.simulated`, and the real history untouched. |

## Branch names

| Setting | Default |
| --- | --- |
| `repos.branchPrefix` | `resolve-issue-` |
| Name | `<prefix><alias>`, numbered when taken: `-2`, `-3` |
| Starts from | `<upstreamRemote>/<base>`, fetched first |
| Pushed to | `repos.originRemote`, only when it is a fork, never with force |
