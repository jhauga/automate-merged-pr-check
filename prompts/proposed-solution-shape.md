### The shape of a proposed solution

Write the proposed solution as a plan that another assistant, or a person, carries out one phase at a time:

1. Frontmatter with a single `description:` line in single quotes that names the subject and the problem in one sentence.
2. A title: `# <subject>: <the problem in a few words> (resolve plan)`.
3. An opening paragraph that says how to carry the plan out: one phase per response; while phases remain, end each response with `CONTINUE? Y or N` on a line of its own; after the last phase, end with `TASK COMPLETE!`; never use em dashes or en dashes in a changed file; do not stage, commit, or push unless a phase says to.
4. The branch, `{{branch}}`, made from the newest base branch, and the files in scope, each with what changes in it.
5. `## Evaluation (done {{today}})`, with these subsections:
   - `### Report`: the failure as the report states it, quoted.
   - `### What the artifacts show`: what the captures and comparisons show, and what that rules in or out.
   - `### Root cause`: the cause, with file and line references, and why it explains every observation.
   - `### Reproduction`: how to reproduce it, with the check itself where possible.
   - `### Ruled out`: the other causes you checked, and why each does not fit.
6. `## Decisions`, opening with "The recommended option is already ticked for each decision. Change a tick before running if you disagree." Each decision is `### D<n>: <question> (phase <n> waits on it)` followed by two to four options as checkboxes: the recommended option first, ticked with `- [x]` and labeled `(Recommended)`, then the others with `- [ ]`, and a last `- [ ] Other:` line. Write "There are no decisions to make." when there are none.
7. `## Phases`: numbered `### Phase <n>: <title>` sections with the exact changes, as before and after code where that helps. End each phase with `Checks:` and a numbered list of commands or observations that prove it worked. The last phase runs the check again: `auto-check run` in the test folder must exit 0.
