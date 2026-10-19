---
title: The failure pipeline
parent: Features
nav_order: 7
has_children: true
---

# The failure pipeline

What happens after a run fails, and how far it goes, is decided by the flags in that test's own `context.md`. Nothing in the chain happens unless the flag above it is on.
{: .fs-5 .fw-300 }

```text
Find Issue -> Resolve Issue -> Commit Solution -> Local Commit -> Remote Push -> Make PR
```

## Find Issue: the failure report

A failing run with `Find Issue: true` writes `found-issue/MM-DD-YYYY/found-issue.md`, in local time. It is written for an AI coding assistant and reads fine for a person:

- **Check**: the test folder, the pull request, its kind, and the watched paths.
- **Run**: when it finished, the outcome and exit code, the code under test, the result file, and the failure signature.
- **Observed and expected**: the assertions that failed, the comparisons that failed, and this run's captures beside the baseline's.
- **What changed since the last pass**: the upstream commits that touched the watched paths, the machine settings that differ (operating system build, Node.js, browser, tools, desktop app version), and, when the subject has an installed copy, the files where it differs from the code under test.
- **Context**: what `context.md` says about the change.
- **Your task**: an ask to find the cause and write the plan that fixes it.

With `Find Issue: false`, a failing run says so and writes nothing:

```text
Failure report: not written. Set Find Issue to true in context.md to keep one.
```

### Repeats

A failure with the same signature as the open one is a repeat. The signature covers what failed, the upstream commit, and the machine fingerprint, so a new commit or a changed machine makes a new signature. A repeat writes no new report and sends no new notification:

```text
Failure report: unchanged, found-issue/02-03-2026/found-issue.md
Notification: already notified for this failure.
```

The first pass after a failure closes the open report.

### Two failures in one day

A second failure on the same day, for a different reason, numbers its report: `found-issue-2.md`, with `proposed-solution-2.prompt.md` beside it. The day folder keeps them in order.

## Resolve Issue: the plan

With `Resolve Issue: true`, a real failure that is not a repeat asks the assistant for `proposed-solution/MM-DD-YYYY/proposed-solution.prompt.md`. The assistant reads the report, the captures, the code under test, and your clone, and changes none of them.

The plan has a shape the tool checks, because another assistant has to carry it out:

- Frontmatter with a one-line description, and a title.
- An opening paragraph that names the `CONTINUE? Y or N` and `TASK COMPLETE!` markers, so the plan can be run phase by phase.
- **Evaluation**, with **Root cause** and **Ruled out**.
- **Decisions**, each with its recommended option ticked, or a line saying there are none.
- **Phases**, each ending with checks.

When parts are missing, the assistant gets one repair round. To ask for a plan by hand, for the open failure:

```sh
auto-check resolve --propose
```

A simulated failure never asks for a plan on its own:

```text
Proposed solution: not asked for a simulated failure. Run auto-check resolve with --propose to try it.
```

## Commit Solution: the fix branch

With `Commit Solution: true` and `Local Commit: true`, the plan is applied in your clone, on a branch of its own, in a git worktree:

1. The clone and its remotes are found: the remote that points at the pull request's repository, which the branch starts from, and `origin`, which must be your fork for anything to be pushed.
2. The newest base branch is fetched from that remote.
3. A worktree is added under the test folder, on a new branch `resolve-issue-<alias>`, from the fetched base. A name that is taken gets a number: `resolve-issue-demo-app-2`.
4. The contributing guide of the clone is read, and what it asks for is passed to the assistant, which makes the change in the worktree, runs the repository's checks, and writes the commit message.
5. The commit message and every added line are scanned for local data. Anything found stops the commit, and the changes stay staged in the worktree for you to look at.
6. The commit is made, with a sign-off when the contributing guide asks for one.
7. The worktree is removed. The branch stays in your clone.

Your own checkout, your branch, and your files are never touched, and the clone is never left on another branch.

```sh
auto-check resolve --issue
auto-check resolve --issue --dry-run
```

A dry run changes nothing and prints every command it would run, plus anything that would stop a real run, such as a failure that was simulated or a plan that has not been written yet.

## Remote Push and Make PR

With `Remote Push: true`, the branch is pushed to `origin`, only to your fork, and never with force. With `Make PR: true`, the assistant writes the pull request title and body, both are scanned for local data, and `gh` opens the pull request against the upstream base branch from your fork's branch.

Without `Make PR`, the tool writes `proposed-solution/MM-DD-YYYY/resolve/pull-request.md` with the title, the body, the branch, the compare link, the exact `git push` and `gh pr create` commands, and the contributing guide's checklist, plus `patch.diff`. You open it when you are ready.

```sh
auto-check resolve --pr
auto-check resolve --pr --push
auto-check resolve --pr --dry-run
```

## Doing it by hand

Every step is available on its own, whatever the flags say, so you can run the chain once without turning it on for every night:

```sh
auto-check resolve --propose          # ask for the plan
auto-check resolve --issue            # apply it on a branch
auto-check resolve --issue --push     # and push the branch
auto-check resolve --pr               # open the pull request, or write the text
```

Each one works on the open failure of that test folder, which `auto-check` lists as `Open failure`.

## What the folders look like

```text
automate-pr-demo-app/
  found-issue/
    02-03-2026/
      found-issue.md
  proposed-solution/
    02-03-2026/
      proposed-solution.prompt.md
      resolve/
        resolve-issue.prompt.md
        commit-message.txt
        resolve-issue.summary.md
        pull-request.prompt.md
        pr-title.txt, pr-body.md
        pull-request.md, patch.diff
```

These folders hold local paths, so a test folder's `.gitignore` keeps them out of version control.
