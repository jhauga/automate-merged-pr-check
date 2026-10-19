/**
 * The account notify/config/accounts/_default.js exports. send-email reads it
 * once, when its engine starts, so this one object is filled in place right
 * before that and emptied right after. It lives only in this process's memory:
 * nothing about the account is written to disk or put in the environment.
 */
const account = {};

/** Fills the account send-email starts from with a nodemailer transport, or empties it. */
export function setRunAccount(transport = null) {
  for (const key of Object.keys(account)) delete account[key];
  if (transport) Object.assign(account, transport);
}

/** The account object _default.js hands to send-email. */
export function runAccount() {
  return account;
}
