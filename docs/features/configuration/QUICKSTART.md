---
title: Quickstart
parent: Configuration
grand_parent: Features
nav_order: 1
---

# Configuration quickstart

```sh
auto-check config path                       # where the file is
auto-check config list                       # what it holds
auto-check config set root ~/auto-checks     # the one setting everyone needs
auto-check doctor                            # what the machine is missing
```

## The settings most people change

```sh
auto-check config set root ~/auto-checks
auto-check config set assistant claude
auto-check config set models.claude.generate opus
auto-check config set results.keep 30
auto-check config set repos.localRepo ~/clones/demo-app
```

## Turn on an email notification

```sh
auto-check config set notify.email.enabled true
auto-check config set notify.email.to '["jane.doe@example.com"]'
auto-check config set notify.email.from auto-check@example.com
auto-check config set notify.email.smtp.host smtp.example.com
auto-check config set notify.email.smtp.user demo-user
```

Then put the password in `.env` beside the settings file:

```sh
AUTO_CHECK_SMTP_PASSWORD=app-password-here
```

And try it without sending anything:

```sh
auto-check notify test --dry-run
```

## Keep your settings out of a trial

```sh
AUTO_CHECK_CONFIG_DIR=/tmp/auto-check-trial auto-check config list
```

Everything the tool reads and writes moves to that folder, including `.env` and the model cache.

## Edit the file by hand

```sh
code "$(auto-check config path)"
```

Add a `$schema` line at the top, pointing at the schema in your clone, for completion and checking:

```json
{
  "$schema": "file:///C:/Users/<user>/clones/automate-merged-pr-check/auto-check.config.schema.json"
}
```

Then confirm the file still fits:

```sh
auto-check doctor
```
