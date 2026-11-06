import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo, handler, unconfiguredHandler;
const app = express();
before(async () => {
  mongo = await MongoMemoryServer.create({ binary: { downloadDir: '.data/mongodb-binaries' } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.JWT_SECRET = 'vercel-adapter-test-secret-with-at-least-32-characters';
  process.env.ADMIN_BOOTSTRAP_TOKEN = 'vercel-adapter-owner-bootstrap-token';
  const secret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  unconfiguredHandler = (await import('../api/index.js?missing-secret')).default;
  process.env.JWT_SECRET = secret;
  handler = (await import('../api/index.js')).default;
  app.use(handler);
}, { timeout: 240000 });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('Vercel entry point serves original API paths, secure login, and warm requests', async () => {
  const uri = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  await request(app).get('/api/auth/setup-status').expect(503).expect(({ body }) => assert.equal(body.error, 'Service unavailable. Please try again shortly.'));
  process.env.MONGODB_URI = uri;
  const unconfigured = express();
  unconfigured.use(unconfiguredHandler);
  await request(unconfigured).get('/api/auth/setup-status').expect(503);
  await request(app).get('/api/data').expect(401);
  const registered = await request(app).post('/api/auth/register')
    .set('X-Requested-With', 'Tempo')
    .send({ name: 'Hosted user', email: 'hosted@example.com', password: 'strong-hosting-password' })
    .expect(200);
  const cookie = registered.headers['set-cookie'][0];
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  const session = cookie.split(';')[0];
  assert.equal(registered.body.role, 'owner');
  const initialConnection = mongoose.connection;
  for (let i = 0; i < 3; i++) {
    const result = await request(app).get('/api/auth/me').set('Cookie', session).expect(200);
    assert.equal(result.body.email, 'hosted@example.com');
    assert.equal(mongoose.connection, initialConnection);
    assert.equal(mongoose.connection.readyState, 1);
  }
  await request(app).get('/api/unknown').set('Cookie', session).expect(404);
});
