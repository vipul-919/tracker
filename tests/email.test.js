import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailTransport, emailDeliveryError } from '../server/email.js';

test('SMTP requires complete configuration and a valid port', () => {
  assert.throws(() => createEmailTransport({}), { status: 503 });
  const environment = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'user', SMTP_PASSWORD: 'private', SMTP_FROM_EMAIL: 'sender@example.test' };
  for (const SMTP_PORT of ['0', '65536', '587.5', 'invalid']) {
    assert.throws(() => createEmailTransport({ ...environment, SMTP_PORT }), { status: 503 });
  }
  for (const SMTP_PORT of ['465', '587']) {
    const transport = createEmailTransport({ ...environment, SMTP_PORT });
    assert.equal(transport.options.secure, SMTP_PORT === '465');
    assert.equal(transport.options.requireTLS, SMTP_PORT !== '465');
    transport.close();
  }
});

test('delivery diagnostics never expose raw provider errors', () => {
  for (const code of ['EAUTH', 'ETIMEDOUT', 'EENVELOPE', 'UNKNOWN']) {
    const message = emailDeliveryError({ code, message: 'private-password invitation-token', response: 'private-password' });
    assert.doesNotMatch(message, /private-password|invitation-token/);
  }
  assert.match(emailDeliveryError({ code: 'EAUTH' }), /authentication/);
});


test('Brevo sends one recipient with server-controlled sender and both content formats', async () => {
  const { sendBrevoEmail } = await import('../server/email.js');
  const environment = { BREVO_API_KEY: 'private-key', BREVO_FROM_EMAIL: 'sender@example.test' };
  const result = await sendBrevoEmail({ to: 'recipient@example.test', subject: 'Test', text: 'Hello', html: '<p>Hello</p>', from: 'attacker@example.test' }, environment, async (url, options) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, [{ email: 'recipient@example.test' }]);
    assert.equal(body.sender.email, environment.BREVO_FROM_EMAIL);
    assert.equal(body.textContent, 'Hello');
    assert.equal(body.htmlContent, '<p>Hello</p>');
    return { ok: true, json: async () => ({ messageId: 'accepted' }) };
  });
  assert.deepEqual(result, { messageId: 'accepted' });
});

test('Brevo rejects invalid recipients and safely handles provider failures', async () => {
  const { sendBrevoEmail } = await import('../server/email.js');
  const environment = { BREVO_API_KEY: 'private-key', BREVO_FROM_EMAIL: 'sender@example.test' };
  const message = { to: 'recipient@example.test', subject: 'Test', text: 'Hello' };
  await assert.rejects(sendBrevoEmail({ ...message, to: ['one@example.test', 'two@example.test'] }, environment));
  for (const [status, code] of [[401, 'EAUTH'], [403, 'EAUTH'], [429, 'ERATELIMIT'], [500, 'EPROVIDER']]) {
    await assert.rejects(sendBrevoEmail(message, environment, async () => ({ ok: false, status })), error => error.code === code && !error.message.includes('private-key'));
  }
  await assert.rejects(sendBrevoEmail(message, environment, async () => { throw new Error('private-key'); }), { code: 'ECONNECTION' });
});
