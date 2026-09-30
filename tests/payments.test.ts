import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { PaymentService, assertPayment, type Binding } from '../server/connectors/payment-service';
import {
  RazorpayTestGateway,
  type PaymentGateway,
  type Payment,
  type Refund,
} from '../server/connectors/razorpay';
const binding: Binding = {
  id: 'R-2000',
  providerOrderId: 'order_test',
  paymentId: 'pay_test',
  amount: 4900,
  currency: 'INR',
};
const payment: Payment = {
  id: 'pay_test',
  order_id: 'order_test',
  amount: 4900,
  currency: 'INR',
  status: 'captured',
  amount_refunded: 0,
};
const receipt: Refund = {
  id: 'rfnd_test',
  payment_id: 'pay_test',
  amount: 4900,
  currency: 'INR',
  status: 'processed',
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  const calls: string[] = [];
  let lost = false;
  const gateway: PaymentGateway = {
    async createOrder() {
      return { id: 'order_test', amount: 4900, currency: 'INR' };
    },
    async payments() {
      return [payment];
    },
    async payment() {
      return payment;
    },
    async refund(_id, _amount, key) {
      calls.push(key);
      if (lost) {
        lost = false;
        throw Error('Response lost after provider commit');
      }
      return receipt;
    },
    async refundStatus() {
      return receipt;
    },
  };
  const service = new PaymentService(db, gateway);
  return {
    db,
    service,
    gateway,
    calls,
    loseResponse: () => {
      lost = true;
    },
  };
}
describe('Razorpay test boundary', () => {
  test('live credentials fail before network access', () => {
    expect(() => new RazorpayTestGateway('rzp_live_abc', 'secret')).toThrow('Live keys');
  });
  test.each([
    { ...payment, amount: 49 },
    { ...payment, amount: 490000 },
    { ...payment, id: 'pay_other' },
    { ...payment, order_id: 'order_other' },
    { ...payment, amount_refunded: 1 },
    { ...payment, status: 'authorized' },
    { ...payment, amount: 49.5 },
  ])('rejects unsafe payment evidence %#', (p) => {
    expect(() => assertPayment(binding, p)).toThrow();
  });
  test('requires human approval and returns the reconciled provider receipt', async () => {
    const f = fixture();
    try {
      const b = await f.service.fixture();
      await f.service.sync(b.id);
      const i = await f.service.propose(b.id);
      await expect(f.service.execute(i.id)).rejects.toThrow('approval');
      expect(f.calls).toHaveLength(0);
      const done = await f.service.execute(i.id, true);
      expect(done.status).toBe('processed');
      expect(done.refundId).toBe('rfnd_test');
      await f.service.execute(i.id, true);
      expect(f.calls).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  test('lost responses survive service restart and reuse the same provider key', async () => {
    const f = fixture();
    try {
      const b = await f.service.fixture();
      await f.service.sync(b.id);
      const i = await f.service.propose(b.id);
      f.loseResponse();
      await expect(f.service.execute(i.id, true)).rejects.toThrow('Response lost');
      expect(f.service.intent(i.id).status).toBe('unknown');
      const resumed = new PaymentService(f.db, f.gateway);
      await resumed.execute(i.id);
      expect(f.calls).toEqual([i.id, i.id]);
      expect(resumed.snapshot().intents).toHaveLength(1);
      expect(resumed.intent(i.id).status).toBe('processed');
    } finally {
      f.db.close();
    }
  });
  test('mismatched provider receipt stays unknown rather than claiming success', async () => {
    const f = fixture();
    try {
      f.gateway.refund = async () => ({ ...receipt, amount: 49 });
      const b = await f.service.fixture();
      await f.service.sync(b.id);
      const i = await f.service.propose(b.id);
      await expect(f.service.execute(i.id, true)).rejects.toThrow('does not match');
      expect(f.service.intent(i.id).status).toBe('unknown');
    } finally {
      f.db.close();
    }
  });
  test('rejected intents cannot be approved or retried into a payment', async () => {
    const f = fixture();
    try {
      const b = await f.service.fixture();
      await f.service.sync(b.id);
      const i = await f.service.propose(b.id);
      f.service.reject(i.id);
      expect((await f.service.execute(i.id, true)).status).toBe('rejected');
      expect(f.calls).toHaveLength(0);
    } finally {
      f.db.close();
    }
  });
});
