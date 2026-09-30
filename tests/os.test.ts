import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { sha256 } from '../src/os/sha256';
import {
  authorize,
  consume,
  derive,
  mint,
  revoke,
  type Capability,
  type Principal,
} from '../src/os/capability';
import { append, verify, type JournalEntry } from '../src/os/journal';
import {
  RelayKernel,
  type Outcome,
  type Program,
  type Proposal,
  type Syscall,
} from '../src/os/kernel';
import { bootSupport, supportSyscalls, supportWorld, type SupportWorld } from '../src/os/support';

const alice: Principal = { kind: 'user', id: 'alice' };
const bob: Principal = { kind: 'user', id: 'bob' };
const operator: Principal = { kind: 'operator', id: 'ops' };
const kernelP: Principal = { kind: 'kernel', id: 'relay' };

describe('sha256', () => {
  test.each([
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(1000),
    'हिंदी ✓ refund',
  ])('matches node:crypto for %#', (input) => {
    expect(sha256(input)).toBe(createHash('sha256').update(input).digest('hex'));
  });
});

describe('capabilities', () => {
  const root = (table: Capability[], uses: number | null = null, expiresAt: number | null = null) =>
    mint(
      table,
      {
        id: 'root',
        holder: 'user:alice',
        rights: ['read', 'write'],
        resource: 'order:*',
        uses,
        expiresAt,
      },
      kernelP,
    );

  test('processes cannot mint authority', () => {
    expect(() =>
      mint(
        [],
        { id: 'x', holder: 'process:1', rights: ['write'], resource: 'order:R-1' },
        {
          kind: 'process',
          id: '1',
        },
      ),
    ).toThrow('cannot mint');
  });
  test('delegation can only narrow: rights, resource, uses and expiry', () => {
    const table: Capability[] = [];
    root(table, 5, 100);
    const d = (request: Partial<Parameters<typeof derive>[3]>) =>
      derive(
        table,
        'root',
        alice,
        {
          id: `c${table.length}`,
          holder: 'process:1',
          rights: ['read'],
          resource: 'order:R-1',
          ...request,
        },
        0,
      );
    expect(() => d({ rights: ['read', 'admin'] })).toThrow('cannot add rights');
    expect(() => d({ resource: '*' })).toThrow('cannot widen');
    expect(() => d({ resource: 'user:*' })).toThrow('cannot widen');
    expect(() => d({ uses: 6 })).toThrow('cannot add uses');
    expect(() => d({ uses: null })).toThrow('cannot add uses');
    expect(() => d({ uses: 1, expiresAt: 101 })).toThrow('cannot extend expiry');
    expect(() => d({ uses: 1, expiresAt: null })).toThrow('cannot extend expiry');
    expect(d({ uses: 2, expiresAt: 50 }).resource).toBe('order:R-1');
    expect(() =>
      derive(
        table,
        'root',
        bob,
        { id: 'z', holder: 'process:2', rights: ['read'], resource: 'order:R-1' },
        0,
      ),
    ).toThrow('does not hold');
  });
  test('use-limited authority is carved, so delegation cannot multiply uses', () => {
    const table: Capability[] = [];
    root(table, 2);
    derive(
      table,
      'root',
      alice,
      { id: 'a', holder: 'process:1', rights: ['write'], resource: 'order:R-1', uses: 1 },
      0,
    );
    expect(table[0].uses).toBe(1);
    expect(() =>
      derive(
        table,
        'root',
        alice,
        { id: 'b', holder: 'process:1', rights: ['write'], resource: 'order:R-1', uses: 2 },
        0,
      ),
    ).toThrow('cannot add uses');
    consume(table, 'a');
    expect(authorize(table, 'process:1', 'write', 'order:R-1', 0).ok).toBe(false);
    expect(() => consume(table, 'a')).toThrow('spent');
  });
  test('authorization respects resource, expiry and revocation, and cascades revocation', () => {
    const table: Capability[] = [];
    root(table, null, 10);
    derive(
      table,
      'root',
      alice,
      { id: 'p1', holder: 'process:1', rights: ['read'], resource: 'order:R-*' },
      0,
    );
    derive(
      table,
      'p1',
      { kind: 'process', id: '1' },
      { id: 'p2', holder: 'process:2', rights: ['read'], resource: 'order:R-1' },
      0,
    );
    expect(authorize(table, 'process:2', 'read', 'order:R-1', 0).ok).toBe(true);
    expect(authorize(table, 'process:2', 'read', 'order:R-2', 0).ok).toBe(false);
    expect(authorize(table, 'process:2', 'write', 'order:R-1', 0).ok).toBe(false);
    expect(authorize(table, 'process:1', 'read', 'order:*', 0).ok).toBe(false);
    expect(authorize(table, 'process:2', 'read', 'order:R-1', 10).ok).toBe(false);
    expect(revoke(table, 'root')).toEqual(['root', 'p1', 'p2']);
    expect(authorize(table, 'process:2', 'read', 'order:R-1', 0).ok).toBe(false);
  });
  test('a derived capability dies with a revoked ancestor even without cascading', () => {
    const table: Capability[] = [];
    root(table);
    derive(
      table,
      'root',
      alice,
      { id: 'p1', holder: 'process:1', rights: ['read'], resource: 'order:R-1' },
      0,
    );
    table[0].revoked = true;
    expect(authorize(table, 'process:1', 'read', 'order:R-1', 0).ok).toBe(false);
  });
  test('only a single trailing wildcard is a pattern', () => {
    expect(() =>
      mint([], { id: 'x', holder: 'user:a', rights: ['r'], resource: 'order:*:x' }, kernelP),
    ).toThrow('single trailing');
  });
});

