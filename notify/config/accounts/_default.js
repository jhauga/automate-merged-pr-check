// The send-email account auto-check uses for email and text notifications.
// It holds no values: right before each send, auto-check fills it in memory
// with the server and the sign-in, from the account of a test's
// test-configuration.md or from notify.email.smtp in the auto-check settings,
// with the password read from an environment variable. To use send-email's own
// credentials format instead, add <name>.js next to this file and set
// notify.email.account to <name>; files other than this one are git-ignored.
import { runAccount } from '../../../lib/notify/account.mjs';

export const account = runAccount();
