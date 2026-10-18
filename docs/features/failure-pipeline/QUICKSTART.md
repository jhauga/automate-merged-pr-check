---
title: Quickstart
parent: The failure pipeline
grand_parent: Features
nav_order: 1
---

# Failure pipeline quickstart

```sh
auto-check run --simulate-fail black   # make a failure to look at
cat found-issue/*/found-issue.md       # read the report
auto-check resolve --issue --dry-run   # see what a fix would do
```

## Turn the chain on, one step at a time

In `context.md`:

```md
- **Find Issue**: true        # a report, and nothing else
- **Resolve Issue**: true     # and a plan that fixes it
- **Commit Solution**: true   # and a branch in your clone
  - **Local Commit**: true    # committed
  - **Remote Push**: false    # not pushed
  - **Make PR**: false        # no pull request
```

Then:

```sh
auto-check context validate
```

## Work an open failure by hand

```sh
auto-check                       # Open failure: found-issue/02-03-2026/found-issue.md
auto-check resolve --propose     # ask for the plan
auto-check resolve --issue       # apply it on resolve-issue-demo-app
git -C ~/clones/demo-app log -1 resolve-issue-demo-app
auto-check resolve --pr          # write the pull request text, or open it
```

## See everything before it happens

```sh
auto-check resolve --issue --dry-run
```

```text
Dry run: nothing in C:\Users\<user>\Documents\clones\demo-app was changed, and no command below was run.
Local clone: C:\Users\<user>\Documents\clones\demo-app
Branch: resolve-issue-demo-app, from upstream/main
Commands it would run:
  git -C ... fetch upstream +refs/heads/main:refs/remotes/upstream/main
  git -C ... worktree add -b resolve-issue-demo-app ...\resolve-worktree upstream/main
  Claude Code applies proposed-solution/02-03-2026/proposed-solution.prompt.md in ...
  git -C ...\resolve-worktree add -A
  git -C ...\resolve-worktree commit -F ...\commit-message.txt
  git -C ... worktree remove --force ...\resolve-worktree
A real run would stop here: There is no proposed solution for the open failure yet.
```

## Clean up a trial

```sh
rm -r found-issue proposed-solution
```

And remove the `simulated` block from `state.json` if you used `--simulate-fail`.

## When a step refuses

| Message | Means |
| --- | --- |
| `has no open failure` | Nothing failed, or the last pass closed the report. |
| `comes from a simulated run` | Only a real failure may change a clone. A dry run still shows the commands. |
| `There is no proposed solution ... --propose first` | Run `auto-check resolve --propose`. |
| `No local clone of acme/demo-app is known` | Fill in Local Repository, or set `repos.localRepo`. |
| `The commit would carry local data` | The staged change holds a path, a name, or an address. Look at the worktree. |
| `already holds resolve-issue-demo-app` | The branch exists. The next run numbers it. |
