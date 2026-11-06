import mongoose from 'mongoose';
import { createApp } from '../server/app.js';

// Reuse the application and connection pool across warm function invocations.
let app;
try {
  app = createApp({ secret: process.env.JWT_SECRET, production: true });
  app.set('trust proxy', 1);
} catch {
  // Keep the function loadable so configuration failures return JSON, not HTML.
}
let connection;
export default async function handler(req, res) {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    if (!app) throw new Error('API configuration is invalid');
    if (!connection) {
      connection = mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
      }).catch(error => { connection = undefined; throw error; });
    }
    await connection;
    return app(req, res);
  } catch {
    console.error('API initialization failed:', !process.env.MONGODB_URI ? 'MONGODB_URI is missing.' : !app ? 'JWT_SECRET is missing or invalid.' : 'Database connection failed. Check credentials and network access.');
    return res.status(503).json({ error: 'Service unavailable. Please try again shortly.' });
  }
}
