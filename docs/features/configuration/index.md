---
title: Configuration
parent: Features
nav_order: 4
has_children: true
---

# Configuration

Settings are per user, not per repository and not per test. They live in your own configuration folder, so one installed tool serves every test folder on the machine.
{: .fs-5 .fw-300 }

```sh
auto-check config path
```

| Platform | File |
| --- | --- |
| Windows | `%APPDATA%\auto-check\config.json` |
| macOS | `~/Library/Application Support/auto-check/config.json` |
| Linux | `$XDG_CONFIG_HOME/auto-check/config.json`, or `~/.config/auto-check/config.json` |

Set `AUTO_CHECK_CONFIG_DIR` to use another folder. Every test in this repository's own suite does that, so running the tests never reads or writes your settings.

## Reading and writing

```sh
auto-check config list                       # every key, with defaults marked
auto-check config get root
auto-check config set root ~/auto-checks
auto-check config set notify.email.enabled true
auto-check config unset models.claude.effort
auto-check config path
```

`set` takes a dotted key and a value, and writes the file atomically. A value is read as JSON when it looks like JSON, so `true`, `14`, and `["jane.doe@example.com"]` arrive as a boolean, a number, and an array. Anything else is a string. `unset` removes a key, and the default applies again.

You can edit the file by hand. `auto-check.config.schema.json` in your clone of this repository describes every key, so an editor that understands JSON Schema completes and checks the file as you type. Point `$schema` at that file:

```json
{
  "$schema": "file:///C:/Users/<user>/clones/automate-merged-pr-check/auto-check.config.schema.json",
  "root": "C:\\Users\\<user>\\Documents\\auto-checks",
  "assistant": "claude"
}
```

A file that does not fit the schema is reported by `auto-check doctor`, with the key and the reason.

## What each group does

| Group | What it decides |
| --- | --- |
| `root` | The folder that holds every test folder. |
| `assistant`, `models`, `assistants` | Which assistant runs, with which model, effort, skills folder, and permission mode, when a form names none. See [Assistants](../assistants/index.md). |
| `notify` | Which outcomes notify, and on which channels. See [Notifications](../notifications/index.md). |
| `schedule` | When checks run on each platform. See [Running and scheduling](../running-and-scheduling/index.md). |
| `results.keep` | How many run folders a test keeps when its `test-configuration.md` does not say, 14 by default. Baseline, simulated, and generate-try folders are never counted or deleted. |
| `repos` | The clone used when a form names none, the remote names, and the prefix of fix branches. See [The failure pipeline](../failure-pipeline/index.md). |

## Settings, form, and command line

Three places can decide the same thing. The most specific wins:

```text
command line  ->  context.md  ->  settings  ->  built-in default
```

For example, the assistant that writes a check is `--assistant` if you passed it, else the form's `Command`, else the `assistant` setting, else `claude`. The clone a fix goes into is the form's `Local Repository`, else the one the check recorded, else `repos.localRepo`.

A check records what it resolved in its own `check.config.json`, so a run years later uses what the check was built with, not whatever your settings say that day.

## Secrets

No secret ever goes in the settings file. A setting names an environment variable, and the value comes from the environment:

```json
"smtp": { "host": "smtp.example.com", "port": 587, "user": "demo-user", "passwordEnv": "AUTO_CHECK_SMTP_PASSWORD" },
"webhook": { "url": "https://ntfy.example.com/auto-check", "secretEnv": "AUTO_CHECK_WEBHOOK_SECRET" }
```

At start-up the tool reads a `.env` file beside the settings file, without overriding a variable that is already set:

```sh
AUTO_CHECK_SMTP_PASSWORD=app-password-here
AUTO_CHECK_WEBHOOK_SECRET=webhook-secret-here
```

`.env.example` in this repository lists the names. `auto-check doctor` reports whether each named variable is set, never its value.

## Checking the machine

```sh
auto-check doctor
```

It reports Node.js, git, `gh` and its sign-in, every assistant command it can find and whether it is signed in, the browser, the settings file and anything in it that does not fit the schema, the root folder, the environment variables the settings name, and the tool's own skills. It is the first thing to run when something behaves oddly, and the first thing to paste into an issue.
