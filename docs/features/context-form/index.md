---
title: The context.md form
parent: Features
nav_order: 2
has_children: true
---

# The context.md form

`context.md` sits at the root of a test folder and describes that one test: the A.I. tool that writes its check, the pull request it watches, the clone a fix would go into, and how far a failure should carry on by itself.
{: .fs-5 .fw-300 }

The tool reads the form before it writes the check, and again before every run, so the form is the source of truth. Change the form, and the next run follows it.

## The form as it ships

```md
# `automate-merged-pr-check`

## A.I. Tool

- Command: claude
- Model: Opus 5.5
- Thinking Effort: xhigh

## Test Context

- **Test folder root**: C:\Users\<user>\Documents\auto-checks
- **Test folder name**: automate-pr-demo-app
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

Every comment in the shipped form is a hint the tool ignores. A value goes before the comment on its line. Labels match with or without `**`, and without regard to case, so `- model: opus` and `- **Model**: Opus 5.5` are both read.

## Fields

| Field | Required | Rule |
| --- | --- | --- |
| Command | Optional | `claude`, `copilot`, or `codex`, installed and signed in. Empty means the assistant in your settings. |
| Model | Optional | A model that command accepts, written as a person would: `Opus 5.5`. Empty means the model in your settings. |
| Thinking Effort | Optional | A level that command offers. Claude Code: low, medium, high, xhigh, max. Copilot CLI: none, minimal, low, medium, high, xhigh, max. Empty means the command's own default. |
| Test folder root | Optional | The absolute path of the folder that holds this test folder. It must exist. Empty means the configured root. |
| Test folder name | Required | This folder's name. It must match the folder the form sits in. |
| Merged PR URI | Required | A GitHub pull request URL that `gh` can read. One that is still open is tested from Local Repository, on its head branch. |
| Local Repository | Optional | A clone of the repository the pull request was made in. Required for an open pull request, and for Commit Solution. A clone whose remotes do not include that repository is a warning, not an error. |
| PR Context | Optional | What the pull request delivers, and what working and broken look like. |

### PR Context is worth the effort

Everything else in the form is a fact the tool could look up. PR Context is the one field only you can write, and it reaches the prompt that writes the check, the report that describes a failure, and the plan that fixes it. Write it as if briefing someone who has never seen the change:

```md
### PR Context

The pull request adds a drawing surface to the side panel of Sample App. It
works when the surface fills the panel, keeps drawing after the panel is
resized, and responds to a click. The scene is generated, so no two frames are
identical, but the palette stays within the documented colors. A blank panel, a
frozen frame, or a graphics error means it is broken. Wait at least five
seconds before judging.
```

One sentence inline is fine for a simple change. For more, add a `### PR Context` section after the list and write as much as you need.

## The follow-up chain

```text
Find Issue -> Resolve Issue -> Commit Solution -> Local Commit -> Remote Push -> Make PR
```

| Flag | What it turns on |
| --- | --- |
| Find Issue | A failing run writes `found-issue/MM-DD-YYYY/found-issue.md` in this test folder. |
| Resolve Issue | The assistant writes `proposed-solution/MM-DD-YYYY/proposed-solution.prompt.md` for that failure. |
| Commit Solution | The plan is applied on a branch of Local Repository, in a git worktree, so your own checkout is never touched. |
| Local Commit | The change is committed on that branch. |
| Remote Push | The branch is pushed to the remote `origin`, which must not be the upstream repository itself. |
| Make PR | The pushed branch is opened as a pull request on the upstream repository. |

Each flag takes `true`, `false`, `yes`, or `no`, in any case. A flag that is absent or empty reads as false. A flag that is true while the one above it is false is an error that names the parent, and Commit Solution also needs Local Repository.

A new form from `auto-check --name` arrives with `Find Issue: true` and the rest off, which is the setting most people want: a failure leaves a report, and nothing happens to any repository.

## Validating

```sh
auto-check context validate
auto-check context validate path/to/other-context.md
```

It prints one line per rule, with `pass` or `fail` and the value it resolved:

```text
A.I. Tool        claude 2.1.261 (Claude Code), signed in; model Opus 5.5; effort xhigh   pass
Test folder      automate-pr-demo-app is the current folder                              pass
Root             C:\Users\<user>\Documents\auto-checks, the configured root               pass
Merged PR        acme/demo-app#123, merged                                               pass
Local repo       C:\Users\<user>\Documents\clones\demo-app, a clone of acme/demo-app      pass
PR Context       provided; passed to the assistant                                       pass
Find Issue       true
Resolve Issue    true
Commit Solution  true: Local Commit true, Remote Push false, Make PR false (Remote Push is false)
```

Every problem and warning names the line it came from. The command exits 0 when every rule passes, and 4 while anything fails. A bare `auto-check` in a test folder prints the same report before it does anything else, so a run never starts on a form that does not hold together.

## What the tool fills in for you

| Written by | Fields |
| --- | --- |
| `auto-check --name <folder>` | Test folder root, Test folder name, `Find Issue: true`. |
| `auto-check <pr-url>` | The same, plus Merged PR URI, and Local Repository when `--unmerged` named one. |
| You | Command, Model, Thinking Effort, PR Context, and the rest of the chain. |

A value the tool writes replaces the placeholder on that line and keeps the comment, so the hints stay for next time.

## Secrets

Never put a password, a token, or any other key in the form. Name an environment variable instead, and keep the value in the environment or in a `.env` file beside the settings file. A line that looks like a secret prints a warning with its line number, and the form is passed to an assistant, so anything in it leaves the file.
