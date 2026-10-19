# Roadmap

The goal is version 1.0.0 on npm: `npm install -g automate-merged-pr-check`,
with GitHub keeping the source and the release notes, and GitHub Pages the
documentation.

Until then the package stays `private`, and every release is a GitHub release
built from a tag.

## What ships

The npm package holds only what the tool needs at run time, the `files` list in
`package.json`:

```text
bin/  lib/  prompts/  skills/  templates/
notify/config/accounts/_default.js
auto-check.config.schema.json
CHANGELOG.md
```

Tests, documentation, graphics, and the CI workflow stay on GitHub. `npm pack
--dry-run` is the check.

## Milestones

### alpha: 1.0.0-alpha.x (now)

- Windows, with Claude Code, proven end to end on a real machine: a pull request
  becomes a test folder, an assistant writes the check, the harness verifies it,
  a baseline is captured, a schedule is installed, and a failing run writes a
  report.
- macOS and Linux schedules, and the Codex adapter, are written and unit tested
  but have not run on those systems.
- The settings schema and the two forms of a test folder may still change.

### beta: 1.0.0-beta.x

- macOS and Linux schedules run on those systems, with the launchd agent and the
  systemd timer verified by hand.
- A full GitHub Copilot CLI run: generate, verify, baseline, schedule, and a
  failure through the pipeline.
- The Codex adapter run against an installed Codex.
- An install-procedure check carried end to end in Windows Sandbox.
- The capability ladder extended with whatever those runs teach.

### rc: 1.0.0-rc.x

- The settings schema, the `context.md` form, and `test-configuration.md`
  frozen. A change after this needs a migration note.
- Documentation complete: every command, option, and setting on the site, each
  feature with its quickstart and cheatsheet.
- `npm pack --dry-run` and an install from the packed tarball into a clean
  folder, on Windows and on Linux.
- No open defect that loses a result, a report, or a baseline.

### 1.0.0

- `private` removed from `package.json`.
- `npm publish --provenance`, from the tag, through the CI workflow.
- A GitHub release whose notes are the changelog entry.
- The documentation site points at the published package.

## Release steps

1. `npm test` on Windows and under WSL, on the oldest supported Node.js and the
   newest.
2. Update `CHANGELOG.md`: a new `## [<version>] - <date>` heading at the top,
   described generically.
3. `npm version <version>` and push the tag.
4. `npm pack --dry-run`, and confirm the file list matches the one above.
5. Draft the GitHub release from the tag, with the changelog entry as its notes.
6. From 1.0.0: `npm publish --provenance --access public`.
