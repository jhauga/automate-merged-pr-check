## The capability ladder

Take the first rung that fits the pull request, and say in the README which rung you took and why. A mixed pull request takes one rung for its source part and one for its documentation part, both in the same `run.mjs`.

### Rung 1: something rendered in a browser or a webview

For `source / gui-web` and `source / gui-canvas-extension`: pages, web apps, and extensions that draw a canvas inside a desktop host app.

**Layer `page`, driver `headless-browser`.** This layer runs unattended, offline, in under a minute, and needs no host app.

1. Serve the subject's own files from `ctx.source` with a loopback HTTP server that `run.mjs` starts on port 0, or start the subject's own server on a free port when it has one.
2. Open it with `playwright-core` in an installed Chromium-family browser: `chromium.launch({ channel: 'msedge' })`, then `channel: 'chrome'`. Nothing downloads a browser. Throw when neither is installed.
3. Keep the page offline: let requests to the loopback server through and abort the rest, unless the subject cannot work without them, which the README then says.
4. Use a fixed viewport and a device scale factor of 1, and wait for the subject to settle before each capture, at least `compare.minRunSeconds`.
5. Prove it works with facts a broken render cannot fake:
   - The drawing surface fills its view. A canvas left at its default size, or collapsed to a few pixels, is broken.
   - The capture is not blank: `ctx.assertNotBlank`.
   - Controls engage: perform the interaction the subject invites, such as a click at the center of the view, then assert that the prompt or overlay goes away and the view changes.
   - The page raised no uncaught errors and logged no console errors.
   - For an animated subject, two captures differ, and `compare.motion` names them as a pair. The subject itself must move between the two frames in every run, by far more than noise: film grain, a cursor, a clock, or a counter is not motion. When the view can rest on a still scene, such as a first-person view facing a wall, take the second frame after an input that always changes it, such as a turn.

**Layer `hostApp`, driver `cdp`.** For a subject that runs inside a desktop host app built on a system webview such as WebView2. The Chrome DevTools Protocol drove every step below on such an app: launch, conversation list, prompt box, model choice, the embedded view, screenshots, restart, reopen, and delete.

1. Close any running instance of the host app first, because a second launch hands off to the running one. A polite close request can be ignored, so stop the process tree after a short wait.
2. Launch the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=0` in its environment. Port 0 matters: the app's interface and every embedded view start separate browsers, so a fixed port would collide. Each browser writes the port it chose to the first line of a `DevToolsActivePort` file in its profile folder (an `EBWebView` folder). Accept only a file written after the launch, and wait until `http://127.0.0.1:<port>/json/version` answers.
3. Attach with `chromium.connectOverCDP('http://127.0.0.1:<port>')`. The app can replace its start-up page while it loads, so attach again until the controls you need exist.
4. Find controls by stable attributes read from the live page: test IDs, element IDs, ARIA roles, and labels. List the visible controls once while you write the check, and never use screen coordinates. An overlay can intercept a normal click, so call `element.click()` inside the page when that happens.
5. Pick the model in the app's model menu before sending a prompt: the app's lowest-cost choice, recorded in `models.testDriver`. Note the setting first and restore it afterwards.
6. Word the prompt as a request to open the installed subject by its name, and say not to create, edit, or install anything. A short command can be read as a request to build something new. When the app answers with a question instead of opening the subject, the run is an error, not a failure.
7. The embedded view runs in its own browser with its own profile folder and `DevToolsActivePort` file. Find the profile folder that changed after the prompt was sent and attach to its port. Capture the view only while it is on screen: a hidden view can refuse a screenshot. `Page.captureScreenshot` over the raw DevTools WebSocket is the fallback.
8. The sequence for the first run, which stores a conversation:
   1. Create a conversation that opens the subject, rename it to `auto-check {{alias}}` through its options menu, and save its name and id with `ctx.writeState({ storedConversation })`.
   2. Capture the view and assert the same facts as the page layer.
   3. Restart the app, open the stored conversation again, and check the view again. Opening a stored conversation reopens its embedded view by itself.
   4. Create a temporary conversation, check that it opens the subject too, and delete it.
