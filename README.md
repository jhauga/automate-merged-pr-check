<p align="center">
  <img src="docs/assets/images/logo.svg" alt="auto-check" width="268" height="64">
</p>

# automate-merged-pr-check

- `Ctrl + click` to read the [docs](https://jhauga.github.io/automate-merged-pr-check/)

Helps you be a responsible contributor: an AI coding assistant writes an automated, scheduled test that keeps checking that a merged pull request still works as expected, and that its documentation still works as documented.

You contributed something, it was merged, and the repository moved on. `auto-check` turns that pull request into a check that runs on its own, on a schedule, against the newest commit of the base branch. When the change stops working, you hear about it, with a report that says what broke and what changed since the last time it passed.

- **One test, one folder.** Each pull request gets its own folder with its form, its check, its baseline, and its results. The folders live under a root folder you pick once, outside this repository.
- **An assistant writes the check.** Claude Code, GitHub Copilot CLI, or Codex writes it, and auto-check verifies it: the check must fail when the subject is replaced with a black picture, and its captures must move when the subject is meant to move.
- **A failure can carry on by itself.** A form in each test folder decides how far a failure goes: a report, a proposed fix, a branch in a local clone, a push, a pull request.

## Install

```sh
git clone https://github.com/jhauga/automate-merged-pr-check
cd automate-merged-pr-check
npm install
npm link
```

`npm link` puts `auto-check` on your PATH, so you run it from anywhere. You need Node.js 20.19 or newer, git, the GitHub CLI (`gh`, signed in), and one assistant command installed and signed in. `auto-check doctor` checks all of it.

## First run

```sh
cd ~/Documents
auto-check https://github.com/acme/demo-app/pull/123
```

```text
No root folder is configured to hold the test folders.
Enter the folder where test folders should be created. To use the current folder, enter ".".
> auto-checks
No -n, --name was given. What should the test folder be called? [automate-pr-sample-canvas]
> automate-pr-sample-canvas
Root: /home/<user>/Documents/auto-checks (saved in the auto-check user settings)
Test folder: /home/<user>/Documents/auto-checks/automate-pr-sample-canvas
Wrote: context.md, .gitignore
```

From there the assistant reads the pull request, writes the check in that folder, and auto-check verifies it, captures the baseline, and installs a scheduled task named `auto-check automate-pr-sample-canvas`. A first run takes about an hour, most of it the assistant's.

## Three ways to start a test

```sh
# 1. Ask, then write the check in one go.
auto-check https://github.com/acme/demo-app/pull/123

# 2. Name the folder, fill in the form in your editor, then write the check.
auto-check https://github.com/acme/demo-app/pull/123 --name automate-pr-sample-canvas --edit-context

# 3. Make the folder now, fill in the form when you are ready, then run it bare.
auto-check --name automate-pr-sample-canvas
cd ~/Documents/auto-checks/automate-pr-sample-canvas
auto-check
```

A bare `auto-check` inside a test folder checks the form rule by rule before it does anything:

```text
A.I. Tool        claude 2.1.261, signed in; model Opus 5.5 (runs as opus); effort xhigh   pass
Test folder      automate-pr-sample-canvas is the current folder                          pass
Root             /home/<user>/Documents/auto-checks, the configured root                  pass
Merged PR        acme/demo-app#123, merged                                                pass
Local repo       /home/<user>/clones/demo-app                                             pass
PR Context       provided; passed to the assistant                                        pass
Find Issue       true
Resolve Issue    true
Commit Solution  true: Local Commit true, Remote Push false, Make PR false (Remote Push is false)
```

With no check in the folder yet, it writes one. With a check already there, it reports where the test stands and what to run next.

## The form

`context.md` in each test folder is the source of truth for that test: which assistant and model write and fix the check, which pull request it watches, what working and broken look like, and how far a failure goes.

```md
## A.I. Tool

- Command: claude
- Model: Opus 5.5
- Thinking Effort: xhigh

## Test Context

- **Test folder root**: /home/<user>/Documents/auto-checks
- **Test folder name**: automate-pr-sample-canvas
- **Merged PR URI**: https://github.com/acme/demo-app/pull/123
- **Local Repository**: /home/<user>/clones/demo-app
- **PR Context**: A drawing surface rendered in the side panel of Sample App.
- **Find Issue**: true
- **Resolve Issue**: true
- **Commit Solution**: true
  - **Local Commit**: true
  - **Remote Push**: false
```

Every run reads it again, so turning a step on or off takes an edit, not a reinstall. `auto-check context validate` prints the report above without changing anything.

## Commands

| Command | What it does |
| --- | --- |
| `auto-check <pr-url>` | Make a test folder for a pull request and write its check. |
| `auto-check --name <folder>` | Make the folder and its form, and stop there. |
| `auto-check` | In a test folder: check the form, then write the check or report where it stands. |
| `auto-check run [<folder>]` | Run the check now, as the schedule does. |
| `auto-check inspect <pr-url>` | What auto-check makes of a pull request: its kind, its parts, its watched paths. |
| `auto-check context validate` | Check the form, rule by rule. |
| `auto-check schedule install\|remove\|status` | The scheduled task of one test. |
| `auto-check resolve [--propose\|--issue\|--pr]` | Carry a failure further by hand. |
| `auto-check notify test` | Send a test notification through the enabled channels. |
| `auto-check config get\|set\|unset\|list\|path` | Your settings: the root folder, the assistant, the models, notifications. |
| `auto-check setup --assistant <name>` | Pick the assistant auto-check drives. |
| `auto-check doctor` | What this machine has, what the settings say, and what is missing. |

`auto-check --help` lists every option, and `auto-check <command> --help` lists one command's.

## Settings

Settings are per user, not per repository. `auto-check config path` prints the file.

```sh
auto-check config set root "C:\Users\<user>\Documents\auto-checks"   # Windows
auto-check config set root ~/auto-checks                            # macOS and Linux
auto-check config set assistant claude
auto-check config set notify.email.enabled true
```

Secrets stay out of the settings: a setting names an environment variable, and the value comes from the environment or from a `.env` file beside the settings file.

## What a failure can do

```text
Find Issue -> Resolve Issue -> Commit Solution -> Local Commit -> Remote Push -> Make PR
```

Each step needs the one before it, and the form turns them on one at a time. A fix is applied in a git worktree of your clone, so your own checkout, branch, and files are never touched. Nothing is pushed unless you asked for it, and no commit message or pull request text leaves the machine with a local path, an account name, or an email address in it.

## Documentation

- The site: <https://jhauga.github.io/automate-merged-pr-check/>
- Quickstart: [docs/QUICKSTART.md](docs/QUICKSTART.md)
- Cheatsheet: [docs/CHEATSHEET.md](docs/CHEATSHEET.md)
- Features, each with its own quickstart and cheatsheet: [docs/features/](docs/features/index.md)

## License

MIT. See [LICENSE](LICENSE).
