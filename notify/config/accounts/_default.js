// The send-email account auto-check uses for email and text notifications.
// It holds no values: the server and user come from notify.email.smtp in
// the auto-check settings, and the password from the environment variable that
// notify.email.smtp.passwordEnv names. To use send-email's own credentials
// format instead, add <name>.js next to this file and set notify.email.account
// to <name>; files other than this one are git-ignored.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../../lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { notify } = await loadConfig(root);
const smtp = notify.email.smtp;
const auth = { user: smtp.user ?? '', pass: process.env[smtp.passwordEnv] ?? '' };

export const account = smtp.service
  ? { service: smtp.service, auth }
  : { host: smtp.host, port: smtp.port, secure: Boolean(smtp.secure), auth };
