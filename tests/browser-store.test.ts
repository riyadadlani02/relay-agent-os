import { describe, expect, it } from 'vitest';
import { BrowserStore } from '../src/site/browser-store';
import { Runtime } from '../server/runtime';
const input = {
  customer: 'Browser Customer',
  issue: 'Please refund the duplicate subscription charge.',
  scenario: 'refund' as const,
  amountCents: 24900,
  faultOnce: false,
};
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe('browser persistence adapter', () => {
  it('recovers an approval checkpoint after reconstructing the store', async () => {
    const storage = memory();
    const first = new Runtime(new BrowserStore(storage));
    const run = first.create(input);
    for (let i = 0; i < 6; i++) await first.step(run.id);
    const second = new Runtime(new BrowserStore(storage));
    expect(second.require(run.id).status).toBe('awaiting_approval');
    second.decide(run.id, 'approved');
    for (let i = 0; i < 6; i++) await second.step(run.id);
    expect(second.require(run.id).status).toBe('completed');
    expect(second.store.effects()).toHaveLength(1);
  });
  it('rolls back a partial transaction without persisting it', () => {
    const storage = memory();
    const store = new BrowserStore(storage);
    const rt = new Runtime(store);
    const run = rt.create(input);
    expect(() =>
      store.transaction(() => {
        store.save({ ...run, status: 'cancelled' });
        throw new Error('rollback');
      }),
    ).toThrow();
    expect(new BrowserStore(storage).get(run.id)?.status).toBe('queued');
  });
  it('keeps functioning with blocked persistence and reports its status', async () => {
    const store = new BrowserStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage blocked');
      },
    });
    const rt = new Runtime(store);
    const run = rt.create({ ...input, amountCents: 4900 });
    for (let i = 0; i < 6; i++) await rt.step(run.id);
    expect(rt.require(run.id).status).toBe('completed');
    expect(store.persistenceAvailable).toBe(false);
  });
  it('recovers from malformed local session data', () => {
    const store = new BrowserStore({
      getItem: () => '{"version":1,"runs":[null]}',
      setItem: () => {},
    });
    expect(store.runs()).toEqual([]);
    expect(store.policy().autoRefundLimitCents).toBe(10000);
  });
});
