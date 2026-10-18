# `automate-merged-pr-check`

## A.I. Tool

- Command: <!-- The A.I. session command that runs this test's sessions, such as claude, copilot, or codex. Leave empty to use the configured default. -->
- Model: <!-- The model to use, such as Opus 5.5. Leave empty to use the configured default. -->
- Thinking Effort: <!-- The model's thinking effort, such as high or xhigh. Leave empty to use the command's default. -->

## Test Context

- **Test folder root**: <!-- The absolute path of the folder that holds this test. Leave empty to use the configured root folder. -->
- **Test folder name**: <!-- The folder name for this test. -->
- **Merged PR URI**: <!-- The GitHub URL of the pull request to make a test for. -->
- **Local Repository**: <!-- OPTIONAL: The path to the local repository where the pull request was made. -->
- **PR Context**: <!-- OPTIONAL: A short sentence here. For more, add a `### PR Context` section below and write the verbose context there. -->
- **Find Issue**: <!-- OPTIONAL: true or false (or delete this line). If true, a failing run writes `found-issue/MM-DD-YYYY/found-issue.md` in this test folder. -->
- **Resolve Issue**: <!-- OPTIONAL, needs Find Issue: true or false (or delete this line). If true, a found issue gets `proposed-solution/MM-DD-YYYY/proposed-solution.prompt.md` in this test folder. -->
- **Commit Solution**: <!-- OPTIONAL, needs Local Repository and Resolve Issue: true or false (or delete this line). If true, the steps below apply. -->
  - **Local Commit**: <!-- Needs Commit Solution: true or false (or delete this line). If true, a new branch is made in the local repository, the proposed solution is passed to the A.I. command, and the changes are committed locally. -->
  - **Remote Push**: <!-- Needs Local Commit: true or false (or delete this line). If true, the committed branch is pushed to the remote `origin`. -->
  - **Make PR**: <!-- Needs Remote Push: true or false (or delete this line). If true, the pushed branch is opened as a pull request on the source repository. -->
