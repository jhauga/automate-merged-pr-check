# To do

Ideas worth building, kept out of the roadmap because none of them blocks a
release. [ROADMAP.md](ROADMAP.md) has what each milestone needs.

## Features

- `auto-check list`: every test folder under the root, with its last run, its
  next run, and whether a failure is open.
- `auto-check upgrade <folder>`: regenerate a check in place, keeping the form,
  the baseline, and the history, so a test can follow a subject that changed on
  purpose.
- `--watch-release <url>`: watch a release or a tag instead of a branch tip, for
  projects whose users only ever see releases.
- Webhook presets for the common push services, so a URL and a format are the
  only settings a person has to get right.
- An SMS adapter that sends through a messaging provider, for recipients whose
  carrier has closed its email-to-text gateway.
- Desktop drivers for macOS and Linux, so the host app layer is not Windows
  only.

## Improvements

- The Codex adapter: reasoning effort, named sessions, and resuming, once an
  installed Codex is available to try them against.
- `auto-check config probe-models`, to refresh the model cache on purpose rather
  than waiting for the next run to notice a new command version.
- Generation time: most of the hour is the assistant writing and trying the
  check. Caching the classification and the clone between attempts would cut
  the repair round down.
- Image differences in failure reports: a side by side of the capture and the
  baseline, saved beside the report, so a person can judge it without opening
  two files.

## Site

- An examples gallery built from placeholder pull requests, one per rung of the
  capability ladder.
- A short demo animation of the whole path: a pull request in, a scheduled check
  out.
- FAQ and troubleshooting pages, built from the questions the first users ask.
- Versioned documentation, once the settings schema and the form are frozen.
