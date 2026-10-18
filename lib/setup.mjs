import { ASSISTANTS } from './config.mjs';
import { setSetting } from './user-config.mjs';
import { firstLine } from './util/which.mjs';

/** Raised when the assistant cannot be set up. */
export class SkillsError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'SkillsError';
    this.problems = problems;
    this.exitCode = 2;
  }
}

/** What the machine reports about an assistant command: where it is, its version, and whether it is signed in. */
export function assistantState(name, probe) {
  const file = probe.which(name);
  if (!file) return { name, file: null, version: null, signedIn: null };
  const shown = probe.run(file, ['--version']);
  const version = firstLine(shown.stdout) || firstLine(shown.stderr) || 'version unknown';
  if (name !== 'claude') return { name, file, version, signedIn: null };
  const status = probe.run(file, ['auth', 'status']);
  let signedIn = null;
  try {
    const parsed = JSON.parse(status.stdout);
    if (typeof parsed.loggedIn === 'boolean') signedIn = parsed.loggedIn;
  } catch {
    signedIn = null;
  }
  return { name, file, version, signedIn };
}

/**
 * Sets the assistant that writes checks and proposes fixes, after checking
 * that its command is installed and signed in. Returns the assistant, the
 * settings file it wrote, and what the machine reported.
 */
export async function setupAssistant({ assistant, env = process.env, probe, ...options }) {
  if (!ASSISTANTS.includes(assistant)) throw new SkillsError(`Unknown assistant "${assistant}".`);
  const state = assistantState(assistant, probe);
  if (!state.file) {
    throw new SkillsError(`The ${assistant} command is not on PATH. Install it, then run auto-check setup --assistant ${assistant} again.`);
  }
  if (state.signedIn === false) {
    throw new SkillsError(`${assistant} is installed but not signed in. Sign in, then run auto-check setup --assistant ${assistant} again.`);
  }
  const { file } = await setSetting('assistant', assistant, { env, ...options });
  return { assistant, file, state };
}
