import { afterEach, expect, test, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mountVoice } from '../server/voice';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function app() {
  const a = express();
  mountVoice(a);
  return a;
}
test('audio is forwarded to the fixed speech provider and raw transcript is preserved', async () => {
  vi.stubEnv('DEEPGRAM_API_KEY', 'test-secret');
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          metadata: { request_id: 'fixture', duration: 2 },
          results: {
            channels: [
              { alternatives: [{ transcript: 'मेरा order R1042', confidence: 0.9, words: [] }] },
            ],
          },
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const r = await request(app())
    .post('/api/voice/transcribe')
    .set('Content-Type', 'audio/mpeg')
    .send(Buffer.from('test audio'))
    .expect(200);
  expect(r.body.transcript).toBe('मेरा order R1042');
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(JSON.stringify(r.body)).not.toContain('test-secret');
});
test('empty and unsupported bodies cannot call the speech provider', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await request(app())
    .post('/api/voice/transcribe')
    .set('Content-Type', 'text/plain')
    .send('not audio')
    .expect(400);
  expect(fetcher).not.toHaveBeenCalled();
});
test('provider error bodies and credentials do not reach the client', async () => {
  vi.stubEnv('DEEPGRAM_API_KEY', 'test-secret');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('private upstream error', { status: 401 })),
  );
  const r = await request(app())
    .post('/api/voice/transcribe')
    .set('Content-Type', 'audio/mpeg')
    .send(Buffer.from('test audio'))
    .expect(502);
  expect(r.body).toEqual({ error: 'Speech provider returned HTTP 401.' });
});
