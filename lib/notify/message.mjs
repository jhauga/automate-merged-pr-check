import path from 'node:path';

/** Longest text message auto-check sends, so carriers deliver it as one message. */
export const TEXT_LIMIT = 140;

const VERBS = {
  fail: 'failed',
  'repeat fail': 'failed',
  error: 'could not run',
  'repeat error': 'could not run',
  recover: 'passes again',
  pass: 'passed',
  test: 'sent a test message',
};

const slash = (value) => value.split(path.sep).join('/');
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

/**
 * The notification for a run, in each form a channel needs: an email subject
 * and body, a short text for carrier gateways and push services, and a JSON
 * payload for webhooks.
 */
export function buildMessage({ workRoot, slug, check, record, resultFile, decision, foundIssue = null }) {
  const verb = VERBS[decision.reason] ?? record.outcome;
  const tag = record.simulated ? '[simulated] ' : '';
  const rel = (file) => (file ? slash(path.relative(workRoot, file)) : null);
  const failed = (record.assertions ?? []).filter((entry) => !entry.ok);
  const differs = record.compare?.failures ?? [];
  const lines = [`${slug} ${verb}.`, ''];
  if (check.pr?.url) lines.push(`Pull request: ${check.pr.url}`);
  lines.push(`Outcome: ${record.outcome}${record.runner?.exitCode !== undefined && record.runner?.exitCode !== null ? `, exit code ${record.runner.exitCode}` : ''}`);
  if (record.upstreamSha) lines.push(`Code under test: ${record.sourceMode ?? 'upstream'} ${record.upstreamSha.slice(0, 7)}`);
  if (record.error) lines.push(`Error: ${firstLine(record.error)}`);
  for (const entry of failed.slice(0, 5)) lines.push(`Failed: ${entry.layer}: ${entry.name}${entry.detail ? ` (${entry.detail.slice(0, 160)})` : ''}`);
  if (failed.length > 5) lines.push(`Failed: and ${failed.length - 5} more`);
  for (const entry of differs.slice(0, 3)) lines.push(`Differs from the baseline: ${entry.artifact}, ${entry.method}`);
  if (foundIssue) lines.push(`Failure report: ${rel(foundIssue)}`);
  if (resultFile) lines.push(`Result: ${rel(resultFile)}`);
  if (record.signature) lines.push(`Signature: ${record.signature}`);
  if (record.simulated) lines.push('', 'This failure was simulated with --simulate-fail. There is nothing to fix.');

  const first = failed[0]?.name ?? (differs[0] ? `${differs[0].artifact} differs from its baseline` : firstLine(record.error));
  const short = `${tag}auto-check: ${slug} ${verb}${first && record.outcome !== 'pass' ? `: ${first}` : ''}`;
  return {
    subject: `${tag}auto-check: ${slug} ${verb}`,
    text: `${lines.join('\n')}\n`,
    short: short.length > TEXT_LIMIT ? `${short.slice(0, TEXT_LIMIT - 3)}...` : short,
    payload: {
      event: decision.reason,
      slug,
      outcome: record.outcome,
      simulated: Boolean(record.simulated),
      pr: check.pr?.url ?? null,
      upstreamSha: record.upstreamSha ?? null,
      failing: (record.failing ?? []).slice(0, 10),
      error: record.error ? firstLine(record.error) : null,
      foundIssue: rel(foundIssue),
      result: rel(resultFile),
      signature: record.signature ?? null,
      at: record.runner?.finishedAt ?? new Date().toISOString(),
    },
  };
}

/** The message `auto-check notify test` sends to every enabled channel. */
export function testMessage({ workRoot }) {
  const name = path.basename(workRoot);
  return {
    subject: 'auto-check: test message',
    text: `This is a test message from auto-check in ${name}.\nIf you can read it, this channel works.\n`,
    short: `auto-check: test message from ${name}`,
    payload: { event: 'test', slug: null, outcome: null, simulated: false, at: new Date().toISOString() },
  };
}
