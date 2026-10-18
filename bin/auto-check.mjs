#!/usr/bin/env node
import { main } from '../lib/cli.mjs';
import { exitOnBrokenPipe } from '../lib/util/streams.mjs';

exitOnBrokenPipe(process.stdout);
exitOnBrokenPipe(process.stderr);

process.exitCode = await main(process.argv.slice(2));
