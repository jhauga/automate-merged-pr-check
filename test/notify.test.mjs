import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { defaults } from '../lib/config.mjs';
import { runAccount } from '../lib/notify/account.mjs';
import { NOTIFY_ROOT, createEmailSender, smtpFor } from '../lib/notify/email.mjs';
import { DRY_RUN_FILE, buildMessage, describeNotification, plannedDeliveries, sendNotifications, testMessage } from '../lib/notify/index.mjs';
import { codeRoot } from '../lib/paths.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-notify-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const check = { pr: { url: 'https://github.com/acme/demo-app/pull/123' } };

function failedRecord(overrides = {}) {
  return {
    outcome: 'fail',
    simulated: false,
    upstreamSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    sourceMode: 'upstream',
    signature: '0123456789abcdef',
    runner: { finishedAt: '2026-01-02T08:15:00.000Z', exitCode: 1 },
    assertions: [{ name: 'the drawing surface fills its view', ok: false, detail: 'canvas 1x1 in a 1280x800 view', layer: 'page' }],
    compare: { failures: [{ artifact: 'page-initial', method: 'color-sample' }] },
    failing: ['page: the drawing surface fills its view', 'compare page-initial color-sample'],
    ...overrides,
  };
}

function notifySettings({ email = true, sms = true, webhook = null } = {}) {
  const notify = defaults().notify;
  notify.email.enabled = email;
  notify.sms.enabled = sms;
  if (webhook) notify.webhook = { ...notify.webhook, enabled: true, ...webhook };
  return notify;
}

test('a failure becomes a subject, an email body, a short text, and a JSON payload', () => {
  const root = path.join(base, 'automate-pr-demo-app');
  const message = buildMessage({
    workRoot: root,
    slug: 'acme-demo-app-pr-123',
    check,
    record: failedRecord(),
    resultFile: path.join(root, 'results', '2026-01-02T03-15-00', 'result.json'),
    decision: { reason: 'fail' },
    foundIssue: path.join(root, 'found-issue', '01-02-2026', 'found-issue.md'),
  });
  assert.equal(message.subject, 'auto-check: acme-demo-app-pr-123 failed');
  assert.equal(message.short, 'auto-check: acme-demo-app-pr-123 failed: the drawing surface fills its view');
  assert.match(message.text, /^acme-demo-app-pr-123 failed\.\n\nPull request: https:\/\/github\.com\/acme\/demo-app\/pull\/123\nOutcome: fail, exit code 1\nCode under test: upstream a1b2c3d\nFailed: page: the drawing surface fills its view \(canvas 1x1 in a 1280x800 view\)\nDiffers from the baseline: page-initial, color-sample\nFailure report: found-issue\/01-02-2026\/found-issue\.md\nResult: results\/2026-01-02T03-15-00\/result\.json\nSignature: 0123456789abcdef\n$/);
  assert.deepEqual(message.payload.failing, ['page: the drawing surface fills its view', 'compare page-initial color-sample']);
  assert.equal(message.payload.foundIssue, 'found-issue/01-02-2026/found-issue.md');

  const simulated = buildMessage({ workRoot: root, slug: 'acme-demo-app-pr-123', check, record: failedRecord({ simulated: true }), decision: { reason: 'fail' } });
  assert.match(simulated.subject, /^\[simulated\] /);
  assert.match(simulated.text, /This failure was simulated with --simulate-fail\. There is nothing to fix\.\n$/);
  const long = buildMessage({ workRoot: root, slug: 'acme-demo-app-pr-123', check, record: failedRecord({ assertions: [{ name: 'x'.repeat(300), ok: false, layer: 'page' }] }), decision: { reason: 'fail' } });
  assert.equal(long.short.length, 140);
  assert.equal(buildMessage({ workRoot: root, slug: 'acme-demo-app-pr-123', check, record: { outcome: 'pass' }, decision: { reason: 'recover' } }).subject, 'auto-check: acme-demo-app-pr-123 passes again');
});

