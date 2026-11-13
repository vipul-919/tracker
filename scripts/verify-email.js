import { createEmailTransport, emailDeliveryError, brevoRequest, sendConfiguredEmail } from '../server/email.js';

let transport;
try {
  const url = new URL(process.env.APP_URL || '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
} catch {
  console.error('Set APP_URL to the application URL used by invitation recipients.');
  process.exitCode = 1;
}
try {
  if (process.env.BREVO_API_KEY?.trim()) {
    await brevoRequest('/account');
    const result = await brevoRequest('/senders');
    if (!result.senders?.some(sender => sender.email?.toLowerCase() === process.env.BREVO_FROM_EMAIL?.trim().toLowerCase() && sender.active)) throw Object.assign(new Error('Sender not verified'), { code: 'EPROVIDER' });
    console.log('Brevo authentication and active sender checks passed.');
    if (process.argv.includes('--send-test') && !process.exitCode) {
      await sendConfiguredEmail({ to: process.env.EMAIL_TEST_TO, subject: 'Tempo email delivery test', text: 'Tempo successfully submitted this email using the same service used for workspace invitations and password recovery.', html: '<p>Tempo successfully submitted this email using the same service used for workspace invitations and password recovery.</p>' });
      console.log('Test email accepted by Brevo for EMAIL_TEST_TO. Check inbox and spam; acceptance does not prove delivery.');
    }
  } else {
    transport = createEmailTransport();
    await transport.verify();
  }
  console.log('Email verification completed. Inbox delivery must be confirmed by the recipient.');
} catch (error) {
  console.error(emailDeliveryError(error));
  process.exitCode = 1;
} finally {
  transport?.close();
}
