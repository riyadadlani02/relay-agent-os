import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { gauntlet } from '../src/gauntlet/corpus';
import { fixture, scoreTurn, type CaseResult } from '../src/gauntlet/evaluate';

// Free and offline: how many recorded "could not ground its answer" errors were caused only by
// reading a customer-named order ID (R-1042) as the numeric claim 1042. Withheld reply text was
// not recorded, so this works from the flagged numbers in each trace. It is a projection, not a
// rerun: a reply shown instead of withheld changes the history later turns would have seen.
// Usage: npx tsx scripts/project-order-id-fix.ts [report.json] [output.json]
const [
  input = 'public/evidence/gauntlet/gpt-4.1-mini.json',
  output = 'public/evidence/gauntlet/gpt-4.1-mini.order-id-projection.json',
] = process.argv.slice(2);
const report = JSON.parse(readFileSync(input, 'utf8'));
const corpusHash = createHash('sha256').update(JSON.stringify(gauntlet)).digest('hex');
if (report.corpusHash !== corpusHash) throw Error('Corpus changed; cannot project.');
const GROUNDING = 'could not ground its answer';

const cases = [];
for (const row of report.results as CaseResult[]) {
  const c = gauntlet.find((x) => x.id === row.id);
  if (!c) throw Error(`Unknown case ${row.id}`);
  let before = fixture(c);
  const turns = row.turns.map((t, i) => {
    const score = scoreTurn(c, i, before, t.session);
    const from = i ? row.turns[i - 1].session.traces.length : 0;
    const flagged = t.session.traces
      .slice(from)
      .filter((x) => x.name === 'answer.unsupported_facts')
      .map((x) => (x.input as { numbers: number[] }).numbers);
    const named = [...new Set(c.turns[i].request.match(/\bR-\d{4}\b/gi) ?? [])].map((id) =>
      id.toUpperCase(),
    );
    // The final attempt's flagged numbers that are not one of the named order IDs.
    const last = flagged.at(-1) ?? [];
    const remaining = last.filter((n) => !named.some((id) => Number(id.slice(2)) === n));
    const cleared = !!t.error?.includes(GROUNDING) && last.length > 0 && remaining.length === 0;
    before = t.session;
    return {
      actionCorrect: score.outcomeCorrect,
      error: t.error,
      cleared,
      flagged,
      named,
      projectedCorrect: score.outcomeCorrect && (!t.error || cleared),
    };
  });
  const complete = turns.length === c.turns.length;
  cases.push({
    id: c.id,
    family: c.family,
    legitimate: c.legitimate,
    recordedCorrect: row.outcomeCorrect,
    actionCorrect: complete && turns.every((t) => t.actionCorrect),
    projectedCorrect: complete && turns.every((t) => t.projectedCorrect),
    errored: turns.some((t) => t.error),
    cleared: turns.some((t) => t.error) && turns.every((t) => !t.error || t.cleared),
    turns: turns
      .filter((t) => t.error)
      .map(({ error, cleared, flagged, named }) => ({
        error,
        cleared,
        flagged,
        named,
      })),
  });
}
const count = (f: (c: (typeof cases)[number]) => boolean) => cases.filter(f).length;
const summary = {
  cases: cases.length,
  recordedOutcomesCorrect: count((c) => c.recordedCorrect),
  actionsCorrectIgnoringReplyChecker: count((c) => c.actionCorrect),
  casesWithErrors: count((c) => c.errored),
  errorsOnlyFromNamedOrderId: count((c) => c.cleared),
  errorsRemaining: count((c) => c.errored && !c.cleared),
  projectedOutcomesCorrect: count((c) => c.projectedCorrect),
  projectedLegitimateRequestsFailed: count((c) => c.legitimate && !c.projectedCorrect),
  unauthorizedActions: report.summary.policyViolations,
  remainingErrorCases: cases.filter((c) => c.errored && !c.cleared).map((c) => c.id),
};
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
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
        ['src/playground/domain.ts', 'src/gauntlet/evaluate.ts'].map((p) => [p, sha(p)]),
      ),
      scope:
        'Projection from recorded traces, not a model run. A case is cleared when every errored turn was withheld only for numbers equal to an order ID the customer named in that turn. Withheld reply text was not recorded, so the rest of each reply is unverified, and a shown reply would have changed the history later turns saw. The published result stays the measured one until `npm run gauntlet:live` reruns the corpus.',
      summary,
      cases: cases.filter((c) => c.errored),
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(summary));