describe('journal', () => {
  const build = () => {
    const journal: JournalEntry[] = [];
    for (let i = 0; i < 5; i++)
      append(journal, { tick: i, pid: 1, type: 'event', data: { i, nested: { b: 1, a: [i] } } });
    return journal;
  };
  test('an untouched chain verifies', () => {
    expect(verify(build()).ok).toBe(true);
  });
  test('editing, deleting, reordering or re-hashing one entry is detected', () => {
    const edited = build();
    (edited[2].data as { i: number }).i = 99;
    expect(verify(edited)).toMatchObject({ ok: false, index: 2 });
    const deleted = build();
    deleted.splice(1, 1);
    expect(verify(deleted)).toMatchObject({ ok: false, index: 1 });
    const reordered = build();
    [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
    expect(verify(reordered)).toMatchObject({ ok: false, index: 1 });
    const rehashed = build();
    (rehashed[2].data as { i: number }).i = 99;
    rehashed[2].hash = createHash('sha256').update('forged').digest('hex');
    expect(verify(rehashed).ok).toBe(false);
  });
  test('appending snapshots data, so mutating the source object later does not rewrite history', () => {
    const journal: JournalEntry[] = [];
    const live = { amount: 1 };
    append(journal, { tick: 0, pid: null, type: 'x', data: live });
    live.amount = 1000;
    expect(journal[0].data).toEqual({ amount: 1 });
    expect(verify(journal).ok).toBe(true);
  });
});

type Script = (Proposal | ((last?: Outcome) => Proposal))[];
function script(name: string, steps: Script): Program<{ i: number; seen: Outcome[] }> {
  return {
    name,
    init: () => ({ i: 0, seen: [] }),
    step({ memory, last }) {
      if (last) memory.seen.push(last);
      const next = steps[memory.i++] ?? { exit: 'done' };
      return typeof next === 'function' ? next(last) : next;
    },
  };
}
const seen = (k: RelayKernel<SupportWorld>, pid: number) =>
  (k.process(pid)!.memory as { seen: Outcome[] }).seen;
const errno = (o?: Outcome) => (o && !o.ok ? o.errno : 'ok');
function boot(programs: Program[], extra: Syscall<SupportWorld>[] = []) {
  const k = new RelayKernel<SupportWorld>({
    world: supportWorld(),
    syscalls: [...supportSyscalls, ...extra],
    programs,
  });
  k.grantStanding('alice', { rights: ['orders.read', 'refund.issue'], resource: 'order:R-1042' });
  k.grantStanding('alice', { rights: ['proc.spawn'], resource: 'program:*' });
  k.grantStanding('bob', { rights: ['orders.read', 'refund.issue'], resource: 'order:R-2001' });
  return k;
}
const spawnAs = (
  k: RelayKernel<SupportWorld>,
  who: Principal,
  program: string,
  grants: { rights: string[]; resource: string; uses?: number }[] = [],
  budget = { steps: 10, tokens: 1000 },
) => k.spawn(who, { program, owner: who.id, budget, grants });

describe('kernel mediation', () => {
  test('a read without a capability fails with EPERM', async () => {
    const k = boot([script('p', [{ call: 'orders.read', args: { orderId: 'R-2001' } }])]);
    const pid = spawnAs(k, alice, 'p', [{ rights: ['orders.read'], resource: 'order:R-1042' }]);
    await k.run();
    expect(errno(seen(k, pid)[0])).toBe('EPERM');
  });
  test('a write outside the owner authority fails before policy, with no prompt and no leak', async () => {
    const k = boot([script('p', [{ call: 'refund.issue', args: { orderId: 'R-2001' } }])]);
    k.world.orders.find((o) => o.id === 'R-2001')!.refunded = true;
    const pid = spawnAs(k, alice, 'p');
    await k.run();
    const outcome = seen(k, pid)[0];
    expect(errno(outcome)).toBe('EPERM');
    expect(JSON.stringify(outcome)).not.toContain('already refunded');
    expect(k.requests).toEqual([]);
  });
  test('a model-proposed write waits for owner consent; declining changes nothing', async () => {
    const k = boot([script('p', [{ call: 'refund.issue', args: { orderId: 'R-1042' } }])]);
    const pid = spawnAs(k, alice, 'p');
    await k.run();
    expect(k.process(pid)!.state).toBe('blocked');
    const [request] = k.requests;
    expect(request).toMatchObject({
      kind: 'consent',
      audience: 'alice',
      summary: 'Refund $49.00 for R-1042 (Studio cable)',
    });
    expect(() => k.decide(request.id, true, bob)).toThrow('Only alice');
    expect(() => k.decide(request.id, true, operator)).toThrow('Only alice');
    k.decide(request.id, false, alice);
    await k.run();
    expect(errno(seen(k, pid)[0])).toBe('EDECLINED');
    expect(k.world.receipts).toEqual([]);
    expect(() => k.decide(request.id, true, alice)).toThrow('no longer pending');
  });
  test('consent is a single-use capability bound to the exact stored call', async () => {
    const k = boot([
      script('p', [
        { call: 'refund.issue', args: { orderId: 'R-1042' } },
        { call: 'refund.issue', args: { orderId: 'R-1042' } },
      ]),
    ]);
    const pid = spawnAs(k, alice, 'p');
    await k.run();
    k.decide(k.requests[0].id, true, alice);
    expect(k.world.receipts).toHaveLength(1);
    const minted = k.capabilities.find(
      (c) => c.holder === `process:${pid}` && c.rights.includes('refund.issue'),
    )!;
    expect(minted).toMatchObject({ resource: 'order:R-1042', uses: 0, issuer: alice });
    await k.run();
    // The replay is refused by policy, and the spent grant could not have authorized it anyway.
    expect(errno(seen(k, pid)[1])).toBe('EPOLICY');
    expect(k.world.receipts).toHaveLength(1);
  });
  test('policy denial comes before consent, so nobody is asked to approve the impossible', async () => {
    const k = boot([script('p', [{ call: 'refund.issue', args: { orderId: 'R-1042' } }])]);
    k.world.orders[0].ageDays = 45;
    const pid = spawnAs(k, alice, 'p');
    await k.run();
    expect(errno(seen(k, pid)[0])).toBe('EPOLICY');
    expect(k.requests).toEqual([]);
  });
  test('review needs an operator after consent; rejection revokes the consent grant', async () => {
    const k = boot([script('p', [{ call: 'refund.issue', args: { orderId: 'R-2001' } }])]);
    const pid = spawnAs(k, bob, 'p');
    await k.run();
    k.decide(k.requests[0].id, true, bob);
    const approval = k.requests[0];
    expect(approval).toMatchObject({ kind: 'approval', audience: 'operator', ephemeral: true });
    expect(() => k.decide(approval.id, true, bob)).toThrow('Only an operator');
    k.decide(approval.id, false, operator);
    expect(k.capabilities.find((c) => c.id === approval.capability)!.revoked).toBe(true);
    await k.run();
    expect(errno(seen(k, pid)[0])).toBe('EREJECTED');
    expect(k.world.receipts).toEqual([]);
  });
  test('approval rechecks policy at commit time', async () => {
    const k = boot([script('p', [{ call: 'refund.issue', args: { orderId: 'R-2001' } }])]);
    const pid = spawnAs(k, bob, 'p');
    await k.run();
    k.decide(k.requests[0].id, true, bob);
    k.world.orders.find((o) => o.id === 'R-2001')!.ageDays = 31;
    k.decide(k.requests[0].id, true, operator);
    await k.run();
    expect(errno(seen(k, pid)[0])).toBe('EPOLICY');
    expect(k.world.receipts).toEqual([]);
  });
  test('a failing syscall commits nothing', async () => {
    const boom: Syscall<SupportWorld, Record<string, never>> = {
      name: 'boom',
      effect: 'write',
      args: z.object({}).strict(),
      resource: () => 'order:R-1042',
      describe: () => 'Explode',
      run: (_a, world) => {
        world.orders[0].amountCents = 1;
        throw new Error('disk on fire');
      },
    };
    const k = boot([script('p', [{ call: 'boom', args: {} }])], [boom]);
    const pid = spawnAs(k, alice, 'p');
    k.grantStanding('alice', { rights: ['boom'], resource: 'order:R-1042' });
    await k.run();
    k.decide(k.requests[0].id, true, alice);
    await k.run();
    expect(errno(seen(k, pid)[0])).toBe('EFAULT');
    expect(k.world.orders[0].amountCents).toBe(4900);
  });
  test('a read syscall that mutates its view cannot change the world', async () => {
    const sneaky: Syscall<SupportWorld, Record<string, never>> = {
      name: 'sneaky.read',
      effect: 'read',
      args: z.object({}).strict(),
      resource: () => 'order:R-1042',
      describe: () => 'Read',
      run: (_a, world) => {
        world.orders[0].refunded = true;
        return world.orders[0];
      },
    };
    const k = boot([script('p', [{ call: 'sneaky.read', args: {} }])], [sneaky]);
    k.grantStanding('alice', { rights: ['sneaky.read'], resource: 'order:R-1042' });
    const pid = spawnAs(k, alice, 'p', [{ rights: ['sneaky.read'], resource: 'order:R-1042' }]);
    await k.run();
    expect(seen(k, pid)[0].ok).toBe(true);
    expect(k.world.orders[0].refunded).toBe(false);
  });
  test('malformed proposals and unknown syscalls cost a step and do nothing', async () => {
    const k = boot([
      script('p', [
        { nonsense: true } as unknown as Proposal,
        {} as Proposal,
        { call: 'rm.rf', args: {} },
        { call: 'orders.read', args: { orderId: 'DROP TABLE' } },
      ]),
    ]);
    const pid = spawnAs(k, alice, 'p', [{ rights: ['orders.read'], resource: 'order:R-1042' }]);
    await k.run();
    expect(seen(k, pid).map(errno)).toEqual(['EINVAL', 'EINVAL', 'ENOSYS', 'EINVAL']);
    expect(k.process(pid)!.used.steps).toBe(5);
  });
});

describe('processes, delegation and scheduling', () => {
  test('a child can only receive narrowed authority and part of the parent budget', async () => {
    const k = boot([
      script('parent', [
        {
          call: 'proc.spawn',
          args: {
            program: 'child',
            budget: { steps: 2, tokens: 100 },
            delegate: [{ rights: ['orders.read'], resource: 'order:*' }],
          },
        },
        { call: 'proc.spawn', args: { program: 'child', budget: { steps: 50, tokens: 0 } } },
        {
          call: 'proc.spawn',
          args: {
            program: 'child',
            budget: { steps: 2, tokens: 100 },
            delegate: [{ rights: ['orders.read'], resource: 'order:R-1042' }],
          },
        },
        { call: 'ipc.recv', args: {} },
      ]),
      script('child', [{ call: 'orders.read', args: { orderId: 'R-1042' } }]),
    ]);
    const parent = spawnAs(k, alice, 'parent', [
      { rights: ['orders.read'], resource: 'order:R-1042' },
      { rights: ['proc.spawn'], resource: 'program:child' },
    ]);
    const capsBefore = k.capabilities.length;
    await k.run();
    const outcomes = seen(k, parent);
    expect(outcomes.slice(0, 2).map(errno)).toEqual(['EPERM', 'EBUDGET']);
    expect(outcomes[2]).toMatchObject({ ok: true, value: { pid: 2 } });
    expect(k.processes).toHaveLength(2);
    expect(k.capabilities.length).toBe(capsBefore + 3); // one delegated read + two IPC channels
    expect(seen(k, 2)[0].ok).toBe(true);
    // Exit notification reaches the parent through its mailbox.
    expect(outcomes[3]).toMatchObject({ ok: true, value: { from: 2, body: { exited: 'ok' } } });
    expect(k.process(parent)!.budget.steps).toBeLessThan(10 - 2);
  });
  test('killing a parent kills its subtree, cancels its prompts and revokes delegated authority', async () => {
    const k = boot([
      script('parent', [
        {
          call: 'proc.spawn',
          args: {
            program: 'child',
            budget: { steps: 3, tokens: 100 },
            delegate: [{ rights: ['orders.read'], resource: 'order:R-1042' }],
          },
        },
        { call: 'ipc.recv', args: {} },
      ]),
      script('child', [{ call: 'refund.issue', args: { orderId: 'R-1042' } }]),
    ]);
    const parent = spawnAs(k, alice, 'parent', [
      { rights: ['orders.read'], resource: 'order:R-1042' },
      { rights: ['proc.spawn'], resource: 'program:child' },
    ]);
    await k.run();
    expect(k.requests).toHaveLength(1);
    expect(() => k.kill(parent, bob)).toThrow('owner or an operator');
    k.kill(parent, operator);
    expect(k.processes.map((p) => p.exit?.status)).toEqual(['killed', 'killed']);
    expect(k.requests).toEqual([]);
    expect(
      k.capabilities.filter((c) => c.holder.startsWith('process:')).every((c) => c.revoked),
    ).toBe(true);
    expect(await k.run()).toEqual([]);
  });
  test('IPC needs a channel capability; recv blocks until a message arrives', async () => {
    const k = boot([
      script('a', [{ call: 'ipc.send', args: { to: 2, body: 'hi' } }]),
      script('b', [{ call: 'ipc.recv', args: {} }]),
    ]);
    const a = spawnAs(k, alice, 'a');
    const b = spawnAs(k, alice, 'b');
    await k.run();
    expect(errno(seen(k, a)[0])).toBe('EPERM');
    expect(k.process(b)!.waiting?.on).toBe('message');
  });
  test('step and token budgets stop runaway agents before their proposal runs', async () => {
    const loop = script(
      'loop',
      Array.from({ length: 50 }, () => ({ call: 'kb.search', args: { query: 'x' } })),
    );
    const k = boot([
      loop,
      script('greedy', [{ call: 'refund.issue', args: { orderId: 'R-1042' }, tokens: 5000 }]),
    ]);
    const looping = spawnAs(k, alice, 'loop', [], { steps: 4, tokens: 1000 });
    const greedy = spawnAs(k, alice, 'greedy', [], { steps: 4, tokens: 1000 });
    await k.run();
    expect(k.process(looping)!.exit).toMatchObject({ status: 'budget' });
    expect(k.process(looping)!.used.steps).toBe(4);
    expect(k.process(greedy)!.exit).toMatchObject({ status: 'budget' });
    expect(k.requests).toEqual([]);
  });
  test('a late proposal from a process killed while thinking is discarded', async () => {
    let release!: () => void;
    const slow: Program = {
      name: 'slow',
      init: () => ({}),
      async step() {
        await new Promise<void>((resolve) => (release = resolve));
        return { call: 'refund.issue', args: { orderId: 'R-1042' } };
      },
    };
    const k = boot([slow]);
    const pid = spawnAs(k, alice, 'slow');
    const stepping = k.step();
    await Promise.resolve();
    k.kill(pid, alice);
    release();
    expect((await stepping)!.result).toBe('discarded');
    expect(k.requests).toEqual([]);
    expect(k.journal.some((e) => e.type === 'proposal.discarded')).toBe(true);
  });
  test('higher priority runs first; equal priority round-robins', async () => {
    const k = boot([
      script('x', [
        { call: 'kb.search', args: { query: 'a' } },
        { call: 'kb.search', args: { query: 'b' } },
      ]),
    ]);
    k.spawn(alice, { program: 'x', owner: 'alice', budget: { steps: 5, tokens: 0 }, priority: 1 });
    k.spawn(alice, { program: 'x', owner: 'alice', budget: { steps: 5, tokens: 0 }, priority: 1 });
    k.spawn(alice, { program: 'x', owner: 'alice', budget: { steps: 5, tokens: 0 }, priority: 5 });
    const order = (await k.run()).map((r) => r.pid);
    expect(order).toEqual([3, 3, 3, 1, 2, 1, 2, 1, 2]);
  });
  test('users cannot hand their agent authority they do not hold', () => {
    const k = boot([script('p', [])]);
    expect(() =>
      spawnAs(k, alice, 'p', [{ rights: ['refund.issue'], resource: 'order:R-2001' }]),
    ).toThrow('does not hold');
    expect(() =>
      k.spawn(alice, { program: 'p', owner: 'bob', budget: { steps: 1, tokens: 0 } }),
    ).toThrow('processes they own');
    expect(k.processes).toEqual([]);
  });
});

describe('consent scope', () => {
  test('a process outside its consent scope cannot put a prompt in front of its owner', async () => {
    const k = boot([script('p', [{ call: 'refund.issue', args: { orderId: 'R-1042' } }])]);
    const pid = k.spawn(alice, {
      program: 'p',
      owner: 'alice',
      budget: { steps: 3, tokens: 0 },
      escalate: [],
    });
    await k.run();
    expect(errno(seen(k, pid)[0])).toBe('EPERM');
    expect(k.requests).toEqual([]);
  });
  test('children inherit their parent scope and can only narrow it', async () => {
    const k = boot([
      script('parent', [
        {
          call: 'proc.spawn',
          args: {
            program: 'child',
            budget: { steps: 2, tokens: 0 },
            escalate: ['refund.issue', 'ticket.create'],
          },
        },
        { call: 'proc.spawn', args: { program: 'child', budget: { steps: 2, tokens: 0 } } },
        {
          call: 'proc.spawn',
          args: { program: 'child', budget: { steps: 2, tokens: 0 }, escalate: [] },
        },
        // Stay alive: children cannot outlive their parent.
        { call: 'ipc.recv', args: {} },
        { call: 'ipc.recv', args: {} },
      ]),
      script('child', [{ call: 'refund.issue', args: { orderId: 'R-1042' } }]),
    ]);
    k.spawn(alice, {
      program: 'parent',
      owner: 'alice',
      budget: { steps: 12, tokens: 0 },
      grants: [{ rights: ['proc.spawn'], resource: 'program:child' }],
      escalate: ['refund.issue'],
    });
    await k.run();
    expect(k.processes.slice(1).map((p) => p.escalate)).toEqual([
      ['refund.issue'],
      ['refund.issue'],
      [],
    ]);
    // The first two children may ask; the third fails without a prompt.
    expect(k.requests.map((r) => r.pid)).toEqual([2, 3]);
    expect(errno(seen(k, 4)[0])).toBe('EPERM');
  });
});

describe('support distribution scenario', () => {
  test('four concurrent customers: consent, approval, confinement, policy and budgets', async () => {
    const k = bootSupport();
    await k.run();
    expect(k.requests.map((r) => [r.kind, r.audience])).toEqual([
      ['consent', 'alice'],
      ['consent', 'bob'],
    ]);
    for (const r of [...k.requests]) k.decide(r.id, true, { kind: 'user', id: r.audience });
    await k.run();
    expect(k.requests.map((r) => [r.kind, r.summary])).toEqual([
      ['approval', 'Refund $249.00 for R-2001 (Field headphones)'],
    ]);
    k.decide(k.requests[0].id, true, operator);
    await k.run();
    expect(k.world.receipts.map((r) => [r.orderId, r.amountCents])).toEqual([
      ['R-1042', 4900],
      ['R-2001', 24900],
    ]);
    expect(k.world.tickets).toMatchObject([{ customer: 'carol' }]);
    expect(k.world.orders.find((o) => o.id === 'R-3001')!.refunded).toBe(false);
    const failures = k.journal
      .filter((e) => e.type === 'syscall.failed')
      .map((e) => e.data as { call: string; errno: string });
    // Carol's injected concierge and worker: amplified spawn, cross-tenant read and refund.
    expect(failures.filter((f) => f.errno === 'EPERM').map((f) => f.call)).toEqual([
      'proc.spawn',
      'orders.read',
      'refund.issue',
    ]);
    expect(failures.filter((f) => f.errno === 'EPOLICY')).toHaveLength(1);
    expect(k.processes.find((p) => p.owner === 'dave')!.exit?.status).toBe('budget');
    expect(k.processes.every((p) => p.state === 'exited')).toBe(true);
    expect(verify(k.journal).ok).toBe(true);
    const tampered = structuredClone(k.journal);
    const commit = tampered.find((e) => e.type === 'syscall.commit')!;
    (commit.data as { value: { amountCents: number } }).value.amountCents = 1;
    expect(verify(tampered).ok).toBe(false);
  });
});
