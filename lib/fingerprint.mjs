import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEdge } from './doctor.mjs';
import { capture, firstLine, which } from './util/which.mjs';

const SKIP_FOLDERS = new Set(['node_modules', '.git']);
const TOOLS = ['git', 'gh', 'claude', 'copilot', 'codex'];

/** Operating system name, release, and, where available, the full build string. */
export function osInfo() {
  const info = { platform: process.platform, type: os.type(), release: os.release(), arch: process.arch, version: null };
  if (process.platform === 'win32') {
    info.version = firstLine(capture('cmd.exe', ['/d', '/c', 'ver']).stdout) || null;
  } else if (process.platform === 'darwin') {
    info.version = firstLine(capture('sw_vers', ['-productVersion']).stdout) || null;
  } else if (existsSync('/etc/os-release')) {
    const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(readFileSync('/etc/os-release', 'utf8'));
    info.version = pretty ? pretty[1] : null;
  }
  return info;
}

/** SHA-256 over every file's relative path and contents, skipping node_modules and .git. */
export function hashTree(dir) {
  const hash = createHash('sha256');
  let files = 0;
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (SKIP_FOLDERS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        hash.update(path.relative(dir, full).split(path.sep).join('/'));
        hash.update('\0');
        hash.update(readFileSync(full));
        hash.update('\0');
        files += 1;
      }
    }
  };
  walk(dir);
  return { sha256: hash.digest('hex'), files };
}

/**
 * Version of a desktop host app: the product version of `exe` on Windows,
 * or the first line printed by `versionCommand`, which runs through the
 * shell because it comes from the check's own configuration.
 */
export function hostAppVersion(hostApp) {
  if (!hostApp) return null;
  let version = null;
  if (hostApp.exe && process.platform === 'win32' && existsSync(hostApp.exe)) {
    const literal = hostApp.exe.replace(/'/g, "''");
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${literal}').VersionInfo.ProductVersion`],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    );
    version = firstLine(result.stdout) || null;
  } else if (hostApp.versionCommand) {
    const result = spawnSync(hostApp.versionCommand, { encoding: 'utf8', windowsHide: true, timeout: 20000, shell: true });
    version = firstLine(result.stdout) || null;
  }
  return { name: hostApp.name ?? null, version };
}

/** Probes that read the machine. Tests replace them with fakes. */
export function defaultProbe() {
  return {
    os: osInfo,
    nodeVersion: () => process.versions.node,
    browser: () => {
      const edge = findEdge();
      return edge ? { name: 'Microsoft Edge', version: edge.version ?? null } : null;
    },
    toolVersion: (command) => {
      const file = which(command);
      return file ? firstLine(capture(file, ['--version']).stdout) || 'version unknown' : null;
    },
    hostApp: hostAppVersion,
    hashTree,
  };
}

/**
 * What a check ran on: the operating system, Node, the browser, the CLI
 * tools, the host app, and a hash of the installed copy of the subject. The
 * runner stores one per run, so a failure can be traced to whatever changed.
 */
export function collectFingerprint({ subject = {}, probe = defaultProbe() } = {}) {
  const tools = {};
  for (const command of TOOLS) {
    const version = probe.toolVersion(command);
    if (version) tools[command] = version;
  }
  const installed = subject.installedPath && existsSync(subject.installedPath)
    ? { path: subject.installedPath, ...probe.hashTree(subject.installedPath) }
    : null;
  return {
    os: probe.os(),
    node: probe.nodeVersion(),
    browser: probe.browser(),
    tools,
    hostApp: probe.hostApp(subject.hostApp ?? null),
    installedCopy: installed,
  };
}

function flatten(value, prefix = '', out = {}) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out[prefix] = value;
  }
  return out;
}

/** Settings that differ between two fingerprints: [{ key, before, after }], sorted by key. */
export function diffFingerprints(before, after) {
  const left = flatten(before ?? {});
  const right = flatten(after ?? {});
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys
    .filter((key) => JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null))
    .map((key) => ({ key, before: left[key] ?? null, after: right[key] ?? null }));
}
