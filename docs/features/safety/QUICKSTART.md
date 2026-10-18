---
title: Quickstart
parent: Safety
grand_parent: Features
nav_order: 1
---

# Safety quickstart

```sh
auto-check resolve --issue --dry-run     # every command a fix would run
auto-check schedule install --dry-run    # every file a schedule would write
auto-check notify test --dry-run         # every message a channel would send
```

Nothing above changes anything.

## Keep a failure on the machine

In `context.md`:

```md
- **Find Issue**: true
- **Resolve Issue**: false
```

A failing run writes a report, and nothing reaches any repository.

## Let it fix, but not publish

```md
- **Commit Solution**: true
  - **Local Commit**: true
  - **Remote Push**: false
  - **Make PR**: false
```

A branch appears in your clone. Nothing is pushed, and no pull request is opened.

## Confirm your clone is untouched

```sh
git -C ~/clones/demo-app status --short
git -C ~/clones/demo-app branch --show-current
git -C ~/clones/demo-app worktree list
```

The branch you were on, a clean tree, and no leftover worktree. A fix lives on `resolve-issue-<alias>`, which you can delete:

```sh
git -C ~/clones/demo-app branch -D resolve-issue-demo-app
```

## Lower what an assistant may do

```sh
auto-check config set assistants.claude.permissionMode acceptEdits
```

Scheduled runs may then stop to ask, which means they may not finish.

## Check what would leave the machine

The tool scans the commit message, the added lines, and the pull request text for local paths, your user and host names, the git identity of the clone, and real email addresses. To see that working, put a path into a plan and run:

```sh
auto-check resolve --issue
```

It stops before committing and leaves the change staged in `resolve-worktree/` for you.

## Stop everything

```sh
auto-check schedule remove
```

No further runs. The folder, its results, and its reports stay where they are.
