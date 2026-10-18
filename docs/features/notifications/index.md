---
title: Notifications
parent: Features
nav_order: 7
has_children: true
---

# Notifications

A scheduled run happens while you are asleep. Notifications are how you hear about it. Every channel is off until you turn it on, and no secret ever goes in the settings file.
{: .fs-5 .fw-300 }

## When a run notifies

| Setting | Default | Notifies when |
| --- | --- | --- |
| `notify.onFail` | `true` | A check fails for a new reason. |
| `notify.onError` | `true` | A check cannot run, such as a clone it could not fetch. |
| `notify.onRecover` | `true` | A check passes after failing. |
| `notify.onPass` | `false` | Any run passes. |

A repeat of the open failure never notifies again, however many nights it fails. A check can override any of these in its own `check.config.json` by replacing `"notify": "inherit"`.

## What a message says

```text
Subject: automate-pr-demo-app failed, acme/demo-app#123

The check failed at 2026-02-03T03:04:11Z.
  assertions: 22 of 24 pass
  failed: the drawing surface fills its view (0 x 0 in a 1280 x 720 view)
  comparison (composite): 7 of 9 match the baseline
  code under test: upstream a1b2c3d
  report: found-issue/02-03-2026/found-issue.md
  result: results/2026-02-03T03-04-11/result.json
```

The message names paths on your machine, so it goes only to the channels you configured, never to a repository.

## Email

Email goes through the `@isocialpractice/send-email` engine and the account module `notify/config/accounts/_default.js`, which holds no values: it reads the server and user from your settings, and the password from the environment variable the settings name.

```json
"email": {
  "enabled": true,
  "to": ["jane.doe@example.com"],
  "from": "auto-check@example.com",
  "account": "_default",
  "smtp": { "host": "smtp.example.com", "port": 587, "secure": false, "user": "demo-user", "passwordEnv": "AUTO_CHECK_SMTP_PASSWORD" }
}
```

Put the password in `.env` beside the settings file:

```sh
AUTO_CHECK_SMTP_PASSWORD=app-password-here
```

For a well-known provider, set `"service"` in `smtp` instead of `host`, `port`, and `secure`. Many providers want an application password rather than your sign-in password. To use the engine's own account format instead, add `notify/config/accounts/<name>.js` in this repository and set `notify.email.account` to `<name>`; files there other than `_default.js` are git-ignored.

## Text messages

Texts go to carrier email-to-text addresses, through the same email account, as a short message:

```json
"sms": { "enabled": true, "provider": "gateway", "to": ["5551234567@txt.example.com"] }
```

Look up the address format with the recipient's carrier first. Some carriers have closed their gateways: AT&T and Cricket closed theirs on June 17, 2025. For those recipients, use email or a push service through the webhook.

## Webhook

```json
"webhook": { "enabled": true, "url": "https://ntfy.example.com/auto-check", "format": "text", "secretEnv": "AUTO_CHECK_WEBHOOK_SECRET" }
```

| Format | Body |
| --- | --- |
| `json` | The run as JSON: the event, the check, the outcome, the pull request, the failing assertions, the report and result paths, and the signature. |
| `text` | The short message as plain text, with the subject in a `Title` header, which push services such as ntfy show as is. |

When the variable `secretEnv` names is set, the request carries it as `Authorization: Bearer <secret>`.

## Trying it

```sh
auto-check notify test --dry-run
auto-check notify test
```

`--dry-run` prints what each enabled channel would receive and sends nothing. Without it, a sample goes out on every enabled channel.

To watch the whole failure path without sending anything, set `notify.dryRun` and simulate a failure:

```sh
auto-check config set notify.dryRun true
auto-check run --simulate-fail black
cat results/*-simulated/notify.txt
```

With `notify.dryRun` on, every scheduled run writes its notifications to `notify.txt` in the run's result folder instead of sending them.

## When nothing arrives

| Check | How |
| --- | --- |
| Is the channel on? | `auto-check config get notify.email.enabled` |
| Is the password set? | `auto-check doctor` reports whether the named variable is set, never its value. |
| Does the server accept it? | `auto-check notify test` prints the error the server gave. |
| Did the run even notify? | A repeat says `Notification: already notified for this failure.` |
| Is it a text that never arrives? | Confirm the carrier's gateway still exists. |
