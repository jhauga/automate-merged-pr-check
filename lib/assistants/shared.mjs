/** Raised when an assistant cannot be set up or started. */
export class AssistantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssistantError';
    this.exitCode = 2;
  }
}

/** The items, with repeats removed, in the order they first appear. */
export const unique = (items) => [...new Set(items)];

/** Section appended to a prompt that lists attached files by absolute path. */
export function attachmentNote(files) {
  if (files.length === 0) return '';
  return `\n\n## Attached files\n\nRead these files as part of the task:\n\n${files.map((file) => `- ${file}`).join('\n')}\n`;
}

/** One-line prompt that points an assistant at the full prompt file. */
export function pointerPrompt(promptFile) {
  return `Read the file ${promptFile} and carry out the instructions in it. That file is the complete task.`;
}

/** Throws unless `value` is one of `allowed`. */
export function oneOf(label, value, allowed) {
  if (!allowed.includes(value)) throw new AssistantError(`${label} must be one of ${allowed.join(', ')}; got "${value}".`);
  return value;
}
