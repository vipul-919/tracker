import 'dotenv/config';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/work-hours-tracker', { serverSelectionTimeoutMS: 10000 });
  const app = createApp({ secret: process.env.JWT_SECRET, production: process.env.NODE_ENV === 'production' });
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  const server = app.listen(process.env.PORT || 3001, '127.0.0.1', () => console.log(`Tempo API running at http://127.0.0.1:${process.env.PORT || 3001}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await mongoose.disconnect(); process.exit(0); }));
} catch (err) { console.error('Unable to start Tempo:', err.message, '\nCheck your .env file and make sure MongoDB is running.'); process.exit(1); }
