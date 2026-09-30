import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { gauntlet } from '../src/gauntlet/corpus';
import { runCase, type CaseResult } from '../src/gauntlet/evaluate';
import { replayModel } from '../src/gauntlet/replay';

// Free and offline: feeds a published run's recorded tool choices through the current kernel.
// Usage: npx tsx scripts/replay-gauntlet.ts [report.json] [output.json]
const [
  input = 'public/evidence/gauntlet/qwen.json',
  output = 'public/evidence/gauntlet/qwen-replay.json',
] = process.argv.slice(2);
const report = JSON.parse(readFileSync(input, 'utf8'));
const corpusHash = createHash('sha256').update(JSON.stringify(gauntlet)).digest('hex');
if (report.corpusHash !== corpusHash)
  throw Error('Corpus changed; the recorded run cannot be replayed.');
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

const results = [];
for (const original of report.results as CaseResult[]) {
  const c = gauntlet.find((x) => x.id === original.id);
  if (!c) throw Error(`Unknown case ${original.id}`);
  const model = replayModel(original);
  const replayed = await runCase(c, model);
  results.push({
    id: c.id,
    family: c.family,
    language: c.language,
    legitimate: c.legitimate,
    original: {
      observed: original.turns.map((t) => t.observed),
      violations: original.turns.flatMap((t) => t.violations),
      outcomeCorrect: original.outcomeCorrect,
    },
    replay: {
      observed: replayed.turns.map((t) => t.observed),
      consent: replayed.turns.map((t) => t.consent),
      violations: replayed.turns.flatMap((t) => t.violations),
      outcomeCorrect: replayed.outcomeCorrect,
      errors: replayed.turns.flatMap((t) => (t.error ? [t.error] : [])),
      receipts: replayed.turns.at(-1)!.session.receipts.filter((r) => r.kind !== 'handoff').length,
    },
    unusedRecordedSteps: model.remaining(),
  });
}
const summary = {
  cases: results.length,
  originalUnauthorizedCases: results.filter((r) => r.original.violations.length).length,
  replayUnauthorizedCases: results.filter((r) => r.replay.violations.length).length,
  replayDeclinedProposals: results.filter((r) => r.replay.consent.includes('declined')).length,
  replayErrors: results.filter((r) => r.replay.errors.length).length,
  unusedRecordedSteps: results.reduce((n, r) => n + r.unusedRecordedSteps, 0),
  changedCases: results
    .filter((r) => JSON.stringify(r.original.observed) !== JSON.stringify(r.replay.observed))
    .map((r) => r.id),
};
writeFileSync(
  output,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: input,
      sourceModel: report.model,
      corpusHash,
      sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceFilesSha256: Object.fromEntries(
        [
          'src/playground/kernel.ts',
          'src/playground/domain.ts',
          'src/os/capability.ts',
          'src/gauntlet/evaluate.ts',
          'src/gauntlet/replay.ts',
        ].map((path) => [path, sha(path)]),
      ),
      scope:
        'Replay of recorded model tool choices through the current kernel, with the Gauntlet simulated customer answering confirmation prompts. No new inference; this is not a new model evaluation and does not cover the 485 untested cases.',
      summary,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(summary));
