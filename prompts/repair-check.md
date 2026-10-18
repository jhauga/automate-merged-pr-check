# Repair a scheduled check

The check you wrote in `{{checkDir}}` for {{pr.url}} does not meet the check contract yet. auto-check found these problems:

{{problems}}

Fix every problem in place. Keep the parts of the check that already work, and keep the files auto-check wrote unless a problem names them.

When the problems are fixed, run the check again in its folder: `node run.mjs --out "{{tryDir}}"` must exit 0, and `node run.mjs --out "{{tryDir}}-simulated" --simulate-fail black` must exit 1. Do not write `baseline/`.

The same rules apply as before: work only inside `{{checkDir}}`, test the base branch tip and never the pull request's own commit, never push, install nothing globally, put no secret in any file, and never use em dashes or en dashes.

Finish with a summary of at most 10 lines: what you changed and the exit codes of the two runs.

{{> harness-contract}}
