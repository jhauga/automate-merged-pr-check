---
title: Cheatsheet
parent: Configuration
grand_parent: Features
nav_order: 2
---

# Configuration cheatsheet

## Commands

| Line | What it does |
| --- | --- |
| `auto-check config path` | Print the settings file. |
| `auto-check config list` | Print every key, marking the ones still at their default. |
| `auto-check config get <key>` | Print one value. |
| `auto-check config set <key> <value>` | Write one value, atomically. |
| `auto-check config unset <key>` | Remove it, and go back to the default. |
| `auto-check doctor` | Report the machine, the settings, and anything that does not fit the schema. |

## Where the file is

| Platform | Folder |
| --- | --- |
| Windows | `%APPDATA%\auto-check\` |
| macOS | `~/Library/Application Support/auto-check/` |
| Linux | `$XDG_CONFIG_HOME/auto-check/`, else `~/.config/auto-check/` |
| Any | `AUTO_CHECK_CONFIG_DIR`, when set |

That folder holds `config.json`, `.env`, and `model-cache.json`.

## Keys

| Key | Default |
| --- | --- |
| `root` | empty |
| `assistant` | `claude` |
| `models.claude.generate`, `.analyze`, `.testDriver`, `.effort` | `opus`, `opus`, `haiku`, empty |
| `models.copilot.generate`, `.analyze`, `.testDriver`, `.testDriverAutoTier`, `.effort` | `auto`, `auto`, `auto`, `efficiency`, empty |
| `models.codex.generate`, `.analyze`, `.testDriver`, `.effort` | empty |
| `notify.dryRun` | `false` |
| `notify.onFail`, `.onError`, `.onRecover`, `.onPass` | `true`, `true`, `true`, `false` |
| `notify.email.enabled`, `.to`, `.from`, `.account` | `false`, placeholder, placeholder, `_default` |
| `notify.email.smtp.service`, `.host`, `.port`, `.secure`, `.user`, `.passwordEnv` | empty, `smtp.example.com`, `587`, `false`, `demo-user`, `AUTO_CHECK_SMTP_PASSWORD` |
| `notify.sms.enabled`, `.provider`, `.to` | `false`, `gateway`, placeholder |
| `notify.webhook.enabled`, `.url`, `.format`, `.secretEnv` | `false`, empty, `json`, `AUTO_CHECK_WEBHOOK_SECRET` |
| `schedule.windows.schedule`, `.startTime`, `.interactive` | `DAILY`, `03:00`, `auto` |
| `schedule.macos.hour`, `.minute` | `3`, `0` |
| `schedule.linux.cron`, `.unit` | `0 3 * * *`, `systemd-user` |
| `results.keep` | `14`, for a test folder without `test-configuration.md` |
| `repos.localRepo`, `.upstreamRemote`, `.originRemote`, `.branchPrefix` | empty, `upstream`, `origin`, `resolve-issue-` |
| `assistants.claude.skills`, `.instructions`, `.permissionMode` | `.claude/skills`, `CLAUDE.md`, `bypass` |
| `assistants.copilot.skills`, `.instructions`, `.permissionMode` | `.github/skills`, `.github/copilot-instructions.md`, `allow-all-tools` |
| `assistants.codex.skills`, `.instructions`, `.permissionMode` | `.agents/skills`, `AGENTS.md`, `workspace-write` |

## Value types

| Written | Read as |
| --- | --- |
| `true`, `false` | boolean |
| `14` | number |
| `["jane.doe@example.com"]` | array |
| `{"host":"smtp.example.com"}` | object |
| anything else | string |

## Precedence

```text
command line  ->  context.md  ->  settings  ->  built-in default
```

A check also records what it resolved, so an old check keeps running the way it was built.

## Environment

| Variable | Effect |
| --- | --- |
| `AUTO_CHECK_CONFIG_DIR` | Settings, `.env`, and model cache move there. |
| `AUTO_CHECK_STATE_DIR` | Locks and machine state move there. |
| Anything a setting names | Read from the environment, then from `.env` beside the settings. |
