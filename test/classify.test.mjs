import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addedLinesByFile,
  aliasFor,
  classify,
  focusOf,
  hasInstallSteps,
  isDocPath,
  isIncidental,
} from '../lib/classify.mjs';

const file = (path, additions = 10, deletions = 0) => ({ path, additions, deletions });

test('documentation is recognized by extension, name, or docs folder', () => {
  for (const docPath of ['README.md', 'docs/guide.rst', 'notes.txt', 'LICENSE', 'docs/images/flow.png', 'packages/web/doc/api.adoc']) {
    assert.equal(isDocPath(docPath), true, docPath);
  }
  for (const sourcePath of ['src/app.js', 'docsite.js', 'extensions/demo/extension.mjs', 'Makefile']) {
    assert.equal(isDocPath(sourcePath), false, sourcePath);
  }
});

test('lock files, root dotfiles, and root .github metadata are incidental', () => {
  for (const incidental of ['package-lock.json', 'web/yarn.lock', '.codespellrc', '.github/workflows/ci.yml']) {
    assert.equal(isIncidental(incidental), true, incidental);
  }
  for (const real of ['extensions/demo/.github/plugin/plugin.json', 'src/.eslintrc.json', 'package.json']) {
    assert.equal(isIncidental(real), false, real);
  }
});

test('the focus is the file, the folder holding every file, or a folder holding most of them', () => {
  assert.deepEqual(focusOf(['docs/INSTALL.md']), { path: 'docs/INSTALL.md', isFile: true });
  const canvas = ['extensions/demo/extension.mjs', 'extensions/demo/game/a.js', 'extensions/demo/game/b.js', 'extensions/demo/game/c.js'];
  assert.deepEqual(focusOf(canvas), { path: 'extensions/demo', isFile: false });
  const mostly = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'tools/x.js'];
  assert.deepEqual(focusOf(mostly), { path: 'src', isFile: false });
  assert.equal(focusOf(['src/a.js', 'test/a.test.js']), null);
  assert.equal(focusOf([]), null);
});

test('aliases come from the focus, joined to the repository name when generic', () => {
  assert.equal(aliasFor({ path: 'extensions/sample-canvas', isFile: false }, 'demo-app'), 'sample-canvas');
  assert.equal(aliasFor({ path: 'src', isFile: false }, 'demo-app'), 'demo-app-src');
  assert.equal(aliasFor({ path: 'docs/INSTALL.md', isFile: true }, 'Demo_App'), 'demo-app-install');
  assert.equal(aliasFor(null, 'demo-app'), 'demo-app');
});

test('source subtypes: canvas extension, web page, command line, library', () => {
  const kind = (paths) => classify({ files: paths.map((p) => file(p)), repo: 'demo-app' }).subtype;
  assert.equal(kind(['ext/demo/copilot-extension.json', 'ext/demo/server.js']), 'gui-canvas-extension');
  assert.equal(kind(['ext/demo/extension.mjs', 'ext/demo/page/index.html']), 'gui-canvas-extension');
  assert.equal(kind(['web/src/App.tsx', 'web/src/state.js']), 'gui-web');
  assert.equal(kind(['bin/demo.js', 'src/args.js']), 'cli');
  assert.equal(kind(['cmd/demo/main.go']), 'cli');
  assert.equal(kind(['src/math.js']), 'library');
});

test('kind follows changed lines when code and documentation travel together', () => {
  const mostlyCode = classify({ files: [file('src/a.js', 300), file('src/README.md', 30)], repo: 'demo-app' });
  assert.equal(mostlyCode.kind, 'source');
  const balanced = classify({ files: [file('src/a.js', 60), file('docs/a.md', 50)], repo: 'demo-app' });
  assert.equal(balanced.kind, 'mixed');
  const docsOnly = classify({ files: [file('docs/a.md'), file('README.md')], repo: 'demo-app' });
  assert.equal(docsOnly.kind, 'documentation');
  assert.equal(docsOnly.subtype, 'reference-docs');
});

test('incidental files leave the focus alone unless nothing else changed', () => {
  const canvas = classify({
    files: [file('.codespellrc'), file('.github/plugin/marketplace.json'), file('extensions/demo/copilot-extension.json'), file('extensions/demo/game/app.js'), file('extensions/demo/game/index.html'), file('extensions/demo/game/style.css'), file('extensions/demo/package-lock.json', 900)],
    repo: 'demo-app',
  });
  assert.deepEqual(canvas.watchPaths, ['extensions/demo/**']);
  assert.equal(canvas.alias, 'demo');
  const ciOnly = classify({ files: [file('.github/workflows/ci.yml')], repo: 'demo-app' });
  assert.deepEqual(ciOnly.watchPaths, ['.github/workflows/ci.yml']);
});

test('added lines are read per file from a unified diff', () => {
  const diff = [
    'diff --git a/docs/a.md b/docs/a.md',
    '--- a/docs/a.md',
    '+++ b/docs/a.md',
    '@@ -1 +1,2 @@',
    ' kept',
    '+added one',
    '-removed',
    'diff --git a/old.md b/old.md',
    '--- a/old.md',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
  ].join('\n');
  assert.deepEqual([...addedLinesByFile(diff)], [['docs/a.md', ['added one']]]);
});

test('install steps need shell commands, in a fence or on two loose lines', () => {
  assert.equal(hasInstallSteps(['```bash', 'npm install --global demo-app', '```']), true);
  assert.equal(hasInstallSteps(['```', './configure', 'make', '```']), true);
  assert.equal(hasInstallSteps(['```json', '{ "install": false }', '```']), false);
  assert.equal(hasInstallSteps(['cmake . -G Ninja', 'ninja']), true);
  assert.equal(hasInstallSteps(['Run make when you are ready.']), false);
  assert.equal(hasInstallSteps(['```sh', 'make install']), true);
});

test('install guides are recognized by name even without a diff', () => {
  for (const guide of ['INSTALL.md', 'docs/BUILDING.md', 'docs/getting-started.md', 'Setup.rst']) {
    assert.equal(classify({ files: [file(guide)], repo: 'demo-app' }).subtype, 'install-procedure', guide);
  }
});
