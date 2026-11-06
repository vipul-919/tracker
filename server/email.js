import nodemailer from 'nodemailer';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function template(title, paragraphs, action = '') {
  const text = [title, '', ...paragraphs, action].filter(Boolean).join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8f5;color:#30362f;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e7e9e1;border-radius:8px"><p style="color:#536f53;font-size:12px;letter-spacing:2px">TEMPO</p><h1 style="font-size:24px">${escapeHtml(title)}</h1>${paragraphs.map(paragraph => `<p style="line-height:1.7">${escapeHtml(paragraph)}</p>`).join('')}${action ? `<p style="margin-top:24px;font-weight:700">${escapeHtml(action)}</p>` : ''}<p style="margin-top:32px;color:#858a80;font-size:12px">This is an automated message from Tempo.</p></main></body></html>`;
  return { text, html };
}

export function invitationEmail({ name, email, password, loginUrl }) {
  return { subject: 'Your Tempo account is ready', ...template('Welcome to Tempo', [`Hello ${name}, an account has been created for you.`, `Sign in with ${email} and change your temporary password after your first login.`, `Temporary password: ${password}`, ...(loginUrl ? [`Sign in: ${loginUrl}`] : [])], 'Keep this password private.') };
}

export function temporaryPasswordEmail({ name, email, password, loginUrl }) {
  return { subject: 'Your temporary Tempo password', ...template('Temporary password issued', [`Hello ${name}, an Admin reset your Tempo password.`, `Sign in with ${email} and change this temporary password after login.`, `Temporary password: ${password}`, ...(loginUrl ? [`Sign in: ${loginUrl}`] : [])], 'If you did not expect this message, contact your application administrator.') };
}

export function recoveryEmail({ name, code }) {
  return { subject: 'Your Tempo password recovery code', ...template('Reset your password', [`Hello ${name}, use this one-time code to reset your Tempo password.`, 'The code expires in 10 minutes.', code], 'If you did not request this, you can ignore this email.') };
}

export function passwordChangedEmail({ name }) {
  return { subject: 'Your Tempo password was changed', ...template('Password changed', [`Hello ${name}, your Tempo password has been changed.`, 'All other active sessions have been signed out.'], 'If you did not make this change, contact your application administrator.') };
}

export function deactivationEmail({ name }) {
  return { subject: 'Your Tempo account is inactive', ...template('Account access changed', [`Hello ${name}, your Tempo account has been deactivated.`, 'You will no longer be able to sign in. Contact your application administrator if you believe this is a mistake.']) };
}

export async function sendConfiguredEmail(message, environment = process.env) {
  const port = Number(environment.SMTP_PORT);
  if (!environment.SMTP_HOST || !port || !environment.SMTP_USER || !environment.SMTP_PASSWORD || !environment.SMTP_FROM_EMAIL) {
    throw Object.assign(new Error('Email delivery is not configured. Set the SMTP environment variables.'), { status: 503 });
  }
  const transport = nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD },
    tls: { minVersion: 'TLSv1.2' },
  });
  return transport.sendMail({
    from: { name: environment.SMTP_FROM_NAME || 'Tempo', address: environment.SMTP_FROM_EMAIL },
    ...message,
  });
}