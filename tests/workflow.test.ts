import { describe, expect, test } from 'vitest';
import type { AgentModel } from '../src/os/agent';
import { verify } from '../src/os/journal';
import type { RelayKernel } from '../src/os/kernel';
import { bootLive, runWorkflow, supportWorkflows, type SupportWorld } from '../src/os/support';
import {
  render,
  startWorkflow,
  validateWorkflow,
  type RunnerMemory,
  type Workflow,
} from '../src/os/workflow';

// Scripted fixture keyed by PID: not a model. The kernel's scheduling is deterministic, so a
// workflow's steps always receive the same PIDs.
function fixture(script: Record<number, (string | object)[]>) {
  const prompts: Record<number, string[]> = {};
  const model: AgentModel = {
    name: 'Scripted fixture (not AI)',
    async generate(messages) {
      const pid = Number(/You run as process (\d+)/.exec(messages[0].content)?.[1]);
      (prompts[pid] ??= []).push(messages[1].content);
      const next = script[pid]?.shift() ?? act('exit', { result: 'done' });
      return {
        content: typeof next === 'string' ? next : JSON.stringify(next),
        tokens: 500,
        milliseconds: 1,
      };
    },
  };
  return { model, prompts };
}
const act = (call: string, args: object = {}) => ({ note: '', action: { call, args } });
const exit = (result: string) => act('exit', { result });
const held = (k: RelayKernel<SupportWorld>, pid: number) =>
  k.capabilities
    .filter((c) => c.holder === `process:${pid}` && !c.resource.startsWith('proc:'))
    .map((c) => `${c.rights.join('+')} ${c.resource}`);
const index = (k: RelayKernel<SupportWorld>, type: string, pid: number) =>
  k.journal.findIndex((e) => e.type === type && e.pid === pid);
const states = (k: RelayKernel<SupportWorld>, pid: number) =>
  (k.process(pid)!.memory as RunnerMemory).states.map((s) => `${s.id}:${s.status}`);

describe('workflow definitions', () => {
  const base: Workflow = {
    id: 'w',
    title: 'W',
    summary: '',
    answer: 'b',
    steps: [
      {
        id: 'a',
        title: 'A',
        program: 'writer',
        task: 't',
        grants: [],
        budget: { steps: 1, tokens: 0 },
      },
      {
        id: 'b',
        title: 'B',
        program: 'writer',
        task: 't',
        grants: [],
        after: ['a'],
        budget: { steps: 1, tokens: 0 },
      },
    ],
  };
  test('valid graphs are ordered by dependency; broken ones are rejected', () => {
    expect(validateWorkflow(base)).toEqual(['a', 'b']);
    const edit = (change: (w: Workflow) => void) => {
      const w = structuredClone(base);
      change(w);
      return () => validateWorkflow(w);
    };
    expect(edit((w) => (w.steps[1].id = 'a'))).toThrow('unique');
    expect(edit((w) => (w.steps[1].after = ['missing']))).toThrow('unknown');
    expect(edit((w) => (w.steps[0].after = ['b']))).toThrow('cycle');
    expect(edit((w) => (w.answer = 'c'))).toThrow('answer');
    expect(() => render('{orderId}', {})).toThrow('Missing workflow input');
    for (const w of supportWorkflows) expect(() => validateWorkflow(w)).not.toThrow();
  });
});

