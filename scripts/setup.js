import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const defaults = {
  PORT: '3001',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/work-hours-tracker',
  JWT_SECRET: randomBytes(48).toString('hex'),
  ADMIN_BOOTSTRAP_TOKEN: randomBytes(48).toString('hex'),
  APP_URL: 'http://127.0.0.1:5173',
  NODE_ENV: 'development',
  SMTP_HOST: '',
  SMTP_PORT: '587',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM_EMAIL: '',
  SMTP_FROM_NAME: 'Tempo',
};
if (!existsSync('.env')) {
  writeFileSync('.env', `${Object.entries(defaults).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
  console.log('Created .env with unique session and owner-bootstrap secrets. Configure SMTP for invitations and recovery email.');
} else {
  const existing = readFileSync('.env', 'utf8');
  const present = new Set([...existing.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(match => match[1]));
  const additions = Object.entries(defaults).filter(([key]) => !present.has(key)).map(([key, value]) => `${key}=${value}`);
  if (additions.length) writeFileSync('.env', `${existing}${existing.endsWith('\n') ? '' : '\n'}${additions.join('\n')}\n`, { mode: 0o600 });
  console.log(additions.length ? 'Added missing setup keys and preserved existing .env values.' : '.env already has the required keys; preserved your configuration.');
}
