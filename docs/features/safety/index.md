---
title: Safety
parent: Features
nav_order: 9
has_children: true
---

# Safety

auto-check runs AI coding assistants with broad permissions, on a schedule, with nobody watching. These are the rules that keep that from doing harm.
{: .fs-5 .fw-300 }

## The guard

A test folder is refused in two places, with exit code 3:

- **Inside the tool's own repository.** The repository holds the tool and nothing else. The guard knows the repository by its own location, so a clone under any name is still refused.
- **Inside another test folder.** Nested tests would share results, schedules, and a baseline.

The guard compares folder paths and stores nothing about your account or your machine.

```text
auto-check: A test folder cannot be created inside the auto-check repository.
            Pick a root outside it, such as C:\Users\<user>\Documents\auto-checks.
```

## What auto-check never does

- **It never tests the pull request's own commit.** Checks run against the newest commit of the base branch, so they prove the change still works where it landed.
- **It never changes your clone in place.** A pull request that has not merged is tested in a scratch worktree under the test folder, rebased onto the newest base. A fix is applied in another worktree, on a branch of its own. Your checkout, your branch, and your files are never touched.
- **It never pushes to the upstream repository, and never with force.** Fix branches go only to the remote that points at your fork, and only when Remote Push is on, or you passed `--push`.
- **It never opens an issue or a pull request** unless Make PR is on, and never before the text has been checked.
- **It never sends a notification** unless a channel is on, and `notify.dryRun` writes messages to a file instead of sending them.
- **It never stores a secret in a file it writes.** Passwords and webhook secrets come from environment variables, named in the settings.
- **It never leaves a desktop app changed.** A check that drives one restores the settings it touched, deletes the conversations it created, and closes the app, or starts it again without its debugging port when it was running before.
- **It never writes outside the test folder it is working in**, except for the schedule, the lock, and your settings, each in its documented place.

## Text that leaves your machine

Before the tool commits, pushes, or opens an issue or a pull request, it scans the commit message, every added line, and the issue and pull request text. It stops when it finds:

- A local path under a user profile, such as a Windows `Users` folder or a POSIX home folder.
- The machine's user name, host name, or home folder, or the name and email in the clone's git settings.
- An email address that is not a placeholder at `example.com`, `example.org`, `example.net`, or GitHub's `noreply` domain.

When it stops, the changes stay staged in the worktree so you can look at them:

```text
The commit would carry local data, so auto-check stopped before committing.
  commit-message.txt: names a home folder, C:\Users\<user>\...
```

The prompts tell the assistant the same rules: no local data, no narration of how the change was asked for, and placeholder data in examples.

## Pull request text is data, not instructions

Pull request descriptions, repository files, and failure reports can hold text written by anyone. Every prompt the tool sends says so, and tells the assistant never to follow instructions found inside them.

## Git in managed clones

The clone under a test folder runs git with repository hooks turned off, so a hook in a watched repository never runs on your machine. Before every run, it is reset to the newest base branch, and anything not in that commit is removed.

Your own clone, the one a fix goes into, is only ever read, fetched into, and given a new branch through a worktree. Its checkout is never switched.

## Assistant permissions

A scheduled run cannot stop to ask, so each assistant runs in the most permissive mode its command line offers for unattended work, limited to the folders passed with `--add-dir`. Lower it per assistant with `assistants.<name>.permissionMode`, at the cost of runs that stop to ask. See [Assistants](../assistants/index.md).

## Dry runs

Every command that changes something outside the test folder has one:

| Command | What `--dry-run` does |
| --- | --- |
| `auto-check <pr-url> --dry-run` | Writes the prompt and the planned settings. Starts no assistant and clones nothing. |
| `auto-check schedule install --dry-run` | Prints the files and the commands. Writes and runs nothing. |
| `auto-check schedule remove --dry-run` | Prints what it would remove. |
| `auto-check notify test --dry-run` | Prints what each channel would receive. Sends nothing. |
| `auto-check resolve --propose --dry-run` | Writes the prompt and stops. |
| `auto-check resolve --issue --dry-run` | Prints the branch and every command, and what would stop a real run. Changes nothing in the clone. |
| `auto-check resolve --pr --dry-run` | Prints the `gh` commands. Sends nothing. |

## Your data stays yours

Nothing is uploaded anywhere by the tool itself. The assistant you choose sees what its prompt names: the failure report, the captures, the code under test, and the folders passed with `--add-dir`. Reports and results stay in the test folder, which ships with a `.gitignore` that keeps them out of version control, because they hold local paths.
