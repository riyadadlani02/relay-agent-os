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
test('kernel agents get strict structured output against the schema they send', async () => {
  vi.stubEnv('MODEL_API_KEY', 'fake-test-secret');
  vi.stubEnv('MODEL_BASE_URL', 'https://model.example/v1');
  vi.stubEnv('MODEL_NAME', 'gpt-4.1-mini');
  const bodies: { response_format: unknown; messages: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: '{"note":"x","action":{}}' } }],
        usage: { prompt_tokens: 30, completion_tokens: 5 },
      });
    }),
  );
  const schema = {
    type: 'object',
    properties: { note: { type: 'string' } },
    required: ['note'],
    additionalProperties: false,
  };
  const messages = [{ role: 'user', content: 'Propose the next call.' }];
  const result = await request(app())
    .post('/api/live/generate')
    .send({ messages, schema })
    .expect(200);
  expect(result.body).toMatchObject({ content: '{"note":"x","action":{}}', tokens: 35 });
  expect(bodies[0].messages).toEqual(messages);
  expect(bodies[0].response_format).toEqual({
    type: 'json_schema',
    json_schema: { name: 'relay_action', strict: true, schema },
  });
  // Rejected before any provider call (the full app maps this validation error to HTTP 400).
  const huge = { type: 'object', description: 'x'.repeat(21000) };
  const rejected = await request(app()).post('/api/live/generate').send({ messages, schema: huge });
  expect(rejected.ok).toBe(false);
  expect(bodies).toHaveLength(1);
  vi.stubEnv('MODEL_API_KEY', '');
  await request(app()).post('/api/live/generate').send({ messages, schema }).expect(503);
});
