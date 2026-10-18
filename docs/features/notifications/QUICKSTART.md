---
title: Quickstart
parent: Notifications
grand_parent: Features
nav_order: 1
---

# Notifications quickstart

```sh
auto-check config set notify.email.enabled true
auto-check config set notify.email.to '["jane.doe@example.com"]'
auto-check config set notify.email.smtp.host smtp.example.com
auto-check config set notify.email.smtp.user demo-user
echo AUTO_CHECK_SMTP_PASSWORD=app-password-here >> "$(dirname "$(auto-check config path)")/.env"
auto-check notify test --dry-run
auto-check notify test
```

## A push service instead

```sh
auto-check config set notify.webhook.enabled true
auto-check config set notify.webhook.url https://ntfy.example.com/auto-check
auto-check config set notify.webhook.format text
auto-check notify test
```

## A text message

```sh
auto-check config set notify.sms.enabled true
auto-check config set notify.sms.to '["5551234567@txt.example.com"]'
auto-check notify test --dry-run
```

Texts ride on the email account, so set email up first. Check the recipient's carrier still runs an email-to-text gateway.

## Choose which outcomes reach you

```sh
auto-check config set notify.onFail true       # a new failure
auto-check config set notify.onError true      # a check that could not run
auto-check config set notify.onRecover true    # the first pass after a failure
auto-check config set notify.onPass false      # every pass, usually too much
```

## Rehearse a failure without sending anything

```sh
auto-check config set notify.dryRun true
auto-check run --simulate-fail black
cat results/*-simulated/notify.txt
auto-check config set notify.dryRun false
```

## One test, its own rules

In that test's `check.config.json`:

```json
"notify": { "onPass": true }
```

Everything you do not name keeps your settings.
