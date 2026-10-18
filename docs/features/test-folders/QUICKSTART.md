---
title: Quickstart
parent: Test folders
grand_parent: Features
nav_order: 1
---

# Test folders quickstart

```sh
auto-check config set root ~/auto-checks               # once per machine
auto-check --name automate-pr-demo-app --edit-context  # make one, fill the form
cd ~/auto-checks/automate-pr-demo-app
auto-check                                             # validate, then write the check
```

## Make one from a pull request

```sh
auto-check https://github.com/acme/demo-app/pull/123
```

Answer the folder name question, or take the suggestion. Add `-y` to take every suggestion without being asked.

## Make one with a name of your own

```sh
auto-check --name automate-pr-demo-app
```

Writes `context.md` and `.gitignore`, and stops. Open `context.md`, fill it in, and run `auto-check` in the folder when it is ready.

## Work on one from anywhere

```sh
auto-check run automate-pr-demo-app
auto-check schedule status automate-pr-demo-app
```

Or step into the folder and leave the name out. Any folder inside the test folder works too.

## Move the root

```sh
auto-check config set root ~/other-place
```

Move the folders yourself, then reinstall each schedule, because a schedule holds the full path:

```sh
cd ~/other-place/automate-pr-demo-app
auto-check schedule install
```

## Common refusals

| Message | Fix |
| --- | --- |
| `A test folder cannot be created inside the auto-check repository.` | Set a root outside the repository, or pass `--root`. |
| `<folder> is already inside the test folder <other>.` | Make the folder beside it, not inside it. |
| `The name in the form, <name>, is not this folder, <other>.` | Edit the `Test folder name` line, or rename the folder. |
| `No context.md in <folder> or any folder above it.` | Step into a test folder, or name one as an argument. |
