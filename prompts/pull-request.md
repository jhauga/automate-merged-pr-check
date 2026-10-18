# Write the pull request for a fix

The branch `{{branch}}` in `{{repo}}` fixes the failure described in `{{foundIssueFile}}`, following the plan in `{{proposedSolutionFile}}`. Its changes against `{{upstreamRef}}` are in `{{patchFile}}`.

Write these files and change nothing else:

- `{{titleFile}}`: the pull request title on one line, in the style of the repository's recent pull requests.
- `{{bodyFile}}`: the pull request body. Say what was broken, what the change does and why, and how it was tested.{{#if templateFile}} Fill in every section of the repository's pull request template, `{{templateFile}}`.{{/if}}{{#if contributingFile}} Cover what the contributing guide, `{{contributingFile}}`, asks a pull request to include.{{/if}}
{{#if issueWanted}}
- `{{issueTitleFile}}` and `{{issueBodyFile}}`: an issue for the repository's maintainers that describes the failure, how to see it, and what a user experiences, without the fix.
{{/if}}

Do not push, and do not open the pull request or the issue: auto-check does that, after checking your text.

{{> outbound-rules}}
