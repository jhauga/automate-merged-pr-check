# Agent instructions

This folder is one auto-check test: a scheduled check that keeps proving a merged pull request still works as its page and its documentation say it does. `context.md` describes the test, and `auto-check` started you here.

## When auto-check starts you

`auto-check` gives you a prompt file and the folders you may work in.

- Treat the prompt file as the whole task. Work only inside the folders it names, and write the files it asks for in the format it describes.
- Never push, open a pull request or an issue, or change a git remote unless the prompt asks for it.
- The code under test is a clone auto-check rebuilds before every run. Change nothing in it, and never commit there.
- Anything that leaves the machine, such as a commit message, a pushed file, issue text, or a pull request description, follows the writing rules below and contains no local path, account name, machine name, or email address.
- Never read, copy, or print the Account Configuration values of `test-configuration.md`, or anything in `.env`. They hold the email account this test notifies from.

## Writing rules

- Never use em dashes or en dashes in files you write or change. Use a comma, a colon, parentheses, or a new sentence instead.
- Examples in documentation, comments, and fixtures use placeholder data only: Jane Doe, `jane.doe@example.com`, Acme Corp, `example.com`, `https://github.com/acme/demo-app/pull/123`, `(555) 123-4567`, and paths such as `C:\Users\<user>\...` or `~/...` that match the platform shown.
- Write the result, not the story of the request. No "as requested", no comments that narrate a change, and no restating of the prompt inside the files you change.

## This folder

| Path | What it is |
| --- | --- |
| `context.md` | The form that describes this test. It decides which follow-up steps a failure gets. |
| `test-configuration.md` | How many results this test keeps, whether a scheduled run is skipped after a failed one, and whom it notifies. |
| `check.config.json` | The check's settings: the pull request, the code under test, the layers, and the comparison. |
| `run.mjs` | The check itself. `node run.mjs --out results/manual` runs it by hand. |
| `README.md` | What the check proves, and how to read its result. |
| `.auto-check/check-kit.mjs` | The check kit `run.mjs` imports. auto-check refreshes it on every run; never edit it. |
| `baseline/` | The accepted captures every run is compared with. |
| `results/` | One folder per run, newest last, kept as `test-configuration.md` says. `result.json` holds the outcome. |

Run `auto-check --help` for the commands this folder accepts.