test('only enabled channels with recipients are planned, and a dry run writes them all to notify.txt', async () => {
  assert.deepEqual(plannedDeliveries(notifySettings({ email: false, sms: false }), testMessage({ workRoot: base })), []);
  const notify = notifySettings({ webhook: { url: 'https://ntfy.example.com/auto-check', format: 'text' } });
  assert.deepEqual(plannedDeliveries(notify, testMessage({ workRoot: base })).map((delivery) => delivery.channel), ['email', 'sms', 'webhook']);

  const outDir = path.join(base, 'dry-run');
  let started = false;
  const result = await sendNotifications({
    workRoot: base,
    notify,
    message: testMessage({ workRoot: base }),
    outDir,
    dryRun: true,
    deps: { emailSender: () => { started = true; return { send: async () => {} }; } },
  });
  assert.equal(started, false);
  assert.deepEqual(result.channels, ['email', 'sms', 'webhook']);
  const text = readFileSync(path.join(outDir, DRY_RUN_FILE), 'utf8');
  assert.match(text, /^email\nFrom: auto-check@example\.com\nTo: jane\.doe@example\.com\nSubject: auto-check: test message\n\nThis is a test message from auto-check/);
  assert.match(text, /\n---\n\nsms\nFrom: auto-check@example\.com\nTo: 5551234567@txt\.example\.com\nSubject: auto-check\n\nauto-check: test message from /);
  assert.match(text, /\n---\n\nwebhook\nPOST https:\/\/ntfy\.example\.com\/auto-check\nFormat: text\n/);
  assert.match(describeNotification(result, { workRoot: base }), /^Notification: dry run, email and sms and webhook written to dry-run[\\/]notify\.txt\.$/);
});

test('the real send-email engine sends one email and one text through a JSON transport, so nothing leaves the machine', async () => {
  const root = path.join(base, 'engine');
  const accounts = path.join(root, 'notify', 'config', 'accounts');
  mkdirSync(accounts, { recursive: true });
  const nodemailer = pathToFileURL(createRequire(import.meta.url).resolve('nodemailer')).href;
  writeFileSync(path.join(accounts, 'jsontest.js'), [
    "import { appendFileSync } from 'node:fs';",
    `import nodemailer from '${nodemailer}';`,
    '',
    'const json = nodemailer.createTransport({ jsonTransport: true });',
    'export const transporter = {',
    '  options: json.options,',
    '  async sendMail(message) {',
    '    const info = await json.sendMail(message);',
    "    appendFileSync(new URL('./sent.jsonl', import.meta.url), `${info.message}\\n`);",
    '    return info;',
    '  },',
    '};',
    '',
  ].join('\n'));
  const notify = notifySettings();
  notify.email.account = 'jsontest';
  const result = await sendNotifications({ notify, message: testMessage({ workRoot: root }), env: {}, deps: { notifyRoot: path.join(root, 'notify') } });
  assert.deepEqual(result.sent, ['email', 'sms']);
  assert.deepEqual(result.failed, []);
  const sent = readFileSync(path.join(accounts, 'sent.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(sent.map((mail) => [mail.from.address, mail.to.map((to) => to.address), mail.subject]), [
    ['auto-check@example.com', ['jane.doe@example.com'], 'auto-check: test message'],
    ['auto-check@example.com', ['5551234567@txt.example.com'], 'auto-check'],
  ]);
});

test('the default account needs its password variable, and one failing channel does not stop the others', async () => {
  const sends = [];
  const result = await sendNotifications({
    workRoot: base,
    notify: notifySettings({ webhook: { url: 'https://ntfy.example.com/auto-check', format: 'text' } }),
    message: testMessage({ workRoot: base }),
    env: {},
    deps: {
      emailSender: () => ({ send: async (mail) => sends.push(mail) }),
      fetch: async () => ({ ok: true, status: 200 }),
    },
  });
  assert.equal(sends.length, 0);
  assert.deepEqual(result.sent, ['webhook']);
  assert.deepEqual(result.failed.map((failure) => failure.channel), ['email', 'sms']);
  assert.match(result.failed[0].error, /^AUTO_CHECK_SMTP_PASSWORD is not set/);
  assert.match(describeNotification(result, { workRoot: base }), /^Notification: sent by webhook; email failed: AUTO_CHECK_SMTP_PASSWORD is not set/);
});

test('the shipped _default account sends with the transport handed over in memory, and holds nothing afterwards', async () => {
  const sender = createEmailSender({ transport: { jsonTransport: true } });
  const result = await sender.send({ from: 'auto-check@example.com', to: ['jane.doe@example.com'], subject: 'auto-check: test message', text: 'hello' });
  assert.equal(result.success, true);
  assert.deepEqual(runAccount(), {});
  await assert.rejects(createEmailSender().send({ to: ['jane.doe@example.com'] }), /no email account is set to send from/);
});

test('the sender is rooted at the tool\'s own notify folder, whatever folder the run is in', async () => {
  const roots = [];
  const loadEngine = async () => ({
    createEngineConfig: (root) => ({ root }),
    EmailEngine: class {
      constructor(config) {
        roots.push(config.root);
      }

      async initialize() {}

      async sendEmail() {
        return { success: true };
      }
    },
  });
  await createEmailSender({ transport: { jsonTransport: true }, loadEngine }).send({});
  assert.deepEqual(roots, [NOTIFY_ROOT]);
  assert.equal(NOTIFY_ROOT, path.join(codeRoot, 'notify'));
});

