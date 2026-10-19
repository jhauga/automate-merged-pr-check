---
name: auto-check-context
description: 'Fill in, review, or explain context.md, the form that describes one auto-check test (the A.I. tool that writes the check, the pull request it watches, and the follow-up steps a failure gets), and test-configuration.md beside it (how many results the test keeps, whether a scheduled run is skipped after a failed one, and whom it notifies). Use when asked to prepare a test folder before auto-check writes its check, to describe a pull request for auto-check, to change how a test keeps results or notifies, or to explain why a form is refused.'
---

# auto-check context

`context.md` sits at the root of a test folder and describes that one test. `auto-check` reads it before it writes a check, and again before every scheduled run, so the form, not a saved setting, decides what the test does.

Use this skill when:

- A test folder was created with `auto-check --name <folder>` and its form is still empty.
- `auto-check` or `auto-check context validate` refuses a form, and the problems need fixing.
- A check knows too little about its subject: what working looks like, what broken looks like, or how long to wait before judging.

## The form

```md
# `automate-merged-pr-check`

## A.I. Tool

- Command: claude
- Model: Opus 5.5
- Thinking Effort: xhigh

## Test Context

- **Test folder root**: C:\Users\<user>\Documents\auto-checks
- **Test folder name**: automate-pr-sample-canvas
- **Merged PR URI**: https://github.com/acme/demo-app/pull/123
- **Local Repository**: C:\Users\<user>\Documents\clones\demo-app
- **PR Context**: A drawing surface rendered in the side panel of Sample App.
- **Find Issue**: true
- **Resolve Issue**: true
- **Commit Solution**: true
  - **Local Commit**: true
  - **Remote Push**: false
  - **Make PR**: false
```

Every comment in the shipped form is a hint, and `auto-check` ignores it. A value goes before the comment on its line, so the hint stays for next time.

| Field | What to write |
| --- | --- |
| Command | `claude`, `copilot`, or `codex`: the session command that writes the check and proposes fixes. Leave it empty to use the configured assistant. |
| Model | The model that command runs, written as a person would: `Opus 5.5`. Leave it empty for the configured model. |
| Thinking Effort | A level the command offers, such as `high` or `xhigh`. Leave it empty for the command's own default. |
| Test folder root | The absolute path of the folder that holds this test folder. Leave it empty for the configured root. |
| Test folder name | This folder's name. It must match the folder the form sits in. |
| Merged PR URI | The pull request this test watches. A merged one is tested at the base branch tip; one that is still open needs Local Repository too. |
| Local Repository | A clone of the repository the pull request was made in. Needed for an open pull request, and for Commit Solution. |
| PR Context | What the pull request delivers and what "still works" means for it. One sentence here, or a `### PR Context` section below for more. |
| Find Issue | `true` writes a failure report when a run fails. |
| Resolve Issue | `true` has the assistant write a plan that fixes a found issue. |
| Commit Solution | `true` applies that plan on a branch of Local Repository. Its three steps follow below it. |

## Writing PR Context well

The pull request page says what changed. PR Context says how to tell that it still works, which the page rarely says. Write it for someone who has never seen the subject:

- What the change adds, in one sentence.
- What a working run looks like: what renders, what moves, what the output says.
- What a broken run looks like: a single-color view, a frozen frame, an error in the console, a missing line of output.
- How long to wait before judging, when the subject needs time to settle.
- What changes every run anyway: generated scenes, clocks, live data, random seeds. A check that knows this compares loosely where it must and strictly where it can.

A short inline sentence is enough for a simple command. For anything rendered, add the verbose section:

```md
### PR Context

The pull request adds the sample-canvas extension, which opens a drawing surface in the side panel of Sample App. It still works when the surface fills its view, the frames keep moving, and the view follows the movement keys after a click. The scene is generated, so no two frames match. A single-color view, a frozen frame, or a WebGL error means it is broken. Wait at least 5 seconds before judging.
```

## The follow-up chain

Each step needs the one before it, and `Commit Solution` also needs `Local Repository`:

```text
Find Issue -> Resolve Issue -> Commit Solution -> Local Commit -> Remote Push -> Make PR
```

A flag that is absent or empty reads as false. A flag that is true while its parent is false is refused, and the problem names the parent. Turn on only as much as the test should do on its own: `Find Issue` alone is a good start, and `Remote Push` or `Make PR` send work outward, so turn them on deliberately.

## Checking the form

Run `auto-check context validate` in the test folder. It prints one line per rule:

```text
A.I. Tool        claude 2.1.261, signed in; model Opus 5.5; effort xhigh   pass
Test folder      automate-pr-sample-canvas is the current folder           pass
Root             C:\Users\<user>\Documents\auto-checks, the configured root pass
Merged PR        acme/demo-app#123, merged                                 pass
Local repo       C:\Users\<user>\Documents\clones\demo-app                 pass
PR Context       provided; passed to the assistant                        pass
Find Issue       true
Resolve Issue    true
Commit Solution  true: Local Commit true, Remote Push false, Make PR false (Remote Push is false)
```

Every problem names the line it came from, and the command exits 4 while anything fails. Fix the lines it names, then run it again.

## test-configuration.md

The second form in the test folder says how the test behaves once it runs on its schedule. A new test folder starts with these values:

```md
# Test Configuration

## Scheduled Test

- **Turn Off on Failed Test**: true
- **Keep Prior Results**: true
  - **Number of Test**: 7

## Send Notifications

- **Send Notifications**: false
  - **Notify when Test**: null
  - **Account Configuration**:
    - **Email**: null
    - **Password**: null
```

| Field | What to write |
| --- | --- |
| Turn Off on Failed Test | `true` skips a scheduled run while the newest run in `results/` failed. A run started by hand always runs, and a passing one turns the schedule back on. |
| Keep Prior Results | `true` keeps Number of Test run folders in `results/`; `false` keeps only the newest. Baseline, simulated, and generate-try folders are never deleted. |
| Number of Test | A whole number, 1 or more. The oldest run folder goes first. |
| Send Notifications | `true` notifies as the items below say; `false` sends nothing for this test, whatever the settings enable. |
| Notify when Test | `pass`, `fail`, or `both`. A failure includes a run that could not run; a pass includes the first pass after a failure. |
| Email | The address that sends and receives, or an environment variable that holds it, such as `%AUTO_CHECK_EMAIL%` or `$AUTO_CHECK_EMAIL`. `null` uses the channels of `auto-check config`. |
| Password | The name of an environment variable that holds the password, such as `%AUTO_CHECK_EMAIL_PASSWORD%`. Its value goes in the test folder's `.env`, which is git-ignored. |

`auto-check context validate test-configuration.md` checks this file alone, and `auto-check context validate` with no path checks both forms.

## Rules

- Never put a password, a token, or any other secret in either form. Write the name of an environment variable instead, such as `%AUTO_CHECK_EMAIL_PASSWORD%`, and leave its value to the person, in the test folder's `.env`. Never read, copy, or print the value of that variable or of anything in `.env`.
- Keep each form about this one test. Settings that apply to every test, such as the default email server and the schedule's start time, belong in `auto-check config`.
- Write plain sentences, and never use em dashes or en dashes.
