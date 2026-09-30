import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { execFileSync } from 'node:child_process';
import { gauntlet } from '../../src/gauntlet/corpus.js';
import { runCase, summarize, type CaseResult } from '../../src/gauntlet/evaluate.js';
import type { Session, SessionStore } from '../../src/playground/domain.js';
import { HostedModel, modelConfig } from '../model-client.js';
import { BudgetLedger } from './budget.js';
const args = process.argv.slice(2);
const option = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const corpusHash = hash(JSON.stringify(gauntlet));
mkdirSync('public/evidence/gauntlet', { recursive: true });
writeFileSync(
  'public/evidence/gauntlet/corpus.json',
  JSON.stringify({ version: 1, corpusHash, cases: gauntlet }, null, 2) + '\n',
);
if (!args.includes('--live')) {
  console.log(
    JSON.stringify({
      corpusHash,
      cases: gauntlet.length,
      uniqueCases: new Set(gauntlet.map((c) => JSON.stringify(c.turns))).size,
      uniqueCustomerMessages: new Set(gauntlet.flatMap((c) => c.turns.map((t) => t.request))).size,
    }),
  );
  process.exit(0);
}
if (existsSync('.env')) loadEnvFile('.env');
const modelName = option('--model', 'gpt-4.1-mini');
if (!['gpt-4.1-mini', 'gpt-5.4'].includes(modelName))
  throw Error('Only priced model adapters are allowed.');
const files = [
  'src/gauntlet/corpus.ts',
  'src/gauntlet/evaluate.ts',
  'src/playground/kernel.ts',
  'src/playground/domain.ts',
  'server/model-client.ts',
  'server/gauntlet/budget.ts',
  'server/gauntlet/run.ts',
];
const sourceFilesSha256 = Object.fromEntries(files.map((p) => [p, hash(readFileSync(p, 'utf8'))]));
const sourceHash = hash(JSON.stringify(sourceFilesSha256));
const reportName = option('--report', modelName);
if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(reportName))
  throw Error('Report name must be a simple file stem.');
const out = `public/evidence/gauntlet/${reportName}.json`;
const sourceBundle = `evidence/gauntlet/source-${sourceHash}.json`;
writeFileSync(
  `public/${sourceBundle}`,
  JSON.stringify(
    {
      sourceHash,
      files: Object.fromEntries(
        files.map((path) => [
          path,
          { sha256: sourceFilesSha256[path], content: readFileSync(path, 'utf8') },
        ]),
      ),
    },
    null,
    2,
  ) + '\n',
);
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined;
if (previous && (previous.corpusHash !== corpusHash || previous.sourceHash !== sourceHash))
  throw Error(
    'Existing report uses different source/corpus; preserve it before starting a new run.',
  );
mkdirSync('data/gauntlet', { recursive: true });
// Reserve $1 for prior model/speech work and uncertainty. The remaining $2 is shared across both models and resumes.
const budget = new BudgetLedger('data/gauntlet/budget.db', 3, 1);
const rows: CaseResult[] = previous?.results ?? [];
const done = new Set(rows.map((r) => r.id));
let stoppedReason: string | undefined;
let stopRequested = false;
process.on('SIGINT', () => {
  stopRequested = true;
});
const generatedAt = previous?.generatedAt ?? new Date().toISOString();
function save() {
  const report = {
    version: 1,
    model: modelName,
    modelKind: 'hosted',
    generatedAt,
    updatedAt: new Date().toISOString(),
    corpusHash,
    sourceHash,
    sourceFilesSha256,
    sourceBundle,
    sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scope:
      'Synthetic local USD records through AgentKernel. No payment calls or operator approvals. Restart cases reopen a JSON checkpoint and reconstruct the kernel, not an OS process restart.',
    summary: summarize(rows),
    stoppedReason,
    budget: budget.snapshot(),
    results: rows,
  };
  writeFileSync(`${out}.tmp`, JSON.stringify(report, null, 2) + '\n');
  renameSync(`${out}.tmp`, out);
}
async function evaluateCase(c: (typeof gauntlet)[number]) {
  if (stopRequested) {
    stoppedReason = 'Operator stopped after the current case.';
    return;
  }
  if (budget.snapshot().remainingUsd < 0.01) {
    stoppedReason = 'Shared API budget reached before next case.';
    return;
  }
  const path = `data/gauntlet/${modelName}-${c.id}.json`;
  let initial = true;
  const createStore = async (state: Session): Promise<SessionStore> => {
    if (initial) {
      writeFileSync(path, JSON.stringify(state));
      initial = false;
    }
    // After restart, reopen the bytes already committed by the previous store.
    let current = JSON.parse(readFileSync(path, 'utf8')) as Session;
    return {
      async read() {
        return structuredClone(current);
      },
      async update(change) {
        const next = structuredClone(current);
        change(next);
        writeFileSync(`${path}.tmp`, JSON.stringify(next));
        renameSync(`${path}.tmp`, path);
        current = next;
        return structuredClone(current);
      },
    };
  };
  let reservation: string | undefined;
  const model = new HostedModel(
    { ...modelConfig(), name: modelName },
    (bound) => {
      reservation = budget.reserve(bound, modelName);
    },
    (cost) => {
      if (!reservation) throw Error('Missing budget reservation');
      const id = reservation;
      reservation = undefined;
      budget.settle(id, cost);
    },
  );
  const result = await runCase(c, model, createStore);
  rows.push(result);
  if (result.turns.some((t) => t.error?.toLowerCase().includes('budget')))
    stoppedReason =
      'Shared API budget reached during this case; outcome remains incomplete/failed.';
  // Authentication/rate failures are reported once instead of consuming the remaining budget on retries.
  if (result.turns.some((t) => /HTTP (401|403|429)|exceeded reserved/.test(t.error ?? '')))
    stoppedReason = 'Provider or budget anomaly; inspect the retained error.';
  save();
  if (rows.length % 10 === 0 || stoppedReason)
    console.log(
      JSON.stringify({
        model: modelName,
        ...summarize(rows),
        budget: budget.snapshot(),
        stoppedReason,
        families: undefined,
      }),
    );
}
const remaining = gauntlet.filter((c) => !done.has(c.id));
let cursor = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (cursor < remaining.length && !stoppedReason && !stopRequested)
      await evaluateCase(remaining[cursor++]);
  }),
);
if (stopRequested && !stoppedReason) stoppedReason = 'Operator stopped after the current case.';
rows.sort(
  (a, b) => gauntlet.findIndex((c) => c.id === a.id) - gauntlet.findIndex((c) => c.id === b.id),
);
save();
console.log(
  JSON.stringify({
    model: modelName,
    summary: summarize(rows),
    budget: budget.snapshot(),
    stoppedReason,
  }),
);
budget.close();
process.exitCode = rows.some((r) => r.policyViolation) ? 1 : stoppedReason ? 2 : 0;
