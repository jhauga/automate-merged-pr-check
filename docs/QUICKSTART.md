---
title: Quickstart
nav_order: 2
---

# Quickstart

The short version, for a merged pull request you want watched.
{: .fs-5 .fw-300 }

```sh
git clone https://github.com/jhauga/automate-merged-pr-check
cd automate-merged-pr-check && npm install && npm link
auto-check doctor                                   # tools, settings, root folder
auto-check config set root ~/auto-checks            # where test folders live
auto-check https://github.com/acme/demo-app/pull/123
cd ~/auto-checks/automate-pr-demo-app               # the folder it made
auto-check                                          # where this test stands
auto-check run                                      # run the check now
```

That is the whole path: install, point at a pull request, wait for the check, and you have a scheduled test.
{: .fs-4 .fw-300 }

---

## 1. Install the tool

```sh
git clone https://github.com/jhauga/automate-merged-pr-check
cd automate-merged-pr-check
npm install
npm link
```

You need Node.js 20.19 or newer, git, `gh` signed in, and one assistant signed in. Check with:

```sh
auto-check doctor
```

## 2. Pick a root folder

Every test gets its own folder under one root, outside this repository. Set it once:

```sh
auto-check config set root ~/auto-checks
```

If you skip this, the first run asks and saves your answer.

## 3. Point at a merged pull request

```sh
auto-check https://github.com/acme/demo-app/pull/123
```

It reads the pull request, suggests a folder name such as `automate-pr-demo-app`, creates the folder, and opens `context.md` so you can describe the change. Fill in at least:

- **Command**: the assistant to use, such as `claude`.
- **PR Context**: what the pull request delivers, and what working and broken look like. This is the single most useful thing you can write.
- **Find Issue**: `true`, so a failing run leaves a report.

Save and close the editor. The assistant then writes the check, verifies it, captures a baseline, and installs a schedule. Expect about an hour.

## 4. See where it stands

```sh
cd ~/auto-checks/automate-pr-demo-app
auto-check
```

```text
Check           acme-demo-app-pr-123, source / gui-web
Pull request    https://github.com/acme/demo-app/pull/123
Last run        pass at 2026-02-03T03:00:12Z, results/2026-02-03T03-00-12
Next run        auto-check automate-pr-demo-app at 2026-02-04T03:00:00
Open failure    none
Next steps      auto-check run, auto-check schedule status
```

## 5. Run it yourself

```sh
auto-check run
```

Exit code 0 is a pass, 1 is a failure, 2 means the check could not run.

To see the failure path without breaking anything:

```sh
auto-check run --simulate-fail black
```

That writes `found-issue/MM-DD-YYYY/found-issue.md`, marked as simulated, and leaves the real run history alone.

## 6. Decide what a failure should do

Open `context.md` and turn on as much of the chain as you want:

```md
- **Find Issue**: true
- **Resolve Issue**: true
- **Commit Solution**: true
  - **Local Commit**: true
  - **Remote Push**: false
  - **Make PR**: false
```

Then check the form reads the way you meant:

```sh
auto-check context validate
```

## Next

- [The context.md form](features/context-form/index.md) for every field.
- [Running and scheduling](features/running-and-scheduling/index.md) for what runs when.
- [The failure pipeline](features/failure-pipeline/index.md) for everything after a failing run.
- [Cheatsheet](CHEATSHEET.md) when you just need the command.
