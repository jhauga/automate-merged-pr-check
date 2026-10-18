import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Path of the synthetic pull request fixtures. */
export const FIXTURES_FILE = fileURLToPath(new URL('../fixtures/prs.json', import.meta.url));

/** Pull request fixtures keyed by owner/repo#number. */
export const FIXTURES = JSON.parse(readFileSync(FIXTURES_FILE, 'utf8'));

/** GitHub access backed by the fixtures, recording each call. */
export function fakeGitHub(fixtures = FIXTURES) {
  const calls = [];
  const entry = (ref) => {
    const found = fixtures[`${ref.owner}/${ref.repo}#${ref.number}`];
    if (!found) throw new Error(`no fixture for ${ref.owner}/${ref.repo}#${ref.number}`);
    return found;
  };
  return {
    calls,
    viewPr: (ref) => {
      calls.push('viewPr');
      return structuredClone(entry(ref).view);
    },
    prFiles: (ref) => {
      calls.push('prFiles');
      return structuredClone(entry(ref).allFiles);
    },
    prDiff: (ref) => {
      calls.push('prDiff');
      return entry(ref).diff ?? '';
    },
    landingCandidates: (ref) => {
      calls.push('landingCandidates');
      return structuredClone(entry(ref).landing ?? { closer: null, referenced: [] });
    },
    commitOnBase: (ref, base, sha) => {
      calls.push(`commitOnBase ${base} ${sha}`);
      const full = entry(ref).onBase?.[sha];
      return full ? { onBase: true, sha: full } : { onBase: false, sha: null };
    },
  };
}

/**
 * Puts a stand-in `gh` command into `binDir` that answers `gh pr view` and
 * `gh pr diff` from the fixtures. Returns an environment with `binDir` first
 * on PATH, for a child process.
 */
export function installFakeGh(binDir, env = process.env) {
  mkdirSync(binDir, { recursive: true });
  copyFileSync(fileURLToPath(new URL('./fake-gh.mjs', import.meta.url)), path.join(binDir, 'fake-gh.mjs'));
  if (process.platform === 'win32') {
    writeFileSync(path.join(binDir, 'gh.cmd'), '@node "%~dp0\\fake-gh.mjs" %*\r\n');
  } else {
    const shim = path.join(binDir, 'gh');
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-gh.mjs" "$@"\n`);
    chmodSync(shim, 0o755);
  }
  const copy = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  const current = env.PATH ?? env.Path ?? '';
  return { ...copy, PATH: `${binDir}${path.delimiter}${current}`, FAKE_GH_FIXTURES: FIXTURES_FILE };
}

/**
 * Puts a stand-in assistant command into `binDir` and returns an environment
 * with `binDir` first on PATH. The stand-in answers --version, auth status,
 * --help, and a model probe, so a test never reaches the assistant the machine
 * happens to have installed.
 */
export function installFakeAssistant(binDir, env = process.env, { name = 'claude', models = ['opus'], version = '2.1.261' } = {}) {
  mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, 'fake-assistant-cli.mjs');
  copyFileSync(fileURLToPath(new URL('./fake-assistant-cli.mjs', import.meta.url)), script);
  if (process.platform === 'win32') {
    writeFileSync(path.join(binDir, `${name}.cmd`), `@node "%~dp0${path.basename(script)}" %*\r\n`);
  } else {
    const shim = path.join(binDir, name);
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/${path.basename(script)}" "$@"\n`);
    chmodSync(shim, 0o755);
  }
  const copy = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  const current = env.PATH ?? env.Path ?? '';
  return {
    ...copy,
    PATH: `${binDir}${path.delimiter}${current}`,
    FAKE_ASSISTANT_MODELS: models.join(','),
    FAKE_ASSISTANT_VERSION: version,
  };
}
