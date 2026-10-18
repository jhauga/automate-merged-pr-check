---
title: Cheatsheet
parent: Notifications
grand_parent: Features
nav_order: 2
---

# Notifications cheatsheet

## Events

| Setting | Default | Fires on |
| --- | --- | --- |
| `notify.onFail` | `true` | a failure with a new signature |
| `notify.onError` | `true` | a run that could not happen |
| `notify.onRecover` | `true` | the first pass after a failure |
| `notify.onPass` | `false` | every pass |
| `notify.dryRun` | `false` | writes `notify.txt` instead of sending |

A repeat of the open failure never notifies.

## Channels

| Channel | Keys |
| --- | --- |
| Email | `notify.email.enabled`, `.to`, `.from`, `.account`, `.smtp.service`, `.smtp.host`, `.smtp.port`, `.smtp.secure`, `.smtp.user`, `.smtp.passwordEnv` |
| Text | `notify.sms.enabled`, `.provider`, `.to` |
| Webhook | `notify.webhook.enabled`, `.url`, `.format`, `.secretEnv` |

## Webhook formats

| `format` | Body | Headers |
| --- | --- | --- |
| `json` | event, check, outcome, pull request, failed assertions, report and result paths, signature | `Content-Type: application/json` |
| `text` | the short message | `Title: <subject>` |

With `secretEnv` set in the environment: `Authorization: Bearer <secret>`.

## Secrets

| Setting | Names | Read from |
| --- | --- | --- |
| `notify.email.smtp.passwordEnv` | `AUTO_CHECK_SMTP_PASSWORD` | the environment, then `.env` beside the settings |
| `notify.webhook.secretEnv` | `AUTO_CHECK_WEBHOOK_SECRET` | the same |

`auto-check doctor` says whether each is set, never what it holds.

## Commands

| Line | What it does |
| --- | --- |
| `auto-check notify test --dry-run` | Print what each enabled channel would receive. |
| `auto-check notify test` | Send a sample on every enabled channel. |
| `auto-check run --no-notify` | Run without notifying, whatever the settings say. |
| `auto-check config set notify.dryRun true` | Write notifications to the result folder instead. |

## Per check

```json
"notify": "inherit"
"notify": { "onPass": true }
```

In that check's `check.config.json`. What you leave out keeps your settings.
