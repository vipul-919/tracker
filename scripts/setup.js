import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
  writeFileSync('.env', `PORT=3001\nMONGODB_URI=mongodb://127.0.0.1:27017/work-hours-tracker\nJWT_SECRET=${randomBytes(48).toString('hex')}\nNODE_ENV=development\n`, { mode: 0o600 });
  console.log('Created .env with a unique session secret. Start MongoDB, then run npm run dev.');
} else console.log('.env already exists; preserved your configuration.');
