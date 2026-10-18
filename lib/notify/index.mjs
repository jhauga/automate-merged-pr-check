import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createEmailSender } from './email.mjs';
import { postWebhook } from './webhook.mjs';

export { buildMessage, testMessage } from './message.mjs';

/** File a dry run writes the rendered notifications to, in the run's result folder. */
export const DRY_RUN_FILE = 'notify.txt';

const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

/**
 * The deliveries a message makes under the notify settings: email to
 * notify.email.to, a short text to the carrier email-to-text addresses in
 * notify.sms.to through the same account, and the webhook.
 */
export function plannedDeliveries(notify, message) {
  const deliveries = [];
  if (notify.email?.enabled && notify.email.to?.length > 0) {
    deliveries.push({ channel: 'email', email: { from: notify.email.from, to: notify.email.to, subject: message.subject, text: message.text } });
  }
  if (notify.sms?.enabled && notify.sms.to?.length > 0) {
    deliveries.push({ channel: 'sms', email: { from: notify.email.from, to: notify.sms.to, subject: 'auto-check', text: message.short } });
  }
  if (notify.webhook?.enabled && notify.webhook.url) {
    deliveries.push({ channel: 'webhook', webhook: { url: notify.webhook.url, format: notify.webhook.format } });
  }
  return deliveries;
}

/** The deliveries as plain text, as a dry run writes them. */
export function renderDeliveries(deliveries, message) {
  return deliveries.map(({ channel, email, webhook }) => {
    if (email) return [channel, `From: ${email.from}`, `To: ${email.to.join(', ')}`, `Subject: ${email.subject}`, '', email.text.trimEnd()].join('\n');
    const body = webhook.format === 'text' ? message.short : JSON.stringify(message.payload, null, 2);
    return [channel, `POST ${webhook.url}`, `Format: ${webhook.format}`, '', body].join('\n');
  }).join('\n\n---\n\n').concat('\n');
}

/**
 * Sends a message on every enabled channel, or with `dryRun` writes what it
 * would send to <outDir>/notify.txt and never starts the email engine. One
 * channel failing does not stop the others. Returns what was sent, what
 * failed, and the dry run file.
 */
export async function sendNotifications({ workRoot, notify, message, outDir = null, dryRun = false, env = process.env, deps = {} }) {
  const deliveries = plannedDeliveries(notify, message);
  if (deliveries.length === 0) return { channels: [], sent: [], failed: [], dryRun, file: null, note: 'no notification channel is enabled' };
  const channels = deliveries.map((delivery) => delivery.channel);
  if (dryRun) {
    let file = null;
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      file = path.join(outDir, DRY_RUN_FILE);
      writeFileSync(file, renderDeliveries(deliveries, message));
    }
    return { channels, sent: [], failed: [], dryRun: true, file, text: renderDeliveries(deliveries, message) };
  }

  const sender = (deps.emailSender ?? createEmailSender)({ workRoot, account: notify.email?.account ?? '_default' });
  const fetchImpl = deps.fetch ?? fetch;
  const passwordEnv = notify.email?.smtp?.passwordEnv;
  const sent = [];
  const failed = [];
  for (const delivery of deliveries) {
    try {
      if (delivery.email) {
        if ((notify.email.account ?? '_default') === '_default' && passwordEnv && !env[passwordEnv]) {
          throw new Error(`${passwordEnv} is not set; put the email password there, as .env.example shows`);
        }
        await sender.send(delivery.email);
      } else {
        const secret = notify.webhook.secretEnv ? env[notify.webhook.secretEnv] || null : null;
        await postWebhook({ url: delivery.webhook.url, format: delivery.webhook.format, secret, message, fetchImpl });
      }
      sent.push(delivery.channel);
    } catch (error) {
      failed.push({ channel: delivery.channel, error: firstLine(error.message) });
    }
  }
  return { channels, sent, failed, dryRun: false, file: null };
}

/** One line that says what a notification attempt did. */
export function describeNotification(result, { workRoot }) {
  if (!result) return null;
  if (result.channels.length === 0) return `Notification: none sent, ${result.note}.`;
  if (result.dryRun) return `Notification: dry run, ${result.channels.join(' and ')} written to ${result.file ? path.relative(workRoot, result.file) : 'the terminal'}.`;
  const parts = [];
  if (result.sent.length > 0) parts.push(`sent by ${result.sent.join(' and ')}`);
  for (const failure of result.failed) parts.push(`${failure.channel} failed: ${failure.error}`);
  return `Notification: ${parts.join('; ')}.`;
}
