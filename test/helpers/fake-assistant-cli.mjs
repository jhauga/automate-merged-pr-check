// Stands in for an assistant command in tests. It accepts only the models
// FAKE_ASSISTANT_MODELS lists, answers --help with the effort levels
// FAKE_ASSISTANT_EFFORT lists, and records every call in FAKE_ASSISTANT_LOG.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const accepted = (process.env.FAKE_ASSISTANT_MODELS ?? '').split(',').filter(Boolean);
const efforts = process.env.FAKE_ASSISTANT_EFFORT ?? 'low, medium, high, xhigh, max';

if (process.env.FAKE_ASSISTANT_LOG) appendFileSync(process.env.FAKE_ASSISTANT_LOG, `${args.join(' ')}\n`);

if (args.includes('--help')) {
  process.stdout.write(`  --effort <level>   Effort level for the current session\n                     (${efforts})\n`);
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}

if (args.includes('--version')) {
  process.stdout.write(`${process.env.FAKE_ASSISTANT_VERSION ?? '1.0.0'} (Fake Assistant)\n`);
  process.exit(0);
}

const model = args[args.indexOf('--model') + 1];
if (args.includes('--model') && !accepted.includes(model)) {
  process.stderr.write(`warning: this workspace has not been trusted\nAPI Error: 400 "${model}" is not a model this version knows.\n`);
  process.exit(1);
}

process.stdout.write('OK\n');
