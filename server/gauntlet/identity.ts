import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = [
  'src/playground/kernel.ts',
  'src/playground/domain.ts',
  'src/playground/model.ts',
  'src/playground/model-worker.ts',
  'server/model-client.ts',
  'src/gauntlet/corpus.ts',
  'src/gauntlet/evaluate.ts',
  'src/gauntlet/Gauntlet.tsx',
];
mkdirSync('public/evidence/gauntlet', { recursive: true });
writeFileSync(
  'public/evidence/gauntlet/runtime-source.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceFilesSha256: Object.fromEntries(
        files.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
      ),
    },
    null,
    2,
  ) + '\n',
);
