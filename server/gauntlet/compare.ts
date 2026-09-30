import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { releaseGate } from '../../src/gauntlet/gate.js';
const [baseline, candidate] = process.argv.slice(2);
if (!baseline || !candidate)
  throw Error('Usage: npm run gauntlet:compare -- BASELINE.json CANDIDATE.json');
const baselineReport = JSON.parse(readFileSync(baseline, 'utf8'));
const candidateReport = JSON.parse(readFileSync(candidate, 'utf8'));
const result = releaseGate(baselineReport, candidateReport);
for (const path of [
  'src/playground/kernel.ts',
  'src/playground/domain.ts',
  'src/gauntlet/evaluate.ts',
  candidateReport.modelKind === 'browser-webgpu'
    ? 'src/playground/model.ts'
    : 'server/model-client.ts',
]) {
  const current = createHash('sha256').update(readFileSync(path)).digest('hex');
  const recorded =
    path === 'src/gauntlet/evaluate.ts'
      ? (candidateReport.scoringSourceSha256 ?? candidateReport.sourceFilesSha256?.[path])
      : candidateReport.sourceFilesSha256?.[path];
  if (recorded !== current)
    result.failures.push(`Candidate is missing or has stale runtime source evidence: ${path}`);
}
result.passed = result.failures.length === 0;
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.passed ? 0 : 1;
