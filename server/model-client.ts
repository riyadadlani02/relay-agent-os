import {
  schemaForTools,
  type Action,
  type ChatMessage,
  type Model,
} from '../src/playground/domain.js';

export class ProviderHTTPError extends Error {
  constructor(status: number) {
    super(`Model provider returned HTTP ${status}.`);
  }
}
export interface ModelConfig {
  base: string;
  key: string;
  name: string;
}
export function modelConfig(): ModelConfig {
  const { MODEL_API_KEY: key, MODEL_BASE_URL: base, MODEL_NAME: name } = process.env;
  if (!key || !base || !name)
    throw new Error('Configure MODEL_API_KEY, MODEL_BASE_URL and MODEL_NAME.');
  return { key, base, name };
}
export class HostedModel implements Model {
  name: string;
  usage = { input: 0, output: 0, calls: 0 };
  constructor(
    private config: ModelConfig,
    private beforeCall?: (maxCost: number) => void,
    private afterCall?: (actualCost: number) => void,
  ) {
    this.name = config.name;
  }
  interrupt() {}
  complete(
    messages: ChatMessage[],
    signal: AbortSignal,
    allowedTools: Action['tool'][],
    orderIds: string[],
  ) {
    return this.generate(messages, schemaForTools(allowedTools, orderIds), signal);
  }
  /** Strict structured output against any JSON schema; used by kernel agents. */
  async generate(messages: ChatMessage[], schema: object, signal: AbortSignal) {
    const url = new URL(`${this.config.base.replace(/\/$/, '')}/chat/completions`);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Model endpoint must use HTTPS.');
    // Conservative uncached pricing, dollars per million tokens. Used only by the opt-in eval budget.
    const rate = this.name === 'gpt-4.1-mini' ? [0.4, 1.6] : [2.5, 15];
    const maxOutput = 700;
    const bound =
      ((Buffer.byteLength(JSON.stringify({ messages, schema })) + 1024) * rate[0] +
        maxOutput * rate[1]) /
      1e6;
    this.beforeCall?.(bound);
    const started = performance.now();
    let cost = bound;
    try {
      const reasoningModel = /^gpt-[56]/.test(this.name);
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        headers: { Authorization: `Bearer ${this.config.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.name,
          messages,
          ...(reasoningModel
            ? { max_completion_tokens: maxOutput, reasoning_effort: 'none' }
            : { max_tokens: maxOutput, temperature: 0 }),
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'relay_action', strict: true, schema },
          },
        }),
      });
      if (!response.ok) throw new ProviderHTTPError(response.status);
      const data = (await response.json()) as {
        model?: string;
        choices?: { finish_reason: string; message: { content: string } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const input = data.usage?.prompt_tokens ?? 0,
        output = data.usage?.completion_tokens ?? 0;
      this.usage.input += input;
      this.usage.output += output;
      this.usage.calls++;
      if (data.usage) cost = (input * rate[0] + output * rate[1]) / 1e6;
      if (data.choices?.[0]?.finish_reason !== 'stop')
        throw new Error('Model generation did not complete. No partial action was executed.');
      return {
        content: data.choices[0].message.content,
        tokens: input + output,
        milliseconds: Math.round(performance.now() - started),
      };
    } finally {
      this.afterCall?.(cost);
    }
  }
}
