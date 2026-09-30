import { sha256 } from './sha256';

// Append-only audit log. Each entry commits to its predecessor's hash, so editing, deleting or
// reordering any earlier entry breaks every later link. This makes tampering evident; it does not
// stop someone who can rewrite the whole chain. Anchoring the head externally is future work.
export interface JournalEntry {
  seq: number;
  tick: number;
  pid: number | null;
  type: string;
  data: unknown;
  prev: string;
  hash: string;
}
export const GENESIS = '0'.repeat(64);

/** JSON with sorted object keys, so equal values always hash equally. */
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

const digest = (e: Omit<JournalEntry, 'hash'>) =>
  sha256(e.prev + canonical({ seq: e.seq, tick: e.tick, pid: e.pid, type: e.type, data: e.data }));

export function append(
  journal: JournalEntry[],
  entry: { tick: number; pid: number | null; type: string; data: unknown },
): JournalEntry {
  const prev = journal.at(-1)?.hash ?? GENESIS;
  // Snapshot the data so later mutation of a live object cannot silently rewrite history.
  const body = {
    seq: journal.length,
    tick: entry.tick,
    pid: entry.pid,
    type: entry.type,
    data: JSON.parse(canonical(entry.data)) as unknown,
    prev,
  };
  const next = { ...body, hash: digest(body) };
  journal.push(next);
  return next;
}

export type Verification =
  { ok: true; head: string } | { ok: false; index: number; reason: string };

export function verify(journal: JournalEntry[]): Verification {
  let prev = GENESIS;
  for (const [index, entry] of journal.entries()) {
    if (entry.seq !== index) return { ok: false, index, reason: 'Sequence gap or reordering.' };
    if (entry.prev !== prev) return { ok: false, index, reason: 'Broken link to previous entry.' };
    if (digest(entry) !== entry.hash)
      return { ok: false, index, reason: 'Entry contents do not match their hash.' };
    prev = entry.hash;
  }
  return { ok: true, head: prev };
}
