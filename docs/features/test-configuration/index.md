---
title: test-configuration.md
parent: Features
nav_order: 3
has_children: true
---

# test-configuration.md

`test-configuration.md` sits beside `context.md` at the root of a test folder. Where the form says what the test is, this file says how it behaves once it runs on its schedule: how many results it keeps, whether a scheduled run is skipped after a failed one, and whether, when, and from which account it notifies.
{: .fs-5 .fw-300 }

The tool reads the file fresh every time it runs the test, so an edit takes effect on the next run, with nothing to reinstall.

## The file a new test folder starts with

```md
# Test Configuration

## Scheduled Test

- **Turn Off on Failed Test**: true
- **Keep Prior Results**: true
  - **Number of Test**: 7

## Send Notifications

- **Send Notifications**: false
  - **Notify when Test**: null
  - **Account Configuration**:
    - **Email**: null
    - **Password**: null
```

So a new test keeps its seven newest runs, stops running on its schedule after a failure until you look at it, and sends nothing.

`auto-check --name <folder>` and `auto-check <pr-url>` write this file with `context.md`. A bare `auto-check` writes it into an older test folder that has none, and says so. None of them ever replaces a file that is already there.

## The file as it ships

The tool keeps a commented copy in `templates/test-configuration.md`, which explains each field:

```md
# Test Configuration

## Scheduled Test

- **Turn Off on Failed Test**: <!-- true or false. If true, a scheduled run first reads result.json in the newest run folder under results/ and is skipped when that run failed; a run started by hand always runs. If false, every scheduled run runs. -->
- **Keep Prior Results**: <!-- true or false. If true, Number of Test sets how many run folders results/ keeps. If false, only the newest run folder is kept. -->
  - **Number of Test**: <!-- A whole number, 1 or more: how many YYYY-MM-DDTHH-mm-SS run folders results/ keeps. The oldest is deleted first. Baseline, simulated, and generate-try folders are never counted or deleted. -->

## Send Notifications

- **Send Notifications**: <!-- true or false. If true, the items below say when, and from which account, this test notifies. If false, this test sends no notification, and the items below are ignored. -->
  - **Notify when Test**: <!-- pass, fail, or both. -->
  - **Account Configuration**:
    - **Email**: <!-- The address that sends and receives: an environment variable such as %AUTO_CHECK_EMAIL% or $AUTO_CHECK_EMAIL, or the address itself. Leave null to use the email settings of auto-check config. -->
    - **Password**: <!-- An environment variable that holds the password, such as %AUTO_CHECK_EMAIL_PASSWORD% or $AUTO_CHECK_EMAIL_PASSWORD; set it in this folder's .env, which is git-ignored. Writing the password itself works, but every run warns about it. -->
```

Comments are hints the tool ignores. Labels match with or without `**`, and without regard to case.

## Fields

| Field | Takes | Empty or `null` means | Ignored when |
| --- | --- | --- | --- |
| Turn Off on Failed Test | `true`, `false` | `true` | never |
| Keep Prior Results | `true`, `false` | `true` | never |
| Number of Test | a whole number, 1 or more | `7` | Keep Prior Results is `false` |
| Send Notifications | `true`, `false` | `false` | never |
| Notify when Test | `pass`, `fail`, `both` | a problem, when Send Notifications is `true` | Send Notifications is `false` |
| Email | `%NAME%`, `$NAME`, `${NAME}`, or an address | the email channel of your settings | Send Notifications is `false` |
| Password | `%NAME%`, `$NAME`, `${NAME}`, or the password | a problem, when Email is set | Send Notifications is `false`, or Email is empty |

`Number of Tests` is read as `Number of Test`. A test folder without the file behaves as your settings say: `results.keep` decides what is kept, every scheduled run runs, and `notify` decides who hears about it.

## Keeping results

Every run writes a folder under `results/`, named for the moment it started, such as `2026-02-03T03-00-12`. These are run folders: the timestamp, then `-start` or `-collect` for one half of a two-step check, then `-2`, `-3` when two runs start in the same second.

After a run writes its `result.json` and updates `state.json`, the tool deletes the oldest run folders past the number to keep:

| Keep Prior Results | Number of Test | Keeps |
| --- | --- | --- |
| `true` | `7` | the seven newest run folders |
| `true` | `2` | the two newest run folders |
| `false` | ignored | the newest run folder only |

With `Number of Test: 2`, and `results/` holding `2026-02-01T03-00-12` and `2026-02-02T03-00-12`, the run on February 3 writes `2026-02-03T03-00-12`, then deletes `2026-02-01T03-00-12`. Two run folders are left.

Every run still makes its own folder, with Keep Prior Results `false` too. A two-step check counts its `-start` and `-collect` folders apart, so it keeps that many whole tests.

Some folders are never counted or deleted, whatever the number says:

| Folder | Written by |
| --- | --- |
| `<timestamp>-baseline` | The baseline run when the check was written. |
| `<timestamp>-simulated-failure` | The simulated failure the check had to fail when it was written. |
| `<timestamp>-simulated` | `auto-check run --simulate-fail`. |
| `generate-try`, `generate-try-simulated` | The trial runs while the check was written. |
| any other name, such as `manual` | You. |

