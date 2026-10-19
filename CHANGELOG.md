# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-alpha.0.1.0] - 2026-10-19

### Added

- `test-configuration.md` in every test folder, beside `context.md`: how many
  run folders the test keeps, whether a scheduled run is skipped while the
  newest run failed, and the test's own notification switch, outcomes, and
  email account. A new test folder starts with seven runs kept, scheduled runs
  skipped after a failure, and no notifications.
- `auto-check run --scheduled`, which every schedule now passes. A scheduled run
  after a failed one is skipped with one line in the schedule log and exit code
  0; a run started by hand always runs, and when it does not fail the schedule
  goes ahead again. On Windows the test folder's `schedule\run.cmd` passes
  `--scheduled` itself, so a task of your own that calls it is gated too.
- A test's notifications can go from and to its own email account, on the mail
  server known for the address's domain or the one in the settings, with the
  password read from an environment variable at send time. The test folder's
  `.env` can hold it.
- The bare `auto-check` writes a missing `test-configuration.md`, validates both
  forms, and refreshes a test folder's instructions, skills, and schedule
  wrapper, leaving the scheduled task itself alone.
- `auto-check context validate test-configuration.md` checks the new file alone,
  and `auto-check context validate` with no path checks both forms.
- `auto-check doctor` inside a test folder reports its `test-configuration.md`
  and whether the password variable it names is set.

### Changed

- Only run folders count toward the number kept, and they are pruned before
  notifications are sent. Baseline, simulated, and generate-try folders are
  never deleted. The folder of the last pass is no longer kept past the count;
  the folder of an open failure is, until a pass closes it.
- A test's `test-configuration.md` overrides the notification settings and
  `results.keep` for that test.
- A schedule starts at the earliest time that keeps half an hour from every
  other test's task, and a test's own tasks never count against it.
- `run.mjs` and every assistant start without the variables that hold
  notification passwords and secrets, and a commit or pull request text that
  holds a test's notification address or password is refused.
- `nodemailer` is a dependency.

### Fixed

- Email never went out through the default account: its account file could not
  load, and the sender looked for it in the test folder instead of the tool's
  own notify folder.
- Installing a schedule again moved its start time after the other tests.
- A Windows task moved into a Task Scheduler folder was not found: staggering
  ignored it, and installing again made a second task at the root. It is now
  found in any folder and replaced, read, paused, and removed where it is.
- A task of your own for a test, with a command of its own, was reported by
  `auto-check doctor` as no longer pointing at a test folder. It is now
  recognized by its name.
- `auto-check run <folder>` started from another folder did not load that
  folder's `.env`.
- The Next run line of a bare `auto-check` showed the time a new schedule would
  get, not when the installed task runs next.
- Pruning could delete the result folder that an open failure report and
  `auto-check resolve` read.

## [1.0.0-alpha.0.0.1] - 2026-10-18

### Fixed

- The code under test is checked out with the line endings its repository
  stores, whatever the machine's git line-ending setting, so a check sees the
  same files on Windows as on any other system. A managed clone made before
  this change is cloned again once.
- A managed clone or worktree reached through another spelling of its folder,
  such as a Windows 8.3 short name or a linked folder, is recognized again: the
  managed clone is no longer cloned again on every run, and the worktree of an
  unmerged branch is removed cleanly, leaving the local clone as it was.

## [1.0.0-alpha.0.0.0] - 2026-10-18

The first alpha of `auto-check`, a command-line tool that turns a merged pull
request into a scheduled check.

### Added

- `auto-check <pr-url>` reads a pull request, works out whether and how it
  landed, classifies the change, and has an AI coding assistant write a check of
  it against the newest commit of its base branch. The check is held to a
  contract, made to fail on blank captures, and baselined, and frames meant to
  show motion must move well beyond noise.
- One test folder per pull request, under a root folder chosen once. A folder is
  a test folder because it holds `context.md`, the form that names the assistant,
  the pull request, the clone, and how far a failure carries on by itself.
- A bare `auto-check` inside a test folder: it validates the form, then writes
  the check when there is none, or prints where the test stands.
- Checks for pages, for canvases inside a desktop app, for command lines and
  libraries, for install procedures, and for reference documentation, chosen
  through a capability ladder.
- `auto-check run` refreshes the code under test, records the machine
  fingerprint, runs the check behind a machine-wide lock when it drives a
  desktop app, and compares the captures with the baseline by pixels, palette,
  liveness, text, or a composite of them.
- Schedules on Windows Task Scheduler, macOS launchd, and Linux systemd timers
  or cron, staggered so that tests on one machine do not collide.
- A failure pipeline driven by the form: a report with what changed since the
  last pass, a proposed solution, a fix applied on a branch in a git worktree of
  a local clone, a push to a fork, and a pull request, each behind its own flag.
- Notifications by email, carrier text message, and webhook, with every secret
  read from an environment variable.
- Per-user settings in the user's own configuration folder, described by
  `auto-check.config.schema.json`, with `auto-check config` and `auto-check
  doctor` to read and check them.
- Adapters for Claude Code, GitHub Copilot CLI, and Codex, with model names
  written plainly, resolved once per command version, and cached. Four
  `auto-check` skills are copied into each test folder.
- Guards that keep a test folder out of this repository and out of another test
  folder, a dry run for every outward step, and a scan that keeps local data out
  of anything that leaves the machine.
