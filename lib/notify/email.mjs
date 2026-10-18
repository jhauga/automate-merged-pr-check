import path from 'node:path';

/**
 * Sends email through the send-email engine, rooted at the copy's own notify/
 * folder so it reads only notify/config/accounts/<account>.js. The engine is
 * loaded and initialized on the first send, never for a dry run.
 */
export function createEmailSender({ workRoot, account }) {
  let engine = null;
  return {
    async send(message) {
      if (!engine) {
        const { EmailEngine, createEngineConfig } = await import('@isocialpractice/send-email');
        engine = new EmailEngine(createEngineConfig(path.join(workRoot, 'notify')));
        await engine.initialize(account);
      }
      const result = await engine.sendEmail(message);
      if (!result.success) throw result.error ?? new Error(`send-email could not send to ${result.recipient}`);
      return result;
    },
  };
}
