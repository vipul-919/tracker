import mongoose from 'mongoose';
import { createApp } from '../server/app.js';

// Reuse the application and connection pool across warm function invocations.
const app = createApp({ secret: process.env.JWT_SECRET, production: true });
app.set('trust proxy', 1);
let connection;
export default async function handler(req, res) {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    if (!connection) {
      connection = mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
      }).catch(error => { connection = undefined; throw error; });
    }
    await connection;
    return app(req, res);
  } catch (error) {
    console.error('API initialization failed:', error.message);
    return res.status(503).json({ error: 'Service unavailable. Please try again shortly.' });
  }
}
