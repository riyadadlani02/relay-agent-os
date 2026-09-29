import { afterEach, expect, test, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mountLiveModel } from '../server/live';

function app() {
  const server = express();
  server.use(express.json());
  mountLiveModel(server);
  return server;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test('unconfigured model returns an explicit error instead of a scripted fallback', async () => {
  vi.stubEnv('MODEL_API_KEY', '');
  const server = app();
  expect((await request(server).get('/api/live/config')).body).toEqual({
    enabled: false,
    model: null,
  });
  await request(server)
    .post('/api/live/complete')
    .send({ messages: [], allowedTools: [] })
    .expect(503);
});
test('provider errors never expose credentials or upstream response bodies', async () => {
  vi.stubEnv('MODEL_API_KEY', 'fake-test-secret');
  vi.stubEnv('MODEL_BASE_URL', 'https://model.example/v1');
  vi.stubEnv('MODEL_NAME', 'test-model');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('internal sensitive upstream body', { status: 401 })),
  );
  const server = app();
  const config = await request(server).get('/api/live/config');
  expect(config.body).toEqual({ enabled: true, model: 'test-model' });
  const result = await request(server)
    .post('/api/live/complete')
    .send({ messages: [{ role: 'user', content: 'Hello' }], allowedTools: ['respond'] })
    .expect(502);
  expect(result.body).toEqual({ error: 'Model provider returned HTTP 401.' });
});
