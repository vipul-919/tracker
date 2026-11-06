import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const dbPath = path.resolve('.data/mongodb');
mkdirSync(dbPath, { recursive: true });
try {
  const mongo = await MongoMemoryServer.create({ instance: { port: 27017, dbPath, storageEngine: 'wiredTiger', dbName: 'work-hours-tracker' }, binary: { downloadDir: path.resolve('.data/mongodb-binaries') } });
  console.log('Local MongoDB is ready at mongodb://127.0.0.1:27017/work-hours-tracker');
  console.log(`Records persist in ${dbPath}. Keep this terminal open. Ctrl+C to stop.`);
  const stop = async () => { await mongo.stop({ doCleanup: false }); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (e) { console.error('Could not start local MongoDB:', e.message, '\nUse an installed MongoDB service or an Atlas connection in .env instead.'); process.exit(1); }