9. Every later run opens the stored conversation and checks its view, then creates, checks, and deletes a temporary conversation. If the stored conversation is gone, create it again and say so with `ctx.note`.
10. Delete a conversation through its options menu, confirm when the app asks, and assert that it left the list. Delete only conversations the check created.
11. Never call `browser.close()` on a connection to the host app: it can close the app. Disconnect when the run ends.
12. Leave the app as you found it, even after a failure, an error, or a run under `--simulate-fail`: settings restored, temporary conversations deleted, and the app closed. Do this in a `finally` block that does not depend on what was captured, because a simulated run replaces every capture. When it was running before the check, start it again through the desktop shell (on Windows, `explorer.exe <exe>`) so it does not inherit the debugging port. Never leave the app running with a debugging port open.
13. A host app loads its installed copy of the subject, not the clone, so this layer tests what users run. Hash the installed copy and the copy at the base tip, and record any difference with `ctx.note`, so a failure caused by an outdated installed copy is told apart from a broken base tip.
14. The layer needs a signed-in desktop session. Throw, which reports an error, when there is none.

Use the GitHub Copilot CLI (`copilot -n <name> -p <prompt>`, `--resume <name>`) or desktop automation only for a step the DevTools Protocol cannot do, set that layer's driver to `cli` or `desktop-automation`, and say why in the README.

### Rung 2: a command line or a library

For `source / cli` and `source / library`. Layer `page`, driver `process`.

1. Install the subject's own dependencies inside `ctx.source` at run time when it needs them. The next refresh removes them.
2. Run the project's own test command for the paths the pull request touched, and save its exit code and output with `ctx.text`.
3. Then exercise the feature the pull request describes the way a user would: the command, its flags, and its output.
4. Assert exit codes and the lines of output that prove the feature, not whole logs that change between runs. Use `compare.strategy` `text`.

### Rung 3: an install or build procedure

For `documentation / install-procedure`. The check follows the documented steps exactly as a reader would.

1. At run time, read the documented steps from the file at the base tip in `ctx.source`: the fenced command blocks of the section the pull request touched. Fail with the section named when it is gone. Do not copy the steps into `run.mjs`, because the check must follow the documentation as it changes.
2. Run the steps in isolation, never on the user's machine itself:
   - Windows procedures: Windows Sandbox, from the configuration template `{{sandboxTemplate}}`. Copy it into the output folder, fill in its two placeholders, write the steps into a script in the mapped steps folder, and start it. The logon command runs the script and writes a log and an exit code into the mapped output folder. Wait for them within `timeoutMinutes`, then close the sandbox. Only one sandbox runs at a time. Use `runMode` `two-step` when the procedure outlasts one run.
   - Linux procedures: a container, when Docker is present.
   - Otherwise a scratch folder under `ctx.out`, and only for steps that change nothing outside it. Steps that install system-wide get the layer driver `manual` and a checklist in the README.
3. Assert that every step completed, and that the commands the documentation uses to confirm the result print what it says they print, such as a version line or response headers.

### Rung 4: reference documentation

For `documentation / reference-docs`.

1. At run time, list every claim in the touched section of the file at the base tip: commands, flags, option names, file paths, and API names. Save the list with `ctx.json`.
2. Check each claim against the code or the `--help` output at the base tip, with one assertion per claim that quotes it.
3. Use `compare.strategy` `text`.

### Comparison strategies

Choose `compare.strategy` from the determinism in the context section when there is one, and from the subject otherwise:

| Strategy | Use it when |
| --- | --- |
| `pixel` | The same input gives the same picture every run. Mask regions that always change, such as clocks. |
| `color-sample` | The layout varies but the palette does not, such as a generated scene with fixed colors. |
| `liveness` | Nothing visual is stable: the view must be non-uniform and frames must advance. |
| `text` | Commands, logs, and documentation claims. |
| `composite` | Several strategies at once, such as liveness for a scene plus text for its controls. |
