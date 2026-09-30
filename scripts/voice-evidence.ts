import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { AgentKernel } from '../src/playground/kernel.js';
import { newSession, type SessionStore } from '../src/playground/domain.js';
import { HostedModel, modelConfig } from '../server/model-client.js';
if (!process.argv.includes('--live')) throw Error('Pass --live to call the configured model.');
loadEnvFile('.env');
const speech = JSON.parse(readFileSync('public/evidence/voice-transcription.json', 'utf8'));
// Explicitly documented operator review: recognition omitted the hyphen in the identifier.
const reviewed = speech.transcript.replace(/\bR1042\b/g, 'R-1042');
let state = newSession();
const store: SessionStore = {
  async read() {
    return structuredClone(state);
  },
  async update(change) {
    const next = structuredClone(state);
    change(next);
    state = next;
    return structuredClone(state);
  },
};
const model = new HostedModel(modelConfig());
const kernel = new AgentKernel(
  store,
  model,
  () => {},
  () => {},
);
await kernel.send(reviewed);
const evidence = {
  generatedAt: new Date().toISOString(),
  audio: 'hindi-request.mp3',
  syntheticSpeech: true,
  speech,
  review: {
    original: speech.transcript,
    reviewed,
    edit: 'Operator normalized R1042 to the exact record ID R-1042. No amount or intent was inferred from audio.',
    automaticallySubmitted: false,
  },
  model: model.name,
  usage: model.usage,
  session: state,
};
writeFileSync('public/evidence/voice-run.json', JSON.stringify(evidence, null, 2) + '\n');
console.log({ model: model.name, receipts: state.receipts });
