import express from 'express';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Runtime } from './runtime.js';
import { RuntimeError, inputSchema, policySchema } from './runtime.js';
import { mountLiveModel } from './live.js';

export function createApp(runtime: Runtime) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // A local demo has no cross-origin clients. Prevent a random website from writing to localhost.
    const origin = req.get('origin');
    if (origin) {
      const allowed = new Set([
        `http://${req.get('host')}`,
        `https://${req.get('host')}`,
        'http://127.0.0.1:5173',
        'http://localhost:5173',
      ]);
      if (!allowed.has(origin))
        return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  mountLiveModel(app);
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', mode: 'sandbox', provider: runtime.planner.name }),
  );
  app.get('/api/state', (_req, res) =>
    res.json({
      runs: runtime.store.runs(),
      events: runtime.store.events(),
      policy: runtime.store.policy(),
      effects: runtime.store.effects(),
      knowledge: runtime.store.knowledge(),
      provider: runtime.planner.name,
    }),
  );
  app.get('/api/runs/:id', (req, res) =>
    res.json({ run: runtime.require(req.params.id), events: runtime.store.events(req.params.id) }),
  );
  app.post('/api/runs', (req, res) => {
    if (runtime.store.runs().filter((r) => ['running', 'queued'].includes(r.status)).length >= 50)
      return res.status(429).json({ error: 'Queue is full. Wait for active missions to finish.' });
    res.status(201).json(runtime.create(inputSchema.parse(req.body)));
  });
  app.post('/api/runs/:id/decision', (req, res) => {
    const { decision } = z
      .object({ decision: z.enum(['approved', 'rejected']) })
      .strict()
      .parse(req.body);
    res.json(runtime.decide(req.params.id, decision));
  });
  app.post('/api/runs/:id/cancel', (req, res) => res.json(runtime.cancel(req.params.id)));
  app.put('/api/policy', (req, res) => {
    const policy = policySchema.parse(req.body);
    runtime.store.setPolicy(policy);
    res.json(policy);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: 'Invalid request.', details: error.issues.map((i) => i.message) });
      if (error instanceof RuntimeError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: 'Invalid JSON body.' });
      if (error && typeof error === 'object' && 'status' in error && error.status === 413)
        return res.status(413).json({ error: 'Request body exceeds the 16 KB limit.' });
      res.status(500).json({ error: 'Internal server error.' });
    },
  );
  return app;
}
