import { Runtime } from './runtime.js';
import type { Store } from './store.js';
export async function seed(store: Store) {
  if (store.runs().length) return;
  const runtime = new Runtime(store);
  const samples = [
    {
      customer: 'Olivia Chen',
      amountCents: 4900,
      scenario: 'refund' as const,
      issue: 'I was charged twice for my monthly subscription.',
    },
    {
      customer: 'James Wilson',
      amountCents: 2500,
      scenario: 'refund' as const,
      issue: 'Please refund the unused delivery fee on my order.',
    },
    {
      customer: 'Sofia Martinez',
      amountCents: 0,
      scenario: 'account' as const,
      issue: 'I cannot access my workspace after changing my email.',
    },
    {
      customer: 'Noah Williams',
      amountCents: 7900,
      scenario: 'refund' as const,
      issue: 'My subscription renewed after I cancelled last week.',
    },
    {
      customer: 'Isabella Kim',
      amountCents: 3900,
      scenario: 'refund' as const,
      issue: 'The add-on was accidentally purchased twice.',
    },
    {
      customer: 'Ethan Davis',
      amountCents: 0,
      scenario: 'account' as const,
      issue: 'I need help recovering access to my organization.',
    },
    {
      customer: 'Mia Patel',
      amountCents: 6500,
      scenario: 'refund' as const,
      issue: 'The wrong shipping method was charged to my order.',
    },
    {
      customer: 'Lucas Brown',
      amountCents: 1900,
      scenario: 'refund' as const,
      issue: 'Please return the duplicate service charge.',
    },
    {
      customer: 'Ava Thompson',
      amountCents: 24900,
      scenario: 'refund' as const,
      issue: 'My annual subscription renewed despite my cancellation. Please refund $249.',
    },
    {
      customer: 'Oliver Park',
      amountCents: 8900,
      scenario: 'replacement' as const,
      issue: 'My headphones arrived damaged. I would like a replacement.',
    },
  ];
  for (const [index, input] of samples.entries()) {
    const run = runtime.create(
      { ...input, faultOnce: index === 3 },
      'sample',
      new Date(Date.now() - (samples.length - index) * 35 * 60000).toISOString(),
    );
    for (let i = 0; i < 8; i++) await runtime.step(run.id);
  }
}
