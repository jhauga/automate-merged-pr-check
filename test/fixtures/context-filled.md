# `automate-merged-pr-check`

## A.I. Tool

- Command: claude
- Model: Opus 5.5
- Thinking Effort: xhigh

## Test Context

- **Test folder root**: <!-- filled in by the test -->
- **Test folder name**: automate-pr-sample-canvas
- **Merged PR URI**: https://github.com/acme/demo-app/pull/101
- **Local Repository**: <!-- filled in by the test -->
- **PR Context**: Rendered HTML elements created in a desktop app for learning and research.
- **Find Issue**: true
- **Resolve Issue**: true
- **Commit Solution**: true
  - **Local Commit**: true
  - **Remote Push**: false

### PR Context

The pull request adds the sample-canvas extension, which opens a drawing surface in the side panel of Sample App. It still works when the surface fills its view, the frames keep moving, and the view follows the movement keys after a click. Wait at least 5 seconds before judging. A single-color view, a frozen frame, or a WebGL error means it is broken.
