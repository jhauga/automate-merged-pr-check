---
title: Quickstart
parent: test-configuration.md
grand_parent: Features
nav_order: 1
---

# test-configuration.md quickstart

```sh
auto-check                                          # writes it into a folder that has none
auto-check context validate test-configuration.md   # check it
```

A new test folder already has one: seven runs kept, scheduled runs skipped after a failure, no notifications.

## Keep more, or fewer, results

```md
- **Keep Prior Results**: true
  - **Number of Test**: 30
```

Only the newest run:

```md
- **Keep Prior Results**: false
```

Baseline, simulated, and generate-try folders are never deleted.

## Keep running on the schedule after a failure

```md
- **Turn Off on Failed Test**: false
```

With `true`, the default, a test that failed waits for you. Turn it back on by fixing the cause and running it by hand:

```sh
auto-check run
```

## Be told when it fails

```md
- **Send Notifications**: true
  - **Notify when Test**: fail
  - **Account Configuration**:
    - **Email**: jane.doe@example.com
    - **Password**: %AUTO_CHECK_EMAIL_PASSWORD%
```

Then put the password in the test folder's `.env`, and try it:

```sh
echo AUTO_CHECK_EMAIL_PASSWORD=app-password-here >> .env
auto-check notify test --dry-run
auto-check notify test
```

On macOS or Linux, write `$AUTO_CHECK_EMAIL_PASSWORD` in the file instead. Many providers want an application password rather than your sign-in password.

## Use the channels in your settings instead

```md
- **Send Notifications**: true
  - **Notify when Test**: both
  - **Account Configuration**:
    - **Email**: null
    - **Password**: null
```

The test then notifies on every channel `auto-check config` turns on, for the outcomes chosen here.

## Silence one test

```md
- **Send Notifications**: false
```

Nothing goes out for this test, whatever your settings turn on.

## Read the report it prints

```text
Scheduled runs  skipped after a failed run                  pass
Results kept    7 run folders                               pass
Notifications   on fail, by email as jane.doe@example.com   pass
Password        from AUTO_CHECK_EMAIL_PASSWORD (set)        pass
```

| Line | Fix it with |
| --- | --- |
| `Password  from AUTO_CHECK_EMAIL_PASSWORD (unset)` | Add the variable to the test folder's `.env`. |
| `Password  written in the file` | Move the password into `.env`, and write the variable's name in the file. |
| `test-configuration.md:12: Notify when Test is needed when Send Notifications is true` | Write `pass`, `fail`, or `both`. |