test('an account\'s SMTP server comes from its domain, then from the settings, and never from the placeholder', () => {
  assert.deepEqual(smtpFor('demo-user@gmail.com'), { host: 'smtp.gmail.com', port: 465, secure: true });
  assert.deepEqual(smtpFor('jane.doe@example.net', { host: 'mail.example.net', port: 587, secure: false }), { host: 'mail.example.net', port: 587, secure: false });
  assert.deepEqual(smtpFor('jane.doe@example.net', { service: 'SendGrid' }), { service: 'SendGrid' });
  assert.throws(() => smtpFor('jane.doe@example.net', defaults().notify.email.smtp), /^Error: no SMTP server is known for example\.net; set notify\.email\.smtp\.host and notify\.email\.smtp\.port with auto-check config set$/);
});

test('a test\'s own account sends from and to its address, with the password read at send time and never shown', async () => {
  const secret = 'correct-horse-battery-staple';
  const notify = notifySettings({ email: false, sms: false });
  notify.email.smtp = { ...notify.email.smtp, host: 'mail.example.com', port: 587 };
  const account = { email: '%AUTO_CHECK_EMAIL%', password: '$AUTO_CHECK_EMAIL_PASSWORD' };
  const env = { AUTO_CHECK_EMAIL: 'jane.doe@example.com', AUTO_CHECK_EMAIL_PASSWORD: secret };
  const used = [];
  const sends = [];
  const emailSender = (options) => {
    used.push(options);
    return { send: async (mail) => sends.push(mail) };
  };
  const message = testMessage({ workRoot: base });
  const result = await sendNotifications({ notify, message, account, env, deps: { emailSender } });
  assert.deepEqual(result.sent, ['email']);
  assert.deepEqual(sends.map((mail) => [mail.from, mail.to]), [['jane.doe@example.com', ['jane.doe@example.com']]]);
  assert.deepEqual(used, [{ account: '_default', transport: { host: 'mail.example.com', port: 587, secure: false, auth: { user: 'jane.doe@example.com', pass: secret } } }]);

  const unset = await sendNotifications({ notify, message, account, env: { AUTO_CHECK_EMAIL: 'jane.doe@example.com' }, deps: { emailSender } });
  assert.deepEqual(unset.failed, [{ channel: 'email', error: "AUTO_CHECK_EMAIL_PASSWORD is not set; put the email password there, for example in the test folder's .env" }]);

  const outDir = path.join(base, 'account-dry-run');
  const dry = await sendNotifications({ notify, message, account, env, outDir, dryRun: true });
  const written = readFileSync(path.join(outDir, DRY_RUN_FILE), 'utf8');
  assert.equal(dry.dryRun, true);
  assert.match(written, /^From: jane\.doe@example\.com\nTo: jane\.doe@example\.com$/m);
  for (const text of [written, JSON.stringify(result), JSON.stringify(unset), JSON.stringify(dry)]) assert.ok(!text.includes(secret));

  const literal = await sendNotifications({ notify, message, account: { email: 'jane.doe@example.com', password: secret }, env: {}, deps: { emailSender } });
  assert.deepEqual(literal.sent, ['email']);
  assert.equal(used.at(-1).transport.auth.pass, secret);
});

test('webhooks post JSON or plain text, with the secret as a bearer token', async () => {
  const received = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      response.writeHead(received.length === 3 ? 500 : 200).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/hook`;
  try {
    const message = buildMessage({ workRoot: base, slug: 'acme-demo-app-pr-123', check, record: failedRecord(), decision: { reason: 'fail' } });
    const env = { AUTO_CHECK_WEBHOOK_SECRET: 'placeholder-secret' };
    const json = await sendNotifications({ workRoot: base, notify: notifySettings({ email: false, sms: false, webhook: { url, format: 'json' } }), message, env });
    assert.deepEqual(json.sent, ['webhook']);
    assert.equal(received[0].headers.authorization, 'Bearer placeholder-secret');
    assert.equal(received[0].headers['content-type'], 'application/json');
    assert.equal(JSON.parse(received[0].body).slug, 'acme-demo-app-pr-123');

    await sendNotifications({ workRoot: base, notify: notifySettings({ email: false, sms: false, webhook: { url, format: 'text' } }), message, env: {} });
    assert.equal(received[1].body, 'auto-check: acme-demo-app-pr-123 failed: the drawing surface fills its view');
    assert.equal(received[1].headers.title, 'auto-check: acme-demo-app-pr-123 failed');
    assert.equal(received[1].headers.authorization, undefined);

    const refused = await sendNotifications({ workRoot: base, notify: notifySettings({ email: false, sms: false, webhook: { url, format: 'text' } }), message, env: {} });
    assert.deepEqual(refused.failed, [{ channel: 'webhook', error: 'the webhook answered 500 Internal Server Error' }]);
  } finally {
    server.close();
  }
  assert.equal(existsSync(path.join(base, DRY_RUN_FILE)), false);
});
