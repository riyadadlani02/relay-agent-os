import { dollars } from '../playground/domain';
import { rupees } from './distribution';
import type { RelayKernel } from './kernel';
import { bootDelivery, deliveryCustomers, type DeliveryWorld } from './delivery';
import { bootSupport, customers, type SupportWorld } from './support';
import { bootTelecom, telecomCustomers, type TelecomWorld } from './telecom';

// What the console needs to show one scripted distribution. The kernel and the console are the
// same for every industry; only these descriptions differ.

export interface WorldRecord {
  id: string;
  text: string;
  status: string;
  changed: boolean;
}
export interface Scenario<W = any> {
  id: string;
  label: string;
  intro: string;
  boot(): RelayKernel<W>;
  requests: { id: string; request: string }[];
  records(world: W): WorldRecord[];
  footer(world: W): string;
  /** The journal demo edits the first committed amount in this field. */
  tamper: { label: string; field: string };
}

const retail: Scenario<SupportWorld> = {
  id: 'retail',
  label: 'Retail refunds',
  intro:
    'Four customers share one kernel. Each conversation runs as a process that holds only the capabilities it was handed. Every call passes the same gate: capability → policy → the owner’s consent → operator approval → atomic commit → hash-chained journal.',
  boot: bootSupport,
  requests: customers,
  records: (w) =>
    w.orders.map((o) => ({
      id: o.id,
      text: `${o.product} · ${dollars(o.amountCents)} · ${o.customer}`,
      status: o.refunded ? 'refunded' : 'unchanged',
      changed: o.refunded,
    })),
  footer: (w) =>
    `${w.receipts.length} receipts · ${w.tickets.length} support tickets. Sample records in memory; no payment is made.`,
  tamper: { label: 'Change a refund in the log to $0.01', field: 'amountCents' },
};

const telecom: Scenario<TelecomWorld> = {
  id: 'telecom',
  label: 'Telecom',
  intro:
    'The same kernel in a scripted mobile-operator scenario on fictional data, where the strictest tier depends on identity, not money. Asha’s outage credit comes from the network log, not her message. Ravi’s SIM swap passed an in-store ID check, but his SIM changed 12 days ago, so the fraud desk decides. Mallory claims to be Asha: her agent cannot touch Asha’s line, and Asha is never asked. Dev has no in-store ID check, so no approval can move his number.',
  boot: bootTelecom,
  requests: telecomCustomers,
  records: (w) =>
    w.lines.map((l) => {
      const credit = w.credits.find((c) => c.lineId === l.id);
      const swapped = w.swaps.some((s) => s.lineId === l.id);
      const status = [credit && `credited ${rupees(credit.amountPaise)}`, swapped && 'SIM moved']
        .filter(Boolean)
        .join(' · ');
      return {
        id: l.id,
        text: `${l.number} · ${l.plan} · ${l.customer}`,
        status: status || 'unchanged',
        changed: !!status,
      };
    }),
  footer: (w) =>
    `${w.credits.length} credits · ${w.swaps.length} SIM swaps · ${w.tickets.length} tickets. Sample records in memory; no network or billing system is touched.`,
  tamper: { label: 'Change a credit in the log to ₹0.01', field: 'amountPaise' },
};

const delivery: Scenario<DeliveryWorld> = {
  id: 'delivery',
  label: 'Food delivery',
  intro:
    'The same kernel in a scripted food-delivery scenario on fictional data, in Hinglish, where limits add up over time. Meera’s ₹40 Coke is refunded once she confirms. Kabir asks for ₹450, but the order says ₹320, and that needs an operator. Zoya splits a whole-order claim into item refunds; each counts against her 30-day total, so all three are blocked. Arjun’s ₹1,900 charger is above the per-item limit and goes to a person.',
  boot: bootDelivery,
  requests: deliveryCustomers,
  records: (w) =>
    w.orders.map((o) => {
      const refunded = o.items.filter((i) => i.refunded).map((i) => i.name);
      return {
        id: o.id,
        text: `${o.store} · ${o.items.map((i) => `${i.name} ${rupees(i.pricePaise * i.qty)}`).join(', ')} · ${o.customer}`,
        status: refunded.length ? `refunded ${refunded.join(', ')}` : 'unchanged',
        changed: refunded.length > 0,
      };
    }),
  footer: (w) =>
    `${w.refunds.length} item refunds · ${w.tickets.length} tickets. Sample records in memory; no payment is made.`,
  tamper: { label: 'Change a refund in the log to ₹0.01', field: 'amountPaise' },
};

export const scenarios: Scenario[] = [retail, telecom, delivery];
