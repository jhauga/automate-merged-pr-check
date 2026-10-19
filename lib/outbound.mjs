import os from 'node:os';

const PUBLIC_EMAIL = /@(example\.(com|org|net)|users\.noreply\.github\.com)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const WINDOWS_PROFILE = /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\(?!<)[^\\\s`'"]+/gi;
const POSIX_HOME = /(?:^|[\s`'"(])\/(?:home|Users)\/(?!<)[^/\s`'"]+/g;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Names of this machine and its user that must never leave it. */
export function localNames({ home = os.homedir(), username = safe(() => os.userInfo().username), hostname = os.hostname(), extra = [] } = {}) {
  return [home, username, hostname, ...extra].filter((name) => typeof name === 'string' && name.trim().length >= 3).map((name) => name.trim());
}

function safe(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * Problems that keep text from leaving the machine: profile paths, the
 * machine's own names, and email addresses other than placeholder ones.
 * `names` lists more strings that must not appear, such as the local git
 * identity. `secrets` lists values such as passwords, which a problem reports
 * without repeating them. Each problem names its line.
 */
export function outboundProblems(text, { names = localNames(), secrets = [] } = {}) {
  const problems = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    const at = index + 1;
    for (const match of line.matchAll(WINDOWS_PROFILE)) problems.push({ line: at, kind: 'local path', text: match[0] });
    for (const match of line.matchAll(POSIX_HOME)) problems.push({ line: at, kind: 'local path', text: match[0].trim() });
    for (const match of line.matchAll(EMAIL)) {
      if (!PUBLIC_EMAIL.test(match[0])) problems.push({ line: at, kind: 'email address', text: match[0] });
    }
    for (const name of names) {
      if (new RegExp(`(^|[^A-Za-z0-9])${escape(name)}($|[^A-Za-z0-9])`, 'i').test(line)) problems.push({ line: at, kind: 'local name', text: name });
    }
    for (const secret of secrets.filter((value) => typeof value === 'string' && value.length >= 3)) {
      if (line.includes(secret)) problems.push({ line: at, kind: 'a password from test-configuration.md', text: null });
    }
  });
  return problems;
}

/** The problems as lines for an error message. A secret is named by its kind only. */
export function describeProblems(label, problems) {
  return problems.slice(0, 10).map((problem) => `${label}:${problem.line}: ${problem.kind}${problem.text === null ? '' : ` "${problem.text}"`}`);
}
