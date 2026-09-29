import type { Express } from 'express';
import { z } from 'zod';
import { actionSchema, schemaForTools } from '../src/playground/domain.js';

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
    const url = new URL(`${process.env.MODEL_BASE_URL!.replace(/\/$/, '')}/chat/completions`);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
      return res.status(503).json({ error: 'Model endpoint must use HTTPS.' });
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]),
        headers: {
          Authorization: `Bearer ${process.env.MODEL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.MODEL_NAME,
          messages: input.messages,
          temperature: 0,
          max_tokens: 380,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'relay_action',
              strict: true,
              schema: schemaForTools(input.allowedTools, input.orderIds),
            },
          },
        }),
      });
      if (!response.ok)
        return res.status(502).json({ error: `Model provider returned HTTP ${response.status}.` });
      const data = (await response.json()) as {
        choices?: { finish_reason: string; message: { content: string } }[];
        usage?: { total_tokens: number };
      };
      if (data.choices?.[0]?.finish_reason !== 'stop')
        return res
          .status(502)
          .json({ error: 'Model generation did not complete. No partial action was executed.' });
      return res.json({
        content: data.choices[0].message.content,
        tokens: data.usage?.total_tokens ?? 0,
      });
    } catch {
      if (!res.destroyed)
        return res
          .status(502)
          .json({ error: 'Model request failed or timed out. Check server model configuration.' });
    }
  });
}
