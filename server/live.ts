import type { Express } from 'express';
import { z } from 'zod';
import { actionSchema } from '../src/playground/domain.js';
import { HostedModel, modelConfig, ProviderHTTPError } from './model-client.js';

const messagesSchema = z
  .array(
    z
      .object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(10000),
      })
      .strict(),
  )
  .min(1)
  .max(25);

export function mountLiveModel(app: Express) {
  const configured = () =>
    !!(process.env.MODEL_API_KEY && process.env.MODEL_BASE_URL && process.env.MODEL_NAME);
  app.get('/api/live/config', (_req, res) =>
    res.json({ enabled: configured(), model: configured() ? process.env.MODEL_NAME : null }),
  );
  app.post('/api/live/complete', async (req, res) => {
    if (!configured())
      return res
        .status(503)
        .json({ error: 'A server model is not configured. Use the browser model.' });
    const input = z
      .object({
        allowedTools: z.array(actionSchema.shape.tool).min(1).max(6),
        orderIds: z
          .array(z.string().regex(/^R-\d{4}$/))
          .max(20)
          .default([]),
        messages: messagesSchema,
      })
      .strict()
      .parse(req.body);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const model = new HostedModel(modelConfig());
      return res.json(
        await model.complete(input.messages, abort.signal, input.allowedTools, input.orderIds),
      );
    } catch (error) {
      if (!res.destroyed)
        return res.status(502).json({
          error:
            error instanceof ProviderHTTPError
              ? error.message
              : 'Model request failed or timed out. Check server model configuration.',
        });
    }
  });
  // Structured output for kernel agents. The schema only shapes the reply; every proposal is
  // still validated and authorized by the kernel in the browser.
  app.post('/api/live/generate', async (req, res) => {
    if (!configured())
      return res
        .status(503)
        .json({ error: 'A server model is not configured. Use the browser model.' });
    const input = z
      .object({
        messages: messagesSchema,
        schema: z
          .record(z.string(), z.unknown())
          .refine((schema) => JSON.stringify(schema).length <= 20000, 'Schema is too large.'),
      })
      .strict()
      .parse(req.body);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const model = new HostedModel(modelConfig());
      return res.json(await model.generate(input.messages, input.schema, abort.signal));
    } catch (error) {
      if (!res.destroyed)
        return res.status(502).json({
          error:
            error instanceof ProviderHTTPError
              ? error.message
              : 'Model request failed or timed out. Check server model configuration.',
        });
    }
  });
}
