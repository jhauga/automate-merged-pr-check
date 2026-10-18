// Stands in for the GitHub CLI in tests. Answers `gh pr view <url> --json ...`
// and `gh pr diff <url>` from the fixture file that FAKE_GH_FIXTURES names,
// and fails every other call, as gh does for a request it cannot serve.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [command, action, url] = args;
const fixtures = JSON.parse(readFileSync(process.env.FAKE_GH_FIXTURES, 'utf8'));
const match = /\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url ?? '');
const entry = match ? fixtures[`${match[1]}/${match[2]}#${match[3]}`] : null;

if (command === 'pr' && action === 'view' && entry) {
  process.stdout.write(JSON.stringify(entry.view));
} else if (command === 'pr' && action === 'diff' && entry) {
  process.stdout.write(entry.diff ?? '');
} else {
  process.stderr.write(`HTTP 404: fake gh has no answer for: gh ${args.join(' ')}\n`);
  process.exit(1);
}
