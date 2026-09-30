import type { DatabaseSync } from 'node:sqlite';
import type { Payment, PaymentGateway, Refund } from './razorpay.js';
export interface Binding {
  id: string;
  providerOrderId: string;
  amount: number;
  currency: 'INR';
  paymentId?: string;
}
export interface Intent {
  id: string;
  bindingId: string;
  paymentId: string;
  amount: number;
  currency: 'INR';
  status:
    'awaiting_approval' | 'sending' | 'unknown' | 'pending' | 'processed' | 'failed' | 'rejected';
  approved: boolean;
  refundId?: string;
}
// Unit sanity, trusted entity binding and terminal-action readback.
export function assertPayment(binding: Binding, payment: Payment, allowRefunded = false) {
  if (payment.id !== binding.paymentId || payment.order_id !== binding.providerOrderId)
    throw Error('Payment is not bound to this order.');
  if (payment.currency !== binding.currency || binding.currency !== 'INR')
    throw Error('Currency mismatch.');
  if (
    !Number.isSafeInteger(binding.amount) ||
    binding.amount <= 0 ||
    binding.amount > 50000 ||
    payment.amount !== binding.amount
  )
    throw Error('Amount differs from the trusted record or exceeds the INR test limit.');
  if (!allowRefunded && (payment.status !== 'captured' || payment.amount_refunded !== 0))
    throw Error('Payment is not captured or already has a refund.');
}
export class PaymentService {
  private busy = new Set<string>();
  constructor(
    private db: DatabaseSync,
    private gateway: PaymentGateway,
  ) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS payment_bindings(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS refund_intents(id TEXT PRIMARY KEY,payment_id TEXT UNIQUE NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payment_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);`,
    );
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const v = fn();
      this.db.exec('COMMIT');
      return v;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private audit(kind: string, body: unknown) {
    this.db
      .prepare('INSERT INTO payment_audit(at,kind,body) VALUES(?,?,?)')
      .run(new Date().toISOString(), kind, JSON.stringify(body));
  }
  private save(i: Intent) {
    this.db
      .prepare(
        'INSERT INTO refund_intents VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(i.id, i.paymentId, JSON.stringify(i));
  }
  binding(id: string): Binding {
    const row = this.db.prepare('SELECT body FROM payment_bindings WHERE id=?').get(id);
    if (!row) throw Error('Unknown payment fixture.');
    return JSON.parse(String(row.body));
  }
  intent(id: string): Intent {
    const row = this.db.prepare('SELECT body FROM refund_intents WHERE id=?').get(id);
    if (!row) throw Error('Unknown refund intent.');
    return JSON.parse(String(row.body));
  }
  snapshot() {
    return {
      bindings: this.db
        .prepare('SELECT body FROM payment_bindings')
        .all()
        .map((r) => JSON.parse(String(r.body)) as Binding),
      intents: this.db
        .prepare('SELECT body FROM refund_intents')
        .all()
        .map((r) => JSON.parse(String(r.body)) as Intent),
      audit: this.db
        .prepare('SELECT at,kind,body FROM payment_audit ORDER BY id')
        .all()
        .map((r) => ({ at: r.at, kind: r.kind, data: JSON.parse(String(r.body)) })),
    };
  }
  async fixture() {
    if (this.snapshot().bindings.length >= 3)
      throw Error('Three test fixtures already exist. Reuse a fixture.');
    const id = `R-${2000 + this.snapshot().bindings.length}`;
    const order = await this.gateway.createOrder(`relay-${crypto.randomUUID().slice(0, 20)}`);
    const b: Binding = { id, providerOrderId: order.id, amount: order.amount, currency: 'INR' };
    this.atomic(() => {
      this.db.prepare('INSERT INTO payment_bindings VALUES(?,?)').run(id, JSON.stringify(b));
      this.audit('order.created', b);
    });
    return b;
  }
  async sync(id: string) {
    const b = this.binding(id);
    const payments = await this.gateway.payments(b.providerOrderId);
    const p = payments.find(
      (p) =>
        p.status === 'captured' &&
        p.order_id === b.providerOrderId &&
        p.amount === b.amount &&
        p.currency === b.currency &&
        (!b.paymentId || b.paymentId === p.id),
    );
    if (!p)
      throw Error('No matching captured test payment yet. Complete test checkout, then refresh.');
    b.paymentId = p.id;
    assertPayment(b, p);
    this.atomic(() => {
      this.db.prepare('UPDATE payment_bindings SET body=? WHERE id=?').run(JSON.stringify(b), id);
      this.audit('payment.verified', {
        id,
        paymentId: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
      });
    });
    return b;
  }
  async propose(id: string) {
    const b = this.binding(id);
    if (!b.paymentId) throw Error('Verify a captured payment first.');
    const existing = this.db
      .prepare('SELECT body FROM refund_intents WHERE payment_id=?')
      .get(b.paymentId);
    if (existing) return JSON.parse(String(existing.body)) as Intent;
    assertPayment(b, await this.gateway.payment(b.paymentId));
    const i: Intent = {
      id: `relay-${crypto.randomUUID()}`,
      bindingId: b.id,
      paymentId: b.paymentId,
      amount: b.amount,
      currency: 'INR',
      status: 'awaiting_approval',
      approved: false,
    };
    this.atomic(() => {
      this.save(i);
      this.audit('refund.proposed', i);
    });
    return i;
  }
  private verify(i: Intent, r: Refund) {
    if (r.payment_id !== i.paymentId || r.amount !== i.amount || r.currency !== i.currency)
      throw Error('Provider receipt does not match the approved intent.');
  }
  async execute(id: string, approve = false) {
    if (this.busy.has(id)) throw Error('This intent is already in flight.');
    this.busy.add(id);
    try {
      const i = this.intent(id);
      if (['processed', 'failed', 'rejected'].includes(i.status)) return i;
      if (i.status === 'awaiting_approval' && !approve) throw Error('Operator approval required.');
      const b = this.binding(i.bindingId);
      if (i.paymentId !== b.paymentId || i.amount !== b.amount || i.currency !== b.currency)
        throw Error('Intent no longer matches the trusted binding.');
      if (!i.approved) {
        assertPayment(b, await this.gateway.payment(i.paymentId));
        i.approved = true;
      }
      this.atomic(() => {
        i.status = 'sending';
        this.save(i);
        this.audit(approve ? 'operator.approved' : 'refund.retry', {
          intent: i.id,
          amount: i.amount,
          currency: i.currency,
        });
      });
      try {
        const started = performance.now();
        // A retry resends exactly the same persisted body and idempotency key. Never mint a new intent.
        const refund = i.refundId
          ? await this.gateway.refundStatus(i.refundId)
          : await this.gateway.refund(i.paymentId, i.amount, i.id);
        this.verify(i, refund);
        i.refundId = refund.id;
        i.status = refund.status;
        this.atomic(() => {
          this.save(i);
          this.audit('refund.reconciled', {
            intent: i.id,
            refund,
            milliseconds: Math.round(performance.now() - started),
          });
        });
        return i;
      } catch (e) {
        i.status = 'unknown';
        this.atomic(() => {
          this.save(i);
          this.audit('refund.unknown', { intent: i.id });
        });
        throw e;
      }
    } finally {
      this.busy.delete(id);
    }
  }
  reject(id: string) {
    const i = this.intent(id);
    if (i.status !== 'awaiting_approval') throw Error('Intent is no longer awaiting approval.');
    i.status = 'rejected';
    this.atomic(() => {
      this.save(i);
      this.audit('operator.rejected', { intent: id });
    });
    return i;
  }
}