Two run folders stay past the count while the tool still reads them: the folder of the open failure, which its report and `auto-check resolve` point at, and the start of a two-step run waiting to be collected. A pass closes the failure, and its folder goes with the next count.

## Skipping scheduled runs after a failure

With Turn Off on Failed Test `true`, a scheduled run first reads `result.json` in the newest run folder that holds a finished test. When that run failed, the scheduled run is skipped:

```text
automate-pr-demo-app: skipped. The last run failed (results/2026-02-03T03-00-12/result.json), and Turn Off on Failed Test is true in test-configuration.md. Fix the cause, then run auto-check run here; scheduled runs resume after a run that does not fail.
```

A skipped run writes no result folder, leaves `state.json` alone, sends no notification, and exits 0, so the schedule log keeps that one line and the task reports success. The schedule itself stays installed.

| The newest finished run | A scheduled run |
| --- | --- |
| failed | is skipped |
| passed | runs |
| could not run (an error, such as a clone that could not be fetched) | runs, since nothing was proven broken |
| has no `result.json`, or one that cannot be read | runs |
| does not exist yet | runs, since this is most likely the first |

Baseline, simulated, and generate-try folders are never read for this, and neither is the start of a two-step run. The collect half of a two-step check is never skipped.

### Which runs are scheduled

Only runs given `--scheduled` are ever skipped. Every schedule the tool installs passes it, and on Windows the test folder's `schedule\run.cmd` passes it itself, so a task of your own that calls that wrapper is scheduled too. A run you start by hand, `auto-check run`, always runs.

### Turning a test back on

Fix the cause, then run the test by hand:

```sh
auto-check run
```

When that run does not fail, the next scheduled run goes ahead. To keep a test running on its schedule through failures, set Turn Off on Failed Test to `false`.

A bare `auto-check` shows when the next scheduled run would be skipped:

```text
Next run      auto-check automate-pr-demo-app at 2026-02-04T03:00:00 (skipped: the last run failed, results/2026-02-03T03-00-12)
```

## Notifications

With the file, Send Notifications and Notify when Test decide which outcomes notify, in place of the `notify.onFail`, `onError`, `onPass`, and `onRecover` settings:

| Send Notifications | Notify when Test | Notifies on |
| --- | --- | --- |
| `false` | ignored | nothing, even on channels your settings turn on |
| `true` | `fail` | a failure, and a run that could not run |
| `true` | `pass` | a pass, and the first pass after a failure |
| `true` | `both` | all of them |

A repeat of the open failure still notifies once, as it always has. With Turn Off on Failed Test `true`, the repeat never runs anyway.

### The account

With Email set, the test sends email from that address to that address, signed in as that address with the password. Text messages go through the same account. A webhook stays as your settings have it.

The mail server is found in this order:

1. The server nodemailer knows for the address's domain, such as `smtp.gmail.com` for a `gmail.com` address.
2. `notify.email.smtp` in your settings, when it names a `service`, or a `host` other than the shipped `smtp.example.com`.
3. Neither: the email channel fails with `no SMTP server is known for example.net; set notify.email.smtp.host and notify.email.smtp.port with auto-check config set`.

With Email `null`, the test uses the channels your settings turn on, with the outcomes this file chose.

## The password

Write the name of an environment variable, never the password:

```md
    - **Email**: jane.doe@example.com
    - **Password**: %AUTO_CHECK_EMAIL_PASSWORD%
```

On macOS or Linux, write `$AUTO_CHECK_EMAIL_PASSWORD` or `${AUTO_CHECK_EMAIL_PASSWORD}`. Put the value in the test folder's `.env`, which its `.gitignore` already leaves out:

```sh
AUTO_CHECK_EMAIL_PASSWORD=
```

The tool loads that `.env` whenever it runs the test, from the folder or from anywhere else, and never over a variable that is already set. It reads the variable only when a message goes out.

A password written into the file works, but every run, the bare `auto-check`, and `auto-check doctor` warn about it, by line, without repeating it:

```text
test-configuration.md:15: warning: Password holds the password itself. Put it in an environment variable, for example in this folder's .env, and write its name here, such as %AUTO_CHECK_EMAIL_PASSWORD%.
```

Wherever the password comes from, it stays out of everything else:

- It is never written to `result.json`, `state.json`, a failure report, `notify.txt`, or the schedule log, and never printed.
- `run.mjs` and every assistant start without the variables this file names, and without the email and webhook secrets of your settings.
- A commit message, a pushed change, or pull request text that holds the account's address or password is refused before it leaves the machine. The refusal names the address but never shows the password.
- An assistant started in the test folder is told never to read the account or `.env`.

## Validating

```sh
auto-check context validate test-configuration.md
auto-check context validate
auto-check
```

The first checks this file alone, the second checks both forms of the test folder, and a bare `auto-check` checks both before it does anything else. Each prints one line per setting:

```text
Scheduled runs  skipped after a failed run                       pass
Results kept    7 run folders                                    pass
Notifications   on fail, by email as jane.doe@example.com        pass
Password        from AUTO_CHECK_EMAIL_PASSWORD (set)             pass
```

Every problem names its line, and the command exits 4 while anything fails. `auto-check run` refuses a file with problems, so a scheduled run never guesses what a broken file meant.

`auto-check doctor` run inside a test folder adds a `test-configuration.md` row and, when the test has an account, a `password` row that says whether the variable is set.
