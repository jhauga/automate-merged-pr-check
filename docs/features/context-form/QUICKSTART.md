---
title: Quickstart
parent: The context.md form
grand_parent: Features
nav_order: 1
---

# Form quickstart

```sh
auto-check --name automate-pr-demo-app --edit-context   # make it and open it
auto-check context validate                             # check it
```

## Fill in these four

```md
- Command: claude
- **Merged PR URI**: https://github.com/acme/demo-app/pull/123
- **PR Context**: What the change delivers, and what working and broken look like.
- **Find Issue**: true
```

Everything else can stay empty: the root, the folder name, and the flags below Find Issue all have sensible answers already.

## Then decide how far a failure goes

Off, a failure writes a report and stops:

```md
- **Find Issue**: true
- **Resolve Issue**: false
```

On, it writes a plan as well:

```md
- **Find Issue**: true
- **Resolve Issue**: true
```

All the way to a pull request, which also needs Local Repository and a fork at `origin`:

```md
- **Local Repository**: C:\Users\<user>\Documents\clones\demo-app
- **Find Issue**: true
- **Resolve Issue**: true
- **Commit Solution**: true
  - **Local Commit**: true
  - **Remote Push**: true
  - **Make PR**: true
```

## Read the report it prints

```sh
auto-check context validate
```

| Line | Means |
| --- | --- |
| `A.I. Tool ... pass` | The command is installed and signed in, and the model and effort are ones it accepts. |
| `Test folder ... pass` | The name in the form is the folder you are in. |
| `Merged PR ... pass` | `gh` read the pull request, and it has landed. |
| `Local repo ... pass` | The path is a work tree whose remotes include that repository. |
| `PR Context provided` | The assistant will be told what the change is. |
| `Find Issue true` | The chain, as the flags read. |

Problems name the line they came from:

```text
line 12: Resolve Issue is true while Find Issue is false. Turn Find Issue on first.
line 15: Commit Solution needs Local Repository, which is empty.
```

## Change your mind later

Edit `context.md` and run `auto-check context validate`. The next run reads the new values. Changing Command or Model changes which assistant writes the next fix, not the check that already exists.
