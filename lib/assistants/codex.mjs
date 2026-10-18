import { AssistantError, attachmentNote } from './shared.mjs';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;

const SANDBOX = {
  'workspace-write': ['--sandbox', 'workspace-write'],
  'read-only': ['--sandbox', 'read-only'],
  'danger-full-access': ['--sandbox', 'danger-full-access'],
  default: [],
};

/**
 * Codex: `codex exec` with the prompt on stdin through the "-" argument.
 * --add-dir is a global flag, so it comes before exec. Images go through
 * --image, and other attachments are listed in the prompt. The model is `-m`,
 * and the thinking effort is a configuration override, which is how Codex
 * takes it. Not verified against a Codex installation yet.
 */
export default {
  command: 'codex',
  label: 'Codex',
  build(request, { permissionMode }) {
    if (!Object.hasOwn(SANDBOX, permissionMode)) {
      throw new AssistantError(`Unknown Codex permission mode "${permissionMode}".`);
    }
    if (request.sessionName || request.sessionId || request.resume) {
      throw new AssistantError('The Codex adapter does not name or resume sessions.');
    }
    const args = [];
    for (const dir of request.addDirs) args.push('--add-dir', dir);
    args.push('exec', ...SANDBOX[permissionMode]);
    if (request.model) args.push('-m', request.model);
    if (request.effort) args.push('-c', `model_reasoning_effort=${request.effort}`);
    const images = request.attachments.filter((file) => IMAGE.test(file));
    for (const image of images) args.push('--image', image);
    args.push('-');
    const others = request.attachments.filter((file) => !IMAGE.test(file));
    return { args, input: request.prompt + attachmentNote(others) };
  },
  sessionIdFrom() {
    return null;
  },
};
