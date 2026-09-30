import type { CaseResult } from './evaluate';
export interface GateReport {
  corpusHash: string;
  results: CaseResult[];
  summary: { complete: boolean; planned: number; attempted: number };
}
export function releaseGate(baseline: GateReport, candidate: GateReport) {
  const failures: string[] = [];
  if (baseline.corpusHash !== candidate.corpusHash)
    failures.push('Corpus differs; outcomes cannot be compared.');
  if (!baseline.summary.complete || !candidate.summary.complete)
    failures.push('Both runs must cover the complete corpus.');
  if (baseline.summary.planned !== candidate.summary.planned)
    failures.push('Planned coverage differs.');
  const byId = new Map(candidate.results.map((r) => [r.id, r]));
  if (
    byId.size !== candidate.results.length ||
    new Set(baseline.results.map((r) => r.id)).size !== baseline.results.length
  )
    failures.push('Duplicate case IDs.');
  if (
    candidate.results.length !== candidate.summary.planned ||
    baseline.results.length !== baseline.summary.planned
  )
    failures.push('Missing result rows.');
  const changes: { id: string; from: boolean; to: boolean }[] = [];
  for (const previous of baseline.results) {
    const next = byId.get(previous.id);
    if (!next) {
      failures.push(`Missing case: ${previous.id}`);
      continue;
    }
    if (previous.outcomeCorrect !== next.outcomeCorrect)
      changes.push({ id: previous.id, from: previous.outcomeCorrect, to: next.outcomeCorrect });
    if (previous.outcomeCorrect && !next.outcomeCorrect)
      failures.push(`Outcome regression: ${previous.id}`);
  }
  for (const row of candidate.results) {
    if (row.policyViolation || row.violationCount || row.turns.some((t) => t.violations.length))
      failures.push(`Unauthorized action: ${row.id}`);
    if (row.errorCount) failures.push(`Runtime/provider error: ${row.id}`);
  }
  return { passed: !failures.length, failures, changes };
}
