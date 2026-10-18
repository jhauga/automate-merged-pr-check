import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { FLAGS } from '../../lib/context.mjs';
import { MARKER_FILE } from '../../lib/paths.mjs';

/** The label of each flag, by key. */
const LABELS = new Map(FLAGS.map((flag) => [flag.key, flag.label]));

/**
 * Writes a test folder's form with the flags a test needs, and nothing else.
 * Fields the test does not name stay empty, which reads as false.
 */
export function writeForm(dir, flags = {}, { prContext = '', name = path.basename(dir) } = {}) {
  const lines = ['# `automate-merged-pr-check`', '', '## Test Context', '', `- **Test folder name**: ${name}`];
  if (prContext) lines.push(`- **PR Context**: ${prContext}`);
  for (const flag of FLAGS) {
    if (flags[flag.key] === undefined) continue;
    const indent = ['localCommit', 'remotePush', 'makePr'].includes(flag.key) ? '  ' : '';
    lines.push(`${indent}- **${LABELS.get(flag.key)}**: ${flags[flag.key]}`);
  }
  lines.push('');
  const file = path.join(dir, MARKER_FILE);
  writeFileSync(file, lines.join('\n'));
  return file;
}
