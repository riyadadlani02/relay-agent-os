import { schemaForTools, type Action, type ChatMessage, type Model } from './domain';
import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';

export const browserModelId = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export class BrowserModel implements Model {
  name = 'Qwen 2.5 · 1.5B · WebGPU';
  private engine?: WebWorkerMLCEngine;
  private worker?: Worker;
  async load(progress: (fraction: number, text: string) => void) {
    if (!('gpu' in navigator))
      throw new Error(
        'WebGPU is unavailable. Open this page in a current Chrome or Edge desktop browser with hardware acceleration enabled.',
      );
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
    this.worker = new Worker(new URL('./model-worker.ts', import.meta.url), { type: 'module' });
    try {
      this.engine = await CreateWebWorkerMLCEngine(
        this.worker,
        browserModelId,
        {
          initProgressCallback: (report) => progress(report.progress, report.text),
        },
        { context_window_size: 4096 },
      );
    } catch (error) {
      this.dispose();
      throw new Error(
        `Could not load the model. Check your connection and WebGPU support, then retry. ${error instanceof Error ? error.message.slice(0, 180) : ''}`,
      );
    }
  }
  complete(
    messages: ChatMessage[],
    signal: AbortSignal,
    allowedTools: Action['tool'][],
    orderIds: string[],
  ) {
    return this.generate(messages, schemaForTools(allowedTools, orderIds), signal);
  }
  /** Structured generation against any JSON schema; used by kernel agents. */
  async generate(messages: ChatMessage[], schema: object, signal: AbortSignal) {
    if (!this.engine) throw new Error('Load the model before sending a message.');
    const started = performance.now();
    const interrupt = () => this.interrupt();
    signal.addEventListener('abort', interrupt, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      interrupt();
    }, 90000);
    try {
      signal.throwIfAborted();
      const response = await this.engine.chat.completions.create({
        messages,
        temperature: 0,
        max_tokens: 380,
        response_format: {
          type: 'json_object',
          schema: JSON.stringify(schema),
        },
      });
      signal.throwIfAborted();
      if (timedOut) throw new Error('Model generation timed out. No partial action was executed.');
      if (response.choices[0]?.finish_reason !== 'stop')
        throw new Error(
          'Generation did not finish within its limit. No partial action was executed.',
        );
      return {
        content: response.choices[0]?.message.content ?? '',
        tokens: response.usage?.total_tokens ?? 0,
        milliseconds: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', interrupt);
    }
  }
  interrupt() {
    this.engine?.interruptGenerate();
  }
  dispose() {
    this.worker?.terminate();
    this.worker = undefined;
    this.engine = undefined;
  }
}

export class ServerModel implements Model {
  constructor(public name: string) {}
  interrupt() {
    /* fetch is cancelled by the caller's AbortSignal */
  }
  complete(
    messages: ChatMessage[],
    signal: AbortSignal,
    allowedTools: Action['tool'][],
    orderIds: string[],
  ) {
    return this.post('/api/live/complete', { messages, allowedTools, orderIds }, signal);
  }
  generate(messages: ChatMessage[], schema: object, signal: AbortSignal) {
    return this.post('/api/live/generate', { messages, schema }, signal);
  }
  private async post(path: string, body: unknown, signal: AbortSignal) {
    const started = performance.now();
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Model request failed.');
    return {
      content: String(data.content),
      tokens: Number(data.tokens) || 0,
      milliseconds: Math.round(performance.now() - started),
    };
  }
}
