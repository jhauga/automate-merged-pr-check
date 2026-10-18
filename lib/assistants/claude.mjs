import path from 'node:path';
import { AssistantError, attachmentNote, oneOf, unique } from './shared.mjs';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Variables a running Claude Code session, or the editor or SDK host around
 * it, sets for its child processes. A run auto-check starts is a session of
 * its own, so it never inherits another session's identity or connections.
 */
const SESSION_VARIABLES = new Set([
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_EMIT_STARTUP_TIMING',
  'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
  'CLAUDE_CODE_ENABLE_TASKS',
  'MCP_CONNECTION_NONBLOCKING',
]);

const PERMISSIONS = {
  bypass: ['--dangerously-skip-permissions'],
  acceptEdits: ['--permission-mode', 'acceptEdits'],
  default: [],
};

/**
 * Claude Code: `claude --print` with the prompt on stdin. Attachments are
 * listed in the prompt and their folders added with --add-dir, which takes
 * several folders and therefore comes last.
 */
export default {
  command: 'claude',
  label: 'Claude Code',
  build(request, { permissionMode }) {
    if (!Object.hasOwn(PERMISSIONS, permissionMode)) {
      throw new AssistantError(`Unknown Claude Code permission mode "${permissionMode}".`);
    }
    const args = ['--print'];
    if (request.model) args.push('--model', request.model);
    if (request.effort) args.push('--effort', oneOf('Claude Code effort', request.effort, EFFORTS));
    if (request.structured) args.push('--output-format', 'json');
    if (request.sessionName) args.push('--name', request.sessionName);
    if (request.sessionId) args.push('--session-id', request.sessionId);
    if (request.resume) args.push('--resume', request.resume);
    args.push(...PERMISSIONS[permissionMode]);
    const dirs = unique([...request.addDirs, ...request.attachments.map((file) => path.dirname(file))]);
    if (dirs.length > 0) args.push('--add-dir', ...dirs);
    return { args, input: request.prompt + attachmentNote(request.attachments) };
  },
  environment(env) {
    return Object.fromEntries(Object.entries(env).filter(([key]) => !SESSION_VARIABLES.has(key.toUpperCase())));
  },
  sessionIdFrom(stdout) {
    try {
      return JSON.parse(stdout).session_id ?? null;
    } catch {
      return null;
    }
  },
};
