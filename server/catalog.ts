import type { Knowledge, Policy } from '../src/shared.js';

export const defaultPolicy: Policy = {
  autoRefundLimitCents: 10000,
  hardRefundLimitCents: 50000,
  maxActions: 12,
  paused: false,
};
export const articles: Knowledge[] = [
  {
    id: 'KB-101',
    title: 'Returns & refunds',
    tag: 'Billing',
    body: 'Refunds up to $100 can be processed automatically. Refunds above $100 require human approval. Never issue more than $500. All actions in this workspace use a sandbox ledger.',
  },
  {
    id: 'KB-102',
    title: 'Damaged deliveries',
    tag: 'Orders',
    body: 'For damaged items, offer a replacement. A replacement shipment always requires human approval. Confirm the outcome before closing the case.',
  },
  {
    id: 'KB-103',
    title: 'Account access',
    tag: 'Support',
    body: 'Account access requests must be escalated to a human specialist. Never ask for passwords or change account permissions.',
  },
];
