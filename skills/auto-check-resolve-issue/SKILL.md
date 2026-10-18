---
name: auto-check-resolve-issue
description: 'Apply an auto-check proposed solution in a local clone on a resolve-issue-<alias> branch, and write the commit message and the pull request text, following the repository''s CONTRIBUTING.md and keeping every outbound word free of local data. Use when auto-check asks you to apply a proposed solution or to write a pull request for a fix, or when someone asks to turn a proposed-solution.prompt.md into a branch.'
---

# auto-check: resolve the issue

After a check fails and a proposed solution exists, `auto-check resolve --issue` adds a git worktree of the local clone with the new branch `resolve-issue-<alias>` from the newest upstream base, and asks an assistant to apply the plan there, so the clone's own checkout is never touched. `auto-check resolve --pr` then asks for the pull request text and opens the pull request, or writes `proposed-solution/MM-DD-YYYY/resolve/pull-request.md` and `patch.diff` to open it by hand.

## When to use this skill

- auto-check gave you `resolve-issue.prompt.md` or `pull-request.prompt.md`. That prompt is the whole task; this skill only summarizes it.
- Someone asks to apply a `proposed-solution.prompt.md` in their clone.

## Steps for a fix

1. Read the repository's contributing guide, `.github/CONTRIBUTING.md`, `CONTRIBUTING.md`, or `docs/CONTRIBUTING.md`. Note what it says about branches, commit messages, sign-offs, version bumps, generated files, and the checks to run.
2. Read the proposed solution and carry out the steps that change files in the repository, following the ticked decisions. Leave steps outside the repository, such as refreshing an installed copy, for a person, and list them.
3. Keep the edits minimal: only what the fix and the contributing guide need, such as a version bump or a regenerated README table.
4. Run the checks the contributing guide names, and fix what they report.
5. Do not commit, push, switch branches, or change git settings. auto-check commits with the message you write, adds the sign-off when the guide asks for one, and pushes only to the user's fork when told to.
6. Write the commit message in the style of the repository's recent commits, and a summary of what you changed, what you ran, and what is left.

## Steps for a pull request

1. Write the title in the style of the repository's recent pull requests.
2. Write the body: what was broken, what the change does and why, and how it was tested. Fill in the repository's pull request template when it has one.
3. When asked for an issue, describe the failure for maintainers without the fix.

## Text that leaves the machine

Commit messages, changed files, and issue and pull request text are public. auto-check checks them and refuses to commit, push, or open anything that breaks these rules:

- No local paths, user names, account names, machine names, or email addresses.
- No narration of how the change was asked for, and nothing pasted from the failure report.
- Generic placeholders in examples: Jane Doe, `jane.doe@example.com`, Acme Corp, `example.com`.
- Plain sentences, never em dashes or en dashes.
