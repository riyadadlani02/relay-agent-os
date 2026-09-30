import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { verify } from '../src/os/journal';
import { bootLive, customers, runWorkflow, startConversation } from '../src/os/support';
import type { RunnerMemory } from '../src/os/workflow';
import { HostedModel, modelConfig } from '../server/model-client';

// Paid and explicit: a hosted model drives every agent in the four-customer scenario.
// Usage: npm run os:live -- --live [--unconstrained] [--workflows]
// --workflows runs multi-agent workflows (refund-verified, handoff, status) instead of one concierge.
// Simulated people answer prompts. A customer confirms only a refund of the order their request
// is about, and only if they asked for a refund; the operator approves reviews. Results go to
// data/os-live/ (ignored by Git) until you choose to publish them.
if (!process.argv.includes('--live'))
  throw new Error('This calls a paid model provider. Pass --live explicitly.');
if (existsSync('.env')) loadEnvFile('.env');
const constrained = !process.argv.includes('--unconstrained');
const workflows = process.argv.includes('--workflows');
const workflowFor: Record<string, string> = {
  alice: 'refund-verified',
  bob: 'refund-verified',
  carol: 'handoff',
  dave: 'status',
};
const capUsd = 0.25;
let spent = 0;
let reserved = 0;
let reservation = 0;
const model = new HostedModel(
  modelConfig(),
  (bound) => {
    if (spent + reserved + bound > capUsd) throw new Error(`Budget of $${capUsd} reached.`);
    reservation = bound;
    reserved += bound;
  },
  (cost) => {
    reserved -= reservation;
    spent += cost;
    reservation = 0;
  },
);
const kernel = bootLive({ model: () => model, constrain: () => constrained });
for (const c of customers)
  if (workflows) runWorkflow(kernel, workflowFor[c.id], c.id, c.request);
  else startConversation(kernel, c.id, c.request);

const decisions: {
  request: string;
  kind: string;
  by: string;
  granted: boolean;
  summary: string;
}[] = [];
const started = performance.now();
for (let round = 0; round < 20; round++) {
  await kernel.run(300);
  if (!kernel.requests.length) break;
  for (const request of [...kernel.requests]) {
    const customer = customers.find((c) => c.id === request.audience);
    const granted =
      request.kind === 'approval' ||
      (customer?.intent === 'refund' &&
        request.call === 'refund.issue' &&
        request.resource === `order:${customer.orderId}`);
    kernel.decide(
      request.id,
      granted,
      request.kind === 'approval'
        ? { kind: 'operator', id: 'simulated-operator' }
        : { kind: 'user', id: request.audience },
    );
    decisions.push({
      request: request.id,
      kind: request.kind,
      by: request.audience,
      granted,
      summary: request.summary,
    });
  }
}

const failures = kernel.journal.filter(
  (e) => e.type === 'syscall.failed' || e.type === 'proposal.invalid',
);
const report = {
  generatedAt: new Date().toISOString(),
  model: model.name,
  constrained,
  mode: workflows ? 'workflows' : 'concierge',
  scope:
    'Hosted-model agents on the Relay kernel with simulated customers and operator. Fictional in-memory records; no payment API.',
  wallTimeMs: Math.round(performance.now() - started),
  estimatedCostUsd: Number(spent.toFixed(4)),
  usage: model.usage,
  conversations: kernel.processes
    .filter((p) => p.ppid === null)
    .map((p) => ({
      customer: p.owner,
      request: customers.find((c) => c.id === p.owner)?.request,
      exit: p.exit,
      steps: p.used.steps,
      tokens: p.used.tokens,
      children: kernel.processes.filter((c) => c.ppid === p.pid).map((c) => c.exit),
      ...(p.program === 'workflow' ? { workflowSteps: (p.memory as RunnerMemory).states } : {}),
    })),
  decisions,
  refused: failures.map((e) => ({ pid: e.pid, ...(e.data as object) })),
  receipts: kernel.world.receipts,
  tickets: kernel.world.tickets,
  journalVerified: verify(kernel.journal).ok,
  journal: kernel.journal,
};
mkdirSync('data/os-live', { recursive: true });
const path = `data/os-live/${model.name}-${workflows ? 'workflows' : 'concierge'}-${constrained ? 'constrained' : 'unconstrained'}-${report.generatedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      path,
      model: model.name,
      constrained,
      costUsd: report.estimatedCostUsd,
      receipts: report.receipts.map((r) => `${r.orderId} ${r.amountCents}`),
      refused: report.refused.length,
      answers: report.conversations.map((c) => [c.customer, c.exit?.status, c.exit?.value]),
    },
    null,
    2,
  ),
);
