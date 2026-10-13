import { describe, expect, test } from 'vitest';
import { verify } from '../src/os/journal';
import { RelayKernel, type Syscall } from '../src/os/kernel';
import { planner, rupees } from '../src/os/distribution';
import { bootTelecom, telecomSyscalls, telecomWorld, type TelecomWorld } from '../src/os/telecom';
import {
  bootDelivery,
  deliverySyscalls,
  deliveryWorld,
  type DeliveryWorld,
} from '../src/os/delivery';

// The same kernel, unchanged, running two more industries. Only the world, syscalls and policies
// differ from the retail distribution in support.ts.

const operator = { kind: 'operator' as const, id: 'ops' };
type AnyKernel = RelayKernel<TelecomWorld> | RelayKernel<DeliveryWorld>;
const failures = (k: AnyKernel, pid: number) =>
  k.journal
    .filter((e) => e.pid === pid && e.type === 'syscall.failed')
    .map((e) => e.data as { call: string; errno: string; message: string });
const commits = (k: AnyKernel, call: string) =>
  k.journal
    .filter((e) => e.type === 'syscall.commit' && (e.data as { call: string }).call === call)
    .map((e) => (e.data as { value: unknown }).value);
const pidOf = (k: AnyKernel, owner: string) => k.processes.find((p) => p.owner === owner)!.pid;
/** Everyone asked says yes: customers confirm, the operator approves. */
async function approveAll(k: AnyKernel) {
  while (k.requests.length) {
    for (const r of [...k.requests])
      k.decide(r.id, true, r.kind === 'consent' ? { kind: 'user', id: r.audience } : operator);
    await k.run();
  }
}
const policyOf = <W>(syscalls: Syscall<W>[], name: string) =>
  syscalls.find((s) => s.name === name)!.policy!;

describe('telecom distribution', () => {
  test('four customers: logged credit, fraud-desk swap, impersonation and no ID check', async () => {
    const k = bootTelecom();
    await k.run();
    expect(k.requests.map((r) => [r.kind, r.audience, r.summary])).toEqual([
      ['consent', 'asha', 'Credit ₹60 to +91 90000 07001 for 6 logged outage hours'],
      ['consent', 'ravi', 'Move +91 90000 07002 to the SIM issued in store'],
    ]);
    // Mallory's agent was told she is Asha. It cannot read Asha's line or move her number, and
    // Asha is never asked: nobody consents on someone else's behalf.
    expect(failures(k, pidOf(k, 'mallory')).map((f) => [f.call, f.errno])).toEqual([
      ['line.read', 'EPERM'],
      ['sim.swap', 'EPERM'],
    ]);
    expect(k.requests.some((r) => r.call === 'sim.swap' && r.resource === 'line:L-7001')).toBe(
      false,
    );
    // Dev has no in-store ID check, so the swap is refused before anyone could approve it.
    expect(failures(k, pidOf(k, 'dev'))).toMatchObject([
      { call: 'sim.swap', errno: 'EPOLICY', message: expect.stringContaining('in-store ID') },
    ]);

    await approveAll(k);
    // Asha asked for ₹2,000; the network log supports ₹60.
    expect(commits(k, 'credit.issue')).toMatchObject([{ lineId: 'L-7001', amountPaise: 6000 }]);
    const ravi = pidOf(k, 'ravi');
    expect(k.journal.some((e) => e.type === 'approval.requested' && e.pid === ravi)).toBe(true);
    expect(commits(k, 'sim.swap')).toMatchObject([
      { lineId: 'L-7002', from: '8991-0000-0002', to: '8991-0000-0102' },
    ]);
    expect(k.world.lines.find((l) => l.id === 'L-7001')!.sim).toBe('8991-0000-0001');
    expect(k.world.tickets.map((t) => t.customer)).toEqual(['mallory', 'dev']);
    expect(k.processes.every((p) => p.exit?.status === 'ok')).toBe(true);
    expect(verify(k.journal).ok).toBe(true);
  });
  test('a SIM serial typed into the conversation cannot reach the swap', async () => {
    const k = new RelayKernel<TelecomWorld>({
      world: telecomWorld(),
      syscalls: telecomSyscalls,
      programs: [planner],
    });
    k.grantStanding('ravi', { rights: ['line.read', 'sim.swap'], resource: 'line:L-7002' });
    const pid = k.spawn(
      { kind: 'user', id: 'ravi' },
      {
        program: 'planner',
        owner: 'ravi',
        budget: { steps: 4, tokens: 1000 },
        arg: { steps: [{ call: 'sim.swap', args: { lineId: 'L-7002', sim: '8991-6666-0001' } }] },
      },
    );
    await k.run();
    expect(failures(k, pid).map((f) => f.errno)).toEqual(['EINVAL']);
    expect(k.requests).toEqual([]);
  });
  test('credit tiers come from logged hours: automatic, review, blocked, once per cycle', () => {
    const policy = policyOf(telecomSyscalls, 'credit.issue');
    const world = (outageHours: number, credited = false) => {
      const w = telecomWorld();
      Object.assign(w.lines[0], { outageHours, credited });
      return w;
    };
    const decide = (w: TelecomWorld) => policy({ lineId: 'L-7001' }, w).decision;
    expect(decide(world(0))).toBe('deny');
    expect(decide(world(20))).toBe('allow');
    expect(decide(world(21))).toBe('review');
    expect(decide(world(100))).toBe('review');
    expect(decide(world(101))).toBe('deny');
    expect(decide(world(6, true))).toBe('deny');
  });
});

