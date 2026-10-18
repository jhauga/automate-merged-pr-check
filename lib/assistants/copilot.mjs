import path from 'node:path';
import { AssistantError, oneOf, pointerPrompt } from './shared.mjs';

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const TIERS = ['efficiency', 'balance', 'intelligence'];

function findSessionId(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of ['sessionId', 'session_id']) {
    if (typeof value[key] === 'string') return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findSessionId(child);
    if (found) return found;
  }
  return null;
}

/**
 * GitHub Copilot CLI: `copilot -p` with a one-line prompt that points at the
 * prompt file, which keeps long prompts off the command line. Runs without a
 * person need --allow-all-tools.
 */
export default {
  command: 'copilot',
  label: 'GitHub Copilot CLI',
  build(request, { permissionMode }) {
    if (permissionMode !== 'allow-all-tools') {
      throw new AssistantError(
        'GitHub Copilot CLI runs without a person only with --allow-all-tools. '
          + 'Set assistants.copilot.permissionMode to "allow-all-tools".',
      );
    }
    const args = ['-p', pointerPrompt(request.promptFile), '--allow-all-tools'];
    args.push(...(request.structured ? ['--output-format', 'json'] : ['-s']));
    if (request.model) {
      args.push('--model', request.model);
      if (request.model === 'auto' && request.autoTier) {
        args.push('--auto-tier', oneOf('Copilot auto tier', request.autoTier, TIERS));
      }
    }
    if (request.effort) args.push('--reasoning-effort', oneOf('Copilot reasoning effort', request.effort, EFFORTS));
    if (request.sessionName) args.push('--name', request.sessionName);
    if (request.sessionId) args.push('--session-id', request.sessionId);
    if (request.resume) args.push('--resume', request.resume);
    for (const dir of request.addDirs) args.push('--add-dir', dir);
    for (const file of request.attachments) args.push('--attachment', file);
    if (request.transcriptFile) args.push('--share', path.resolve(request.transcriptFile));
    return { args, input: undefined };
  },
  sessionIdFrom(stdout) {
    for (const line of stdout.split(/\r?\n/)) {
      try {
        const found = findSessionId(JSON.parse(line));
        if (found) return found;
      } catch {
        // Plain-text lines carry no session id.
      }
    }
    return null;
  },
};
