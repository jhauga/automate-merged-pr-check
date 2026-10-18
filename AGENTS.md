# Agent instructions

These instructions apply to every coding assistant working on this repository, which holds the `auto-check` command-line tool.

## Writing rules

- Never use em dashes or en dashes in files you write or change. Use a comma, a colon, parentheses, or a new sentence instead.
- Examples in documentation, comments, tests, and fixtures use placeholder data only: Jane Doe, `jane.doe@example.com`, Acme Corp, `example.com`, `https://github.com/acme/demo-app/pull/123`, `(555) 123-4567`, and paths such as `C:\Users\<user>\...` or `~/...` that match the platform shown. Never copy real names, email addresses, accounts, domains, or local paths from a prompt, a configuration file, or the machine.
- Write the result, not the story of the request. No "as requested", no comments that narrate a change, and no restating of the prompt inside the files you change.

## What this repository is

`auto-check` turns a merged pull request into a scheduled check that keeps proving the change still works, and that its documentation still works as documented. People clone this repository once, run `npm install` and `npm link`, and then run `auto-check` from anywhere.

- The repository holds only the tool. Every test lives in its own test folder under a root folder the user picks once, outside this repository.
- Per-user settings live in the user's configuration folder, which `auto-check config path` prints. `auto-check.config.schema.json` describes them.
- `auto-check doctor` reports the tools, the settings, the root folder, and the skills this repository expects.

| Path | What it holds |
| --- | --- |
| `bin/auto-check.mjs`, `lib/` | The tool. |
| `prompts/` | The prompts auto-check gives an assistant. |
| `skills/auto-check-*` | The tool's own skills, copied into each test folder. |
| `templates/` | The check skeleton, the schedule wrappers, `context.md`, and the files a test folder starts with. |
| `test/`, `scripts/run-tests.mjs` | The test suite. `npm test` runs it. |
| `docs/` | The documentation site. |

## The tool's own skills

The folders named `auto-check-*` in `skills/` are auto-check's skills. They are copied into every test folder, into the skills folder of the assistant that test names. Edit them in `skills/` only; nothing mirrors them inside this repository.

| Skill | Use it to |
| --- | --- |
| `auto-check-context` | Fill in, review, or explain the `context.md` form of a test folder. |
| `auto-check-write-check` | Write, repair, or review the check in a test folder, following the check contract and the capability ladder. |
| `auto-check-propose-solution` | Find the cause of a failing check and write the plan that fixes it. |
| `auto-check-resolve-issue` | Apply a proposed solution on a `resolve-issue-<alias>` branch in a local clone, and write the commit message and pull request text with no local data in them. |

## Working on this repository

- Use Node.js 20.19 or newer and ES modules. Run `npm test` before finishing a change.
- Keep the command line, its help, and the documentation in step: every option appears in `auto-check --help`, in the command's own `--help`, and in the cheatsheet.
- Tests never read or write the settings of the person running them: each one points `AUTO_CHECK_CONFIG_DIR` at a folder of its own.
- A test folder is never created inside this repository. The guard refuses it, and the suite uses temporary folders.

## When auto-check starts you

A test folder carries its own `AGENTS.md`, from `templates/test-folder/`. It tells an assistant that `auto-check` started in a test folder how to work there: treat the prompt file as the whole task, stay inside the folders it names, never push or open a pull request unless asked, and keep local data out of anything that leaves the machine.
