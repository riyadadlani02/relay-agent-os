import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { Store } from './store.js';
import { Runtime } from './runtime.js';
import { configuredPlanner } from './provider.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
if (existsSync('.env')) loadEnvFile('.env');
const store = new Store(process.env.DATABASE_PATH ?? './data/relay.db');
await seed(store);
const runtime = new Runtime(store, configuredPlanner());
const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? '127.0.0.1';
const server = createApp(runtime).listen(port, host, () =>
  console.log(`Relay OS ready at http://${host}:${port} · ${runtime.planner.name}`),
);
let current: Promise<void> | undefined;
const timer = setInterval(() => {
  if (!current)
    current = runtime
      .tick()
      .catch((e) =>
        console.error('Worker tick failed:', e instanceof Error ? e.name : 'UnknownError'),
      )
      .finally(() => {
        current = undefined;
      });
}, 1100);
async function shutdown() {
  clearInterval(timer);
  server.close();
  await current;
  store.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
