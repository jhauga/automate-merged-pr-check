# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