describe('food-delivery distribution', () => {
  test('four customers: small refund, review, split claims and a high-value item', async () => {
    const k = bootDelivery();
    await k.run();
    expect(k.requests.map((r) => [r.kind, r.audience, r.summary])).toEqual([
      ['consent', 'kabir', 'Refund ₹320 for missing Paneer tikka on D-6102'],
      ['consent', 'meera', 'Refund ₹40 for missing Coke 300 ml on D-5521'],
    ]);
    // Zoya's agent splits a whole-order claim into one refund per item. Each is checked against
    // her rolling 30-day total, so splitting changes nothing and nobody is asked.
    const zoya = failures(k, pidOf(k, 'zoya'));
    expect(zoya.map((f) => [f.call, f.errno])).toEqual([
      ['item.refund', 'EPOLICY'],
      ['item.refund', 'EPOLICY'],
      ['item.refund', 'EPOLICY'],
    ]);
    expect(zoya[1].message).toBe(
      '₹1,450 already refunded in 30 days; ₹60 more would pass the ₹1,500 monthly limit. No approval can override it.',
    );
    expect(failures(k, pidOf(k, 'arjun'))).toMatchObject([
      { errno: 'EPOLICY', message: expect.stringContaining('store investigation') },
    ]);

    await approveAll(k);
    // Kabir asked for ₹450; the order says ₹320, and that needed an operator.
    expect(commits(k, 'item.refund')).toMatchObject([
      { orderId: 'D-5521', sku: 'coke', amountPaise: 4000 },
      { orderId: 'D-6102', sku: 'paneer-tikka', amountPaise: 32000 },
    ]);
    expect(k.world.orders.find((o) => o.id === 'D-7730')!.items.some((i) => i.refunded)).toBe(
      false,
    );
    expect(k.world.claims.filter((c) => c.daysAgo === 0).map((c) => c.customer)).toEqual([
      'meera',
      'kabir',
    ]);
    expect(k.world.tickets.map((t) => t.customer)).toEqual(['arjun', 'zoya']);
    expect(verify(k.journal).ok).toBe(true);
  });
  test('a repeat claimant goes to review even for a small item', () => {
    const policy = policyOf(deliverySyscalls, 'item.refund');
    const w = deliveryWorld();
    const args = { orderId: 'D-5521', sku: 'coke' };
    expect(policy(args, w).decision).toBe('allow');
    w.claims.push(
      { customer: 'meera', orderId: 'D-1', sku: 'x', amountPaise: 5000, daysAgo: 3 },
      { customer: 'meera', orderId: 'D-2', sku: 'y', amountPaise: 5000, daysAgo: 45 },
    );
    // A claim older than 30 days does not count.
    expect(policy(args, w).decision).toBe('allow');
    w.claims[w.claims.length - 1].daysAgo = 29;
    expect(policy(args, w)).toMatchObject({ decision: 'review' });
  });
  test('undelivered, unknown and already-refunded items are refused', () => {
    const policy = policyOf(deliverySyscalls, 'item.refund');
    const w = deliveryWorld();
    expect(policy({ orderId: 'D-5521', sku: 'samosa' }, w).decision).toBe('deny');
    w.orders[0].items[1].refunded = true;
    expect(policy({ orderId: 'D-5521', sku: 'coke' }, w).reason).toContain('already refunded');
    w.orders[0].delivered = false;
    expect(policy({ orderId: 'D-5521', sku: 'thali' }, w).reason).toContain('not been delivered');
  });
  test('rupees are formatted from integer paise with Indian grouping', () => {
    expect([rupees(4000), rupees(150000), rupees(12345678), rupees(4050)]).toEqual([
      '₹40',
      '₹1,500',
      '₹1,23,456.78',
      '₹40.50',
    ]);
  });
});
