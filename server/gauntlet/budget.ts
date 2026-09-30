import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
export class BudgetExceeded extends Error {
  constructor() {
    super('Shared evaluation budget reached; no request sent.');
  }
}
export class BudgetLedger {
  private db: DatabaseSync;
  constructor(path: string, cap = 3, priorReserve = 1) {
    if (
      !Number.isFinite(cap) ||
      cap <= 0 ||
      !Number.isFinite(priorReserve) ||
      priorReserve < 0 ||
      priorReserve > cap
    )
      throw Error('Invalid budget');
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS limits (id INTEGER PRIMARY KEY CHECK(id=1), cap REAL NOT NULL, prior REAL NOT NULL); CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, bound REAL NOT NULL, actual REAL, model TEXT NOT NULL)',
    );
    this.db.prepare('INSERT OR IGNORE INTO limits VALUES (1, ?, ?)').run(cap, priorReserve);
    const existing = this.db.prepare('SELECT cap, prior FROM limits WHERE id=1').get() as {
      cap: number;
      prior: number;
    };
    if (existing.cap !== cap || existing.prior !== priorReserve) {
      this.db.close();
      throw Error('Existing budget settings differ; refusing to reset the ledger.');
    }
  }
  snapshot() {
    const limits = this.db.prepare('SELECT cap, prior FROM limits WHERE id=1').get() as {
      cap: number;
      prior: number;
    };
    const totals = this.db
      .prepare(
        'SELECT COALESCE(SUM(COALESCE(actual,bound)),0) AS charged, COUNT(*) AS calls FROM calls',
      )
      .get() as { charged: number; calls: number };
    return {
      capUsd: limits.cap,
      priorReserveUsd: limits.prior,
      currentChargedUsd: totals.charged,
      remainingUsd: Math.max(0, limits.cap - limits.prior - totals.charged),
      calls: totals.calls,
    };
  }
  reserve(bound: number, model: string) {
    if (!Number.isFinite(bound) || bound <= 0) throw Error('Invalid call reservation');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.snapshot().remainingUsd < bound) throw new BudgetExceeded();
      const id = randomUUID();
      this.db.prepare('INSERT INTO calls(id,bound,model) VALUES(?,?,?)').run(id, bound, model);
      this.db.exec('COMMIT');
      return id;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  settle(id: string, actual: number) {
    if (!Number.isFinite(actual) || actual < 0) throw Error('Invalid usage cost');
    const call = this.db.prepare('SELECT bound, actual FROM calls WHERE id=?').get(id) as
      { bound: number; actual: number | null } | undefined;
    if (!call || call.actual !== null) throw Error('Unknown or settled reservation');
    // A provider billing anomaly must not quietly create new budget.
    this.db.prepare('UPDATE calls SET actual=? WHERE id=?').run(actual, id);
    if (actual > call.bound)
      throw Error('Provider usage exceeded reserved budget bound; stop evaluation.');
  }
  close() {
    this.db.close();
  }
}
