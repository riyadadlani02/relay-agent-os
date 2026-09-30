import { expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gauntlet } from '../src/gauntlet/corpus';
import { fixture, memoryStore, runCase, scoreTurn, summarize } from '../src/gauntlet/evaluate';
import { releaseGate } from '../src/gauntlet/gate';
import { BudgetLedger } from '../server/gauntlet/budget';
import type { Action, Model } from '../src/playground/domain';
const find = (family: string) => gauntlet.find((c) => c.family === family)!;
function model(readOnly = false): Model {
  return {
    name: 'Deterministic contract fixture — not model evidence',
    interrupt() {},
    async complete(_messages, _signal, tools, ids) {
      const tool: Action['tool'] = tools.includes('orders.lookup')
        ? 'orders.lookup'
        : tools.includes('knowledge.search')
          ? 'knowledge.search'
          : readOnly
            ? 'respond'
            : 'refunds.request';
      return {
        content: JSON.stringify({
          tool,
          orderId: ids[0],
          query: tool === 'knowledge.search' ? 'refund policy' : '',
          reply: tool === 'respond' ? 'Your delivery status is available in the order record.' : '',
        }),
        tokens: 0,
        milliseconds: 0,
      };
    },
  };
}
test('corpus contains 500 unique cases, 100 controls, all three languages and stateful attacks', () => {
  expect(gauntlet).toHaveLength(500);
  expect(new Set(gauntlet.map((c) => c.id)).size).toBe(500);
  expect(new Set(gauntlet.map((c) => JSON.stringify(c.turns))).size).toBe(500);
  expect(gauntlet.filter((c) => c.legitimate)).toHaveLength(100);
  expect(new Set(gauntlet.map((c) => c.language))).toEqual(new Set(['en', 'hi', 'hinglish']));
  expect(gauntlet.filter((c) => c.turns.some((t) => t.restartBefore))).toHaveLength(50);
  expect(gauntlet.every((c) => c.turns.every((t) => t.request.length <= 1500))).toBe(true);
});
test('independent scorer detects duplicate, wrong amount, over-limit, read-only, and unreceipted mutations', () => {
  for (const family of ['injection', 'currency_units', 'duplicate', 'information_only']) {
    const c = find(family),
      before = fixture(c),
      after = structuredClone(before);
    after.receipts.push({
      id: 'bad',
      orderId: c.target,
      kind: 'refund',
      amountCents: 49,
      at: 'now',
    });
    after.orders.find((o) => o.id === c.target)!.refunded = true;
    expect(scoreTurn(c, 0, before, after).violations.length).toBeGreaterThan(0);
  }
  const c = find('eligible'),
    before = fixture(c),
    after = structuredClone(before);
  after.orders[0].refunded = true;
  expect(scoreTurn(c, 0, before, after).violations).toContain('write-without-receipt:R-1042');
});
test('refusing every request cannot pass the controls, required approval is not a false block', async () => {
  const refused = await runCase(find('eligible'), model(true));
  expect(refused.policyViolation).toBe(false);
  expect(refused.falseBlock).toBe(true);
  const reviewed = await runCase(find('approval'), model());
  expect(reviewed.outcomeCorrect).toBe(true);
  expect(reviewed.requiredApproval).toBe(true);
  expect(reviewed.falseBlock).toBe(false);
  expect(reviewed.unnecessaryEscalation).toBe(false);
});
test('replay reconstructs store and kernel, retains one receipt across two turns', async () => {
  let opens = 0;
  const result = await runCase(find('restart_replay'), model(), async (state) => {
    opens++;
    return memoryStore(JSON.parse(JSON.stringify(state)));
  });
  expect(opens).toBe(2);
  expect(result.outcomeCorrect).toBe(true);
  expect(result.turns[1].session.receipts).toHaveLength(1);
  expect(result.turns[1].restarted).toBe(true);
});
test('all 500 deterministic contract probes exercise the actual kernel; never label this as inference', async () => {
  const results = [];
  for (const c of gauntlet) results.push(await runCase(c, model(c.family === 'information_only')));
  expect(summarize(results)).toMatchObject({
    planned: 500,
    attempted: 500,
    complete: true,
    policyViolations: 0,
    outcomesCorrect: 500,
    legitimateRequestsFailed: 0,
    requiredApprovals: 100,
  });
});
test('release gate rejects missing coverage, mismatched corpus, errors and regressions', async () => {
  const pass = await runCase(find('eligible'), model());
  const fail = await runCase(find('eligible'), model(true));
  const report = {
    corpusHash: 'same',
    results: [pass],
    summary: { complete: true, planned: 1, attempted: 1 },
  };
  expect(releaseGate(report, report).passed).toBe(true);
  expect(releaseGate(report, { ...report, results: [fail] }).failures).toContain(
    `Outcome regression: ${pass.id}`,
  );
  expect(releaseGate(report, { ...report, corpusHash: 'different' }).passed).toBe(false);
  expect(releaseGate(report, { ...report, results: [] }).passed).toBe(false);
  expect(
    releaseGate(report, { ...report, summary: { ...report.summary, complete: false } }).passed,
  ).toBe(false);
  expect(
    releaseGate(report, { ...report, results: [{ ...pass, policyViolation: true }] }).passed,
  ).toBe(false);
});
test('budget persists across reopen, reserves pending calls and refuses reset/overspend', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-budget-')),
    path = join(dir, 'budget.db');
  try {
    const a = new BudgetLedger(path, 3, 1);
    const id = a.reserve(1.5, 'test');
    expect(() => a.reserve(0.6, 'test')).toThrow('budget');
    a.settle(id, 0.25);
    a.reserve(0.75, 'test'); // Lost response is charged at the bound, even on reopen.
    a.close();
    const b = new BudgetLedger(path, 3, 1);
    expect(b.snapshot().remainingUsd).toBe(1);
    expect(() => b.reserve(1.01, 'test')).toThrow('budget');
    expect(() => b.reserve(NaN, 'test')).toThrow('Invalid');
    expect(() => new BudgetLedger(path, 4, 0)).toThrow('refusing to reset');
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first refund after a failed replay setup is a missed outcome, not an unauthorized duplicate', () => {
  const c = find('restart_replay'),
    before = fixture(c),
    after = structuredClone(before);
  after.orders[0].refunded = true;
  after.receipts.push({
    id: 'first',
    orderId: c.target,
    kind: 'refund',
    amountCents: 4900,
    at: 'now',
  });
  const scored = scoreTurn(c, 1, before, after);
  expect(scored.violations).toEqual([]);
  expect(scored.outcomeCorrect).toBe(false);
  const duplicate = structuredClone(after);
  duplicate.receipts.push({ ...after.receipts[0], id: 'second' });
  expect(scoreTurn(c, 1, after, duplicate).violations).toContain('duplicate-write:second');
});

test('oracle detects semantic intent violations even when the model chooses a schema-valid tool', async () => {
  const result = await runCase(find('information_only'), model());
  expect(result.policyViolation).toBe(true);
  expect(result.outcomeCorrect).toBe(false);
});
