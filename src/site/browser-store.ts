import { z } from 'zod';
import { articles, defaultPolicy } from '../../server/catalog';
import { inputSchema, policySchema, Runtime, type RuntimeStore } from '../../server/runtime';
import type { Effect, Policy, Run, RunEvent } from '../shared';

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface LocalState {
  version: 1;
  runs: Run[];
  events: RunEvent[];
  effects: Effect[];
  policy: Policy;
}
const storageKey = 'relay-os:public-demo:v1';
const savedRun = inputSchema.extend({
  id: z.string(),
  status: z.enum(['queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled']),
  step: z.number().int().min(0).max(6),
  actions: z.number().int().min(0),
  attempts: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.enum(['sample', 'user']),
  model: z.string(),
  plan: z
    .object({
      action: z.enum(['refund', 'replace', 'escalate']),
      reason: z.string(),
      reply: z.string(),
    })
    .optional(),
  outcome: z.string().optional(),
  approval: z.enum(['approved', 'rejected']).optional(),
});
const savedState = z.object({
  version: z.literal(1),
  runs: z.array(savedRun),
  policy: policySchema,
  events: z.array(
    z.object({
      id: z.number(),
      runId: z.string(),
      at: z.string(),
      type: z.string(),
      agent: z.string(),
      message: z.string(),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
  effects: z.array(
    z.object({
      id: z.string(),
      runId: z.string(),
      kind: z.string(),
      amountCents: z.number(),
      at: z.string(),
    }),
  ),
});

/** Browser-only sandbox adapter. Uses the same state machine as the SQLite server. */
export class BrowserStore implements RuntimeStore {
  private state: LocalState = {
    version: 1,
    runs: [],
    events: [],
    effects: [],
    policy: { ...defaultPolicy },
  };
  private inTransaction = false;
  private listeners = new Set<() => void>();
  persistenceAvailable = true;
  constructor(private storage?: StoragePort) {
    if (!storage) {
      this.persistenceAvailable = false;
      return;
    }
    try {
      const raw = storage.getItem(storageKey);
      if (raw) this.state = savedState.parse(JSON.parse(raw));
    } catch {
      this.state = { version: 1, runs: [], events: [], effects: [], policy: { ...defaultPolicy } };
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private commit() {
    if (this.inTransaction) return;
    try {
      this.storage?.setItem(storageKey, JSON.stringify(this.state));
    } catch {
      this.persistenceAvailable = false;
    }
    this.listeners.forEach((listener) => listener());
  }
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) throw new Error('Nested transactions are not supported.');
    const before = structuredClone(this.state);
    this.inTransaction = true;
    try {
      const result = fn();
      this.inTransaction = false;
      this.commit();
      return result;
    } catch (error) {
      this.state = before;
      this.inTransaction = false;
      throw error;
    }
  }
  save(run: Run) {
    const index = this.state.runs.findIndex((r) => r.id === run.id);
    if (index < 0) this.state.runs.push(structuredClone(run));
    else this.state.runs[index] = structuredClone(run);
    this.commit();
  }
  get(id: string) {
    const run = this.state.runs.find((r) => r.id === id);
    return run ? structuredClone(run) : undefined;
  }
  runs() {
    return structuredClone(this.state.runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  event(
    run: Run,
    type: string,
    agent: string,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    this.state.events.push({
      id: (this.state.events.at(-1)?.id ?? 0) + 1,
      runId: run.id,
      at: run.updatedAt,
      type,
      agent,
      message,
      data: structuredClone(data),
    });
    this.commit();
  }
  events(id?: string) {
    return structuredClone(this.state.events.filter((e) => !id || e.runId === id));
  }
  policy() {
    return { ...this.state.policy };
  }
  setPolicy(policy: Policy) {
    this.state.policy = policySchema.parse(policy);
    this.commit();
  }
  effects() {
    return structuredClone(this.state.effects);
  }
  commitEffect(run: Run) {
    if (!this.state.effects.some((e) => e.runId === run.id))
      this.state.effects.push({
        id: `${run.id}:${run.plan!.action}`,
        runId: run.id,
        kind: run.plan!.action,
        amountCents: run.plan!.action === 'refund' ? run.amountCents : 0,
        at: run.updatedAt,
      });
    this.commit();
  }
  knowledge() {
    return structuredClone(articles);
  }
}
export function createBrowserRuntime() {
  let storage: StoragePort | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* The demo remains usable if storage is blocked. */
  }
  const store = new BrowserStore(storage);
  return { runtime: new Runtime(store), store };
}
