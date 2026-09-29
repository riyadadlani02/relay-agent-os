import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Effect, Knowledge, Policy, Run, RunEvent } from '../src/shared.js';

import { articles, defaultPolicy } from './catalog.js';

export class Store {
  db: DatabaseSync;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), at TEXT NOT NULL, type TEXT NOT NULL, agent TEXT NOT NULL, message TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effects (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_run_idx ON events(run_id, id);`);
    this.db
      .prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)')
      .run('policy', JSON.stringify(defaultPolicy));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  save(run: Run) {
    this.db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?)').run(run.id, JSON.stringify(run));
  }
  get(id: string): Run | undefined {
    const row = this.db.prepare('SELECT body FROM runs WHERE id=?').get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  runs(): Run[] {
    return this.db
      .prepare('SELECT body FROM runs')
      .all()
      .map((r) => JSON.parse(String(r.body)))
      .sort((a: Run, b: Run) => b.createdAt.localeCompare(a.createdAt));
  }
  event(
    run: Run,
    type: string,
    agent: string,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    this.db
      .prepare(
        'INSERT INTO events(run_id, at, type, agent, message, data) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(run.id, run.updatedAt, type, agent, message, JSON.stringify(data));
  }
  events(runId?: string): RunEvent[] {
    const rows = runId
      ? this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY id').all(runId)
      : this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 200').all();
    return rows.map((r) => ({
      id: Number(r.id),
      runId: String(r.run_id),
      at: String(r.at),
      type: String(r.type),
      agent: String(r.agent),
      message: String(r.message),
      data: JSON.parse(String(r.data)),
    }));
  }
  policy(): Policy {
    return JSON.parse(
      String(this.db.prepare('SELECT value FROM settings WHERE key=?').get('policy')!.value),
    );
  }
  setPolicy(policy: Policy) {
    this.db
      .prepare('UPDATE settings SET value=? WHERE key=?')
      .run(JSON.stringify(policy), 'policy');
  }
  effects(): Effect[] {
    return this.db
      .prepare('SELECT * FROM effects ORDER BY at DESC')
      .all()
      .map((r) => ({
        id: String(r.id),
        runId: String(r.run_id),
        kind: String(r.kind),
        amountCents: Number(r.amount_cents),
        at: String(r.at),
      }));
  }
  commitEffect(run: Run) {
    this.db
      .prepare('INSERT OR IGNORE INTO effects VALUES (?, ?, ?, ?, ?)')
      .run(
        `${run.id}:${run.plan!.action}`,
        run.id,
        run.plan!.action,
        run.plan!.action === 'refund' ? run.amountCents : 0,
        run.updatedAt,
      );
  }
  knowledge(): Knowledge[] {
    return articles;
  }
  close() {
    this.db.close();
  }
}
