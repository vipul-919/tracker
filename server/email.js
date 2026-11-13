import nodemailer from 'nodemailer';
import { z } from 'zod';

const mailbox = z.string().trim().email().max(254);
const brevoFailure = code => Object.assign(new Error('Brevo email request failed.'), { code });

export async function brevoRequest(path, options = {}, environment = process.env, request = fetch) {
  if (!environment.BREVO_API_KEY?.trim()) throw Object.assign(new Error('Brevo is not configured.'), { status: 503 });
  let response;
  try {
    response = await request(`https://api.brevo.com/v3${path}`, {
      ...options,
      headers: { 'api-key': environment.BREVO_API_KEY, accept: 'application/json', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw brevoFailure('ECONNECTION'); }
  if (!response.ok) throw brevoFailure(response.status === 401 || response.status === 403 ? 'EAUTH' : response.status === 429 ? 'ERATELIMIT' : 'EPROVIDER');
  try { return await response.json(); } catch { throw brevoFailure('EPROVIDER'); }
}

export async function sendBrevoEmail(message, environment = process.env, request = fetch) {
  const sender = mailbox.safeParse(environment.BREVO_FROM_EMAIL);
  if (!sender.success) throw Object.assign(new Error('Brevo sender is not configured.'), { status: 503 });
  const email = mailbox.parse(message.to);
  const subject = z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/).parse(message.subject);
  const textContent = z.string().min(1).max(50000).parse(message.text);
  const htmlContent = message.html === undefined ? undefined : z.string().min(1).max(100000).parse(message.html);
  const result = await brevoRequest('/smtp/email', { method: 'POST', body: JSON.stringify({
    sender: { email: sender.data, name: environment.BREVO_FROM_NAME || 'Tempo' },
    to: [{ email }], subject, textContent, ...(htmlContent ? { htmlContent } : {}),
  }) }, environment, request);
  if (typeof result.messageId !== 'string' || !result.messageId) throw brevoFailure('EPROVIDER');
  return { messageId: result.messageId };
}

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

export function workspaceInvitationEmail({ workspaceName, inviterName, role, url }) {
  const content = template('Workspace invitation', [`${inviterName} invited you to ${workspaceName} as ${role}.`, 'Sign in with this email address, or register your own account, then accept or reject the invitation.', 'The invitation expires in 7 days. Your personal workspace and other roles remain unchanged.']);
  return { subject: `Invitation to ${workspaceName} on Tempo`, text: `${content.text}\n\n${url}`, html: content.html.replace('</main>', `<p><a href="${escapeHtml(url)}">Review workspace invitation</a></p></main>`) };
}

export function passwordChangedEmail({ name }) {
  return { subject: 'Your Tempo password was changed', ...template('Password changed', [`Hello ${name}, your Tempo password has been changed.`, 'All other active sessions have been signed out.'], 'If you did not make this change, contact your application administrator.') };
}

export function deactivationEmail({ name }) {
  return { subject: 'Your Tempo account is inactive', ...template('Account access changed', [`Hello ${name}, your Tempo account has been deactivated.`, 'You will no longer be able to sign in. Contact your application administrator if you believe this is a mistake.']) };
}

export function createEmailTransport(environment = process.env) {
  const port = Number(environment.SMTP_PORT);
  if (!environment.SMTP_HOST || (!Number.isInteger(port) || port < 1 || port > 65535) || !environment.SMTP_USER || !environment.SMTP_PASSWORD || !environment.SMTP_FROM_EMAIL) {
    throw Object.assign(new Error('Email delivery is not configured. Set the SMTP environment variables.'), { status: 503 });
  }
  return nodemailer.createTransport({
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    host: environment.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD },
    tls: { minVersion: 'TLSv1.2' },
  });
}

// Only fixed messages cross the API boundary; SMTP errors can contain credentials or tokens.
export function emailDeliveryError(error) {
  if (error?.status === 503) return 'Email delivery is not configured. Set BREVO_API_KEY and BREVO_FROM_EMAIL for Brevo, or complete the existing SMTP configuration.';
  if (error?.code === 'ERATELIMIT') return 'The email provider rate limit was reached. Please try again later.';
  if (error?.code === 'EPROVIDER') return 'The email provider rejected the request. Check the verified sender, account status and sending quota.';
  if (error?.code === 'EAUTH') return 'The email provider rejected authentication. Check the Brevo API key or configured SMTP credentials and provider access restrictions.';
  if (['ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ESOCKET', 'ECONNREFUSED'].includes(error?.code)) return 'Unable to connect securely to the email provider. Check email provider connectivity and network access.';
  if (error?.code === 'EENVELOPE' || error?.code === 'EMESSAGE') return 'The email provider rejected the sender, recipient or message. Check the authorized sender and provider restrictions.';
  return 'Email delivery failed. Ask the server administrator to verify SMTP configuration and provider restrictions, then resend.';
}

export async function sendConfiguredEmail(message, environment = process.env) {
  if (environment.BREVO_API_KEY?.trim()) return sendBrevoEmail(message, environment);
  const transport = createEmailTransport(environment);
  try {
    return await transport.sendMail({
    from: { name: environment.SMTP_FROM_NAME || 'Tempo', address: environment.SMTP_FROM_EMAIL },
    ...message,
    });
  } finally { transport.close(); }
}
