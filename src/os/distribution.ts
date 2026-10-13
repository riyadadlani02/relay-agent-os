import { z } from 'zod';
import type { Outcome, Program, Proposal, RelayKernel, Syscall } from './kernel';

// Shared pieces for small kernel "distributions": a world, its syscalls and policies, and a few
// scripted customers. The kernel itself knows nothing about orders, phone lines or money; each
// industry supplies only these parts.

export interface Ticket {
  id: string;
  customer: string;
  summary: string;
}
export interface PolicyText {
  id: string;
  title: string;
  text: string;
}

/** Hand a conversation to a person. Each distribution gives its people a few uses of this. */
export function ticketSyscall<W extends { tickets: Ticket[] }>(
  queue: string,
): Syscall<W, { summary: string }> {
  return {
    name: 'ticket.create',
    effect: 'write',
    args: z.object({ summary: z.string().min(1).max(300) }).strict(),
    resource: () => `queue:${queue}`,
    describe: (a) => `Open a ${queue} ticket: "${a.summary}"`,
    summary: 'Hand the conversation to a person, with a short summary.',
    run: (a, world, context) => {
      const ticket = { id: `T-${world.tickets.length + 1}`, customer: context.owner, ...a };
      world.tickets.push(ticket);
      return ticket;
    },
  };
}

/** Keyword search over a distribution's written policies. */
export function policySearch<W>(policies: PolicyText[]): Syscall<W, { query: string }> {
  return {
    name: 'kb.search',
    effect: 'read',
    args: z.object({ query: z.string().max(200) }).strict(),
    resource: () => 'kb:policies',
    describe: (a) => `Search policies for "${a.query}"`,
    summary: 'Search the written policies.',
    run: (a) => {
      const words = a.query.toLowerCase().split(/\W+/).filter(Boolean);
      const hits = policies.filter((p) =>
        words.some((w) => `${p.title} ${p.text}`.toLowerCase().includes(w)),
      );
      return hits.length ? hits : policies;
    },
  };
}

/** Indian rupees from integer paise, e.g. 150000 → ₹1,500 and 4050 → ₹40.50. */
export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

// Scripted programs charge a fixed, clearly simulated token cost so budgets are exercised.
const COST = 120;
export const call = (name: string, args: unknown, note?: string): Proposal => ({
  call: name,
  args,
  tokens: COST,
  ...(note ? { note } : {}),
});
type Brief = { call: string; ok: true } | { call: string; ok: false; errno: string };
const brief = (o: Outcome): Brief =>
  o.ok ? { call: o.call, ok: true } : { call: o.call, ok: false, errno: o.errno };

export interface Plan {
  /** Proposals made in order, standing in for what a model would propose. */
  steps: Proposal[];
  /** Opened once if the kernel refused a change, instead of retrying it. */
  handoff?: Proposal;
}
interface PlanMemory extends Plan {
  next: number;
  outcomes: Brief[];
  handedOff: boolean;
}
const REFUSED = ['EPERM', 'EPOLICY', 'EDECLINED', 'EREJECTED'];

/**
 * A SCRIPTED stand-in for a model-driven agent: it proposes a fixed list of calls, including
 * prompt-injected ones, so every kernel decision is reproducible.
 */
export const planner: Program<PlanMemory> = {
  name: 'planner',
  init: (arg) => ({ ...(arg as Plan), next: 0, outcomes: [], handedOff: false }),
  step({ memory: m, last }) {
    if (last) m.outcomes.push(brief(last));
    if (m.next < m.steps.length) return m.steps[m.next++];
    const refused = m.outcomes.some(
      (o) => !o.ok && REFUSED.includes(o.errno) && o.call !== 'ticket.create',
    );
    if (m.handoff && refused && !m.handedOff) {
      m.handedOff = true;
      return m.handoff;
    }
    return { exit: m.outcomes, tokens: COST };
  },
};

export interface Customer {
  id: string;
  request: string;
  /** The records this customer owns, e.g. `line:L-7001`. */
  owns: string[];
  plan: Plan;
}

/**
 * Boots a distribution: each person gets standing authority over what they own, and each
 * conversation runs as a process holding read access, the policies and one handoff ticket, but
 * no authority to change anything until its owner consents to one exact call.
 */
export function bootCustomers<W>(
  kernel: RelayKernel<W>,
  customers: Customer[],
  options: { read: string; write: string[]; queue: string },
) {
  for (const c of customers) {
    for (const resource of c.owns)
      kernel.grantStanding(c.id, { rights: [options.read, ...options.write], resource });
    kernel.grantStanding(c.id, { rights: ['kb.search'], resource: 'kb:policies' });
    kernel.grantStanding(c.id, {
      rights: ['ticket.create'],
      resource: `queue:${options.queue}`,
      uses: 3,
    });
  }
  for (const c of customers)
    kernel.spawn(
      { kind: 'user', id: c.id },
      {
        program: 'planner',
        owner: c.id,
        name: `agent/${c.id}`,
        arg: c.plan,
        budget: { steps: 12, tokens: 4000 },
        grants: [
          ...c.owns.map((resource) => ({ rights: [options.read], resource })),
          { rights: ['kb.search'], resource: 'kb:policies' },
          { rights: ['ticket.create'], resource: `queue:${options.queue}`, uses: 1 },
        ],
      },
    );
  return kernel;
}
