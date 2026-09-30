import { z } from 'zod';
export const paymentSchema = z.object({
  id: z.string().regex(/^pay_[a-zA-Z0-9]+$/),
  order_id: z.string(),
  amount: z.number().int().positive(),
  currency: z.literal('INR'),
  status: z.string(),
  amount_refunded: z.number().int().nonnegative(),
});
export type Payment = z.infer<typeof paymentSchema>;
export const refundSchema = z.object({
  id: z.string().regex(/^rfnd_[a-zA-Z0-9]+$/),
  payment_id: z.string(),
  amount: z.number().int().positive(),
  currency: z.literal('INR'),
  status: z.enum(['pending', 'processed', 'failed']),
});
export type Refund = z.infer<typeof refundSchema>;
export interface PaymentGateway {
  createOrder(receipt: string): Promise<{ id: string; amount: number; currency: string }>;
  payments(orderId: string): Promise<Payment[]>;
  payment(id: string): Promise<Payment>;
  refund(paymentId: string, amount: number, key: string): Promise<Refund>;
  refundStatus(id: string): Promise<Refund>;
}
export class RazorpayTestGateway implements PaymentGateway {
  constructor(
    public keyId: string,
    private secret: string,
  ) {
    if (!/^rzp_test_[a-zA-Z0-9]+$/.test(keyId) || !secret)
      throw Error('Razorpay test credentials required. Live keys are refused.');
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
    key?: string,
  ): Promise<unknown> {
    const r = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(key ? { 'X-Refund-Idempotency': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw Error(`Razorpay returned HTTP ${r.status}. Reconcile before retrying.`);
    return r.json();
  }
  async createOrder(receipt: string) {
    return z
      .object({
        id: z.string().regex(/^order_[a-zA-Z0-9]+$/),
        amount: z.literal(4900),
        currency: z.literal('INR'),
      })
      .parse(
        await this.request('/orders', 'POST', {
          amount: 4900,
          currency: 'INR',
          receipt,
          notes: { project: 'relay-agent-os', fixture: 'synthetic-only' },
        }),
      );
  }
  async payments(orderId: string) {
    if (!/^order_[a-zA-Z0-9]+$/.test(orderId)) throw Error('Invalid order ID.');
    return z
      .object({ items: z.array(paymentSchema) })
      .parse(await this.request(`/orders/${orderId}/payments`)).items;
  }
  async payment(id: string) {
    if (!/^pay_[a-zA-Z0-9]+$/.test(id)) throw Error('Invalid payment ID.');
    return paymentSchema.parse(await this.request(`/payments/${id}`));
  }
  async refund(paymentId: string, amount: number, key: string) {
    if (
      !/^pay_[a-zA-Z0-9]+$/.test(paymentId) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 50000 ||
      !/^relay-[a-f0-9-]{36}$/.test(key)
    )
      throw Error('Invalid bounded refund request.');
    return refundSchema.parse(
      await this.request(
        `/payments/${paymentId}/refund`,
        'POST',
        { amount, speed: 'normal', notes: { project: 'relay-agent-os' } },
        key,
      ),
    );
  }
  async refundStatus(id: string) {
    if (!/^rfnd_[a-zA-Z0-9]+$/.test(id)) throw Error('Invalid refund ID.');
    return refundSchema.parse(await this.request(`/refunds/${id}`));
  }
}
