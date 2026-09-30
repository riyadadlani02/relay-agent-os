import type { Express } from 'express';
import { z } from 'zod';
import { actionSchema } from '../src/playground/domain.js';
import { HostedModel, modelConfig, ProviderHTTPError } from './model-client.js';

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
        messages: z
          .array(
            z
              .object({
                role: z.enum(['system', 'user', 'assistant']),
                content: z.string().max(10000),
              })
              .strict(),
          )
          .min(1)
          .max(25),
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
}
