import path from 'node:path';
import wellKnown from 'nodemailer/lib/well-known/index.js';
import { defaults } from '../config.mjs';
import { codeRoot } from '../paths.mjs';
import { setRunAccount } from './account.mjs';

/** The send-email folder auto-check ships: notify/config/accounts/_default.js and nothing else. */
export const NOTIFY_ROOT = path.join(codeRoot, 'notify');

const PLACEHOLDER_HOST = defaults().notify.email.smtp.host;

/**
 * The SMTP server for an address: the one nodemailer knows for its domain,
 * else the one the settings name, unless that is still the placeholder.
 */
export function smtpFor(address, smtp = {}) {
  const domain = String(address ?? '').split('@').pop().trim().toLowerCase();
  const known = domain ? wellKnown(domain) : false;
  if (known) return { ...known };
  if (smtp.service) return { service: smtp.service };
  if (smtp.host && smtp.host !== PLACEHOLDER_HOST) return { host: smtp.host, port: smtp.port, secure: Boolean(smtp.secure) };
  throw new Error(`no SMTP server is known for ${domain || 'that address'}; set notify.email.smtp.host and notify.email.smtp.port with auto-check config set`);
}

/**
 * Sends email through the send-email engine, rooted at the tool's own notify/
 * folder. For the _default account, `transport` is the nodemailer transport
 * it starts from, handed over in memory and emptied once the engine holds it.
 * The engine is loaded and started on the first send, never for a dry run.
 */
export function createEmailSender({ account = '_default', transport = null, root = NOTIFY_ROOT, loadEngine = () => import('@isocialpractice/send-email') } = {}) {
  let engine = null;
  return {
    async send(message) {
      if (!engine) {
        if (account === '_default' && !transport) throw new Error('no email account is set to send from');
        const { EmailEngine, createEngineConfig } = await loadEngine();
        const started = new EmailEngine(createEngineConfig(root));
        if (account === '_default') setRunAccount(transport);
        try {
          await started.initialize(account);
        } finally {
          if (account === '_default') setRunAccount(null);
        }
        engine = started;
      }
      const result = await engine.sendEmail(message);
      if (!result.success) throw result.error ?? new Error(`send-email could not send to ${result.recipient}`);
      return result;
    },
  };
}