describe('multi-agent workflows on the kernel', () => {
  test('parallel checks, a consented refund, an audit and a reply, each with only its own grants', async () => {
    const { model, prompts } = fixture({
      2: [
        act('kb.search', { query: 'refund' }), // outside this step's grants
        act('orders.read', { orderId: 'R-1042' }),
        exit('R-1042 Studio cable, $49.00, 4 days old, not refunded.'),
      ],
      3: [
        act('kb.search', { query: 'refund policy' }),
        exit('Up to $100 is automatic within 30 days.'),
      ],
      4: [
        act('orders.read', { orderId: 'R-1042' }),
        act('refund.issue', { orderId: 'R-1042' }),
        exit('Refund committed.'),
      ],
      5: [act('orders.read', { orderId: 'R-1042' }), exit('The record shows R-1042 refunded.')],
      6: [exit('Hi alice, your $49.00 refund for the studio cable is done.')],
    });
    const k = bootLive({ model: () => model, constrain: () => false });
    const runner = runWorkflow(k, 'refund-verified', 'alice', 'Please refund my cable.');
    // The runner holds the union of step grants plus the right to start each role, nothing more.
    expect(held(k, runner).sort()).toEqual(
      [
        'orders.read order:R-1042',
        'kb.search kb:policies',
        'proc.spawn program:investigator',
        'proc.spawn program:refund-agent',
        'proc.spawn program:writer',
      ].sort(),
    );
    await k.run();
    // The two checks ran concurrently: the policy check started before the order check ended.
    expect(index(k, 'process.spawned', 3)).toBeLessThan(index(k, 'process.exited', 2));
    expect(held(k, 2)).toEqual(['orders.read order:R-1042']);
    expect(held(k, 3)).toEqual(['kb.search kb:policies']);
    expect(k.journal.find((e) => e.type === 'syscall.failed' && e.pid === 2)?.data).toMatchObject({
      call: 'kb.search',
      errno: 'EPERM',
    });
    // Only the refund step may ask, and the customer is asked exactly once.
    expect(k.requests.map((r) => [r.kind, r.pid, r.summary])).toEqual([
      ['consent', 4, 'Refund $49.00 for R-1042 (Studio cable)'],
    ]);
    expect(states(k, runner)).toEqual([
      'order:done',
      'policy:done',
      'refund:running',
      'audit:pending',
      'reply:pending',
    ]);
    expect(prompts[4][0]).toContain('Results from earlier steps:');
    expect(prompts[4][0]).toContain('Order check: R-1042 Studio cable');
    k.decide(k.requests[0].id, true, { kind: 'user', id: 'alice' });
    await k.run();
    expect(k.world.receipts).toMatchObject([{ orderId: 'R-1042', amountCents: 4900, pid: 4 }]);
    expect(held(k, 6)).toEqual([]); // the writer never held anything but its parent channel
    expect(k.process(runner)!.exit).toMatchObject({
      status: 'ok',
      value: { result: 'Hi alice, your $49.00 refund for the studio cable is done.' },
    });
    expect(states(k, runner).every((s) => s.endsWith(':done'))).toBe(true);
    expect(verify(k.journal).ok).toBe(true);
  });

  test('a failed step skips everything that depends on it and nothing changes', async () => {
    const { model } = fixture({
      2: [exit('R-1042 not refunded.')],
      3: [exit('Up to $100 automatic.')],
      4: Array.from({ length: 10 }, () => 'not json'),
    });
    const k = bootLive({ model: () => model });
    const runner = runWorkflow(k, 'refund-verified', 'alice', 'Refund please.');
    await k.run();
    expect(states(k, runner)).toEqual([
      'order:done',
      'policy:done',
      'refund:failed',
      'audit:skipped',
      'reply:skipped',
    ]);
    expect(k.process(runner)!.exit?.value).toMatchObject({
      result: 'The workflow could not finish: Customer reply skipped.',
    });
    expect(k.world.receipts).toEqual([]);
    expect(k.requests).toEqual([]);
  });

  test('a handoff uses its single pre-authorized ticket without asking anyone', async () => {
    const { model } = fixture({
      2: [
        act('orders.read', { orderId: 'R-3001' }),
        act('kb.search', { query: 'refund limit' }),
        exit('R-3001 is $750, above the $500 hard limit.'),
      ],
      3: [
        act('ticket.create', { summary: 'R-3001 refund above the hard limit; needs a person.' }),
        act('ticket.create', { summary: 'A second ticket.' }),
        exit('Opened T-1.'),
      ],
      4: [exit('Hi carol, a colleague will review your amplifier refund.')],
    });
    const k = bootLive({ model: () => model, constrain: () => false });
    const runner = runWorkflow(k, 'handoff', 'carol', 'Refund my $750 amplifier.');
    await k.run();
    expect(k.world.tickets).toMatchObject([{ id: 'T-1', customer: 'carol' }]);
    // The single use was spent; the second ticket is refused and nobody is prompted.
    expect(
      k.journal
        .filter((e) => e.type === 'syscall.failed' && e.pid === 3)
        .map((e) => (e.data as { errno: string }).errno),
    ).toEqual(['EPERM']);
    expect(k.journal.some((e) => e.type === 'consent.requested')).toBe(false);
    expect(k.process(runner)!.exit).toMatchObject({
      status: 'ok',
      value: { result: 'Hi carol, a colleague will review your amplifier refund.' },
    });
  });

  test('in a read-only workflow no step can put a change in front of the customer', async () => {
    const { model } = fixture({
      2: [act('refund.issue', { orderId: 'R-1042' }), exit('Delivered 4 days ago.')],
      3: [act('refund.issue', { orderId: 'R-1042' }), exit('It was delivered 4 days ago.')],
    });
    const k = bootLive({ model: () => model, constrain: () => false });
    runWorkflow(k, 'status', 'alice', 'Where is my cable?');
    await k.run();
    const refusals = k.journal
      .filter((e) => e.type === 'syscall.failed')
      .map((e) => [e.pid, (e.data as { errno: string }).errno]);
    expect(refusals).toEqual([
      [2, 'EPERM'],
      [3, 'EPERM'],
    ]);
    expect(k.journal.some((e) => e.type === 'consent.requested')).toBe(false);
    expect(k.world.receipts).toEqual([]);
  });

  test('a workflow can never exceed the authority of the person who starts it', () => {
    const k = bootLive({ model: () => undefined });
    const intrusive: Workflow = {
      ...supportWorkflows[2],
      id: 'intrusive',
      steps: [
        {
          ...supportWorkflows[2].steps[0],
          grants: [{ rights: ['orders.read'], resource: 'order:R-2001' }],
        },
        supportWorkflows[2].steps[1],
      ],
    };
    // alice does not own R-2001, so no runner can be granted access to it on her behalf.
    expect(() =>
      startWorkflow(k, intrusive, 'alice', { customer: 'alice', orderId: 'R-1042', message: 'x' }),
    ).toThrow('does not hold');
    expect(k.processes).toEqual([]);
  });
});
