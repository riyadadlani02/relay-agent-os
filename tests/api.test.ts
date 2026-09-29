import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Store } from '../server/store.js';
import { Runtime } from '../server/runtime.js';
import { createApp } from '../server/app.js';
let store: Store;
let runtime: Runtime;
let app: ReturnType<typeof createApp>;
const input = {
  customer: 'Test Customer',
  issue: 'Please refund my duplicate charge.',
  scenario: 'refund',
  amountCents: 24900,
  faultOnce: false,
};
beforeEach(() => {
  store = new Store();
  runtime = new Runtime(store);
  app = createApp(runtime);
});
afterEach(() => store.close());
describe('HTTP boundary', () => {
  it('returns 413 for oversized JSON bodies', async () => {
    await request(app)
      .post('/api/runs')
      .send({ ...input, issue: 'x'.repeat(17000) })
      .expect(413);
  });
  it('validates mission input and rejects additional privileged fields', async () => {
    await request(app)
      .post('/api/runs')
      .send({ ...input, status: 'completed' })
      .expect(400);
    await request(app)
      .post('/api/runs')
      .send({ ...input, amountCents: -1 })
      .expect(400);
    await request(app)
      .post('/api/runs')
      .send({ ...input, amountCents: 1.5 })
      .expect(400);
    expect(store.runs()).toHaveLength(0);
  });
  it('creates a mission and exposes its trace', async () => {
    const response = await request(app).post('/api/runs').send(input).expect(201);
    const trace = await request(app).get(`/api/runs/${response.body.id}`).expect(200);
    expect(trace.body.events[0].type).toBe('run.created');
  });
  it('returns 404 for unknown runs and routes', async () => {
    await request(app).get('/api/runs/missing').expect(404);
    await request(app).get('/api/missing').expect(404);
  });
  it('rejects an approval before the run reaches the approval gate', async () => {
    const { body } = await request(app).post('/api/runs').send(input);
    await request(app)
      .post(`/api/runs/${body.id}/decision`)
      .send({ decision: 'approved' })
      .expect(409);
  });
  it('validates policy relationships and upper ceilings', async () => {
    await request(app)
      .put('/api/policy')
      .send({ ...store.policy(), autoRefundLimitCents: 20000, hardRefundLimitCents: 10000 })
      .expect(400);
    await request(app)
      .put('/api/policy')
      .send({ ...store.policy(), hardRefundLimitCents: 90000 })
      .expect(400);
  });
  it('blocks cross-origin requests to the local control plane', async () => {
    await request(app)
      .post('/api/runs')
      .set('Origin', 'https://untrusted.example')
      .send(input)
      .expect(403);
    await request(app)
      .post('/api/runs')
      .set('Origin', 'http://localhost:5173')
      .send(input)
      .expect(201);
  });
  it('stores policy changes and returns a consistent snapshot', async () => {
    await request(app)
      .put('/api/policy')
      .send({ ...store.policy(), paused: true })
      .expect(200);
    const { body } = await request(app).get('/api/state').expect(200);
    expect(body.policy.paused).toBe(true);
    expect(body.provider).toBe('Deterministic sandbox');
  });
});
