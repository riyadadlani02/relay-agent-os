import { useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  FastForward,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Skull,
  X,
} from 'lucide-react';
import '@fontsource/anton/latin-400.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import './console.css';
import { dollars } from '../playground/domain';
import { verify, type JournalEntry } from './journal';
import { isLive } from './capability';
import type { StepRecord } from './kernel';
import { bootSupport, customers } from './support';

const repo = 'https://github.com/riyadadlani02/relay-agent-os';
const operator = { kind: 'operator' as const, id: 'ops' };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function KernelConsole() {
  const kernel = useRef(bootSupport());
  const [view, setView] = useState(() => kernel.current.snapshot());
  const [log, setLog] = useState<StepRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [tampered, setTampered] = useState<JournalEntry[]>();
  const [allCaps, setAllCaps] = useState(false);

  const refresh = () => setView(kernel.current.snapshot());
  async function step() {
    const record = await kernel.current.step();
    if (record) setLog((l) => [record, ...l].slice(0, 80));
    refresh();
    return record;
  }
  async function run() {
    setRunning(true);
    setError('');
    try {
      for (let i = 0; i < 200 && (await step()); i++)
        if (!reducedMotion()) await new Promise((r) => setTimeout(r, 90));
    } finally {
      setRunning(false);
    }
  }
  function act(action: () => void) {
    setError('');
    try {
      action();
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  }
  function reset() {
    kernel.current = bootSupport();
    setLog([]);
    setTampered(undefined);
    setError('');
    refresh();
  }
  const refundCommit = (entries: JournalEntry[]) =>
    entries.find(
      (e) =>
        e.type === 'syscall.commit' &&
        typeof (e.data as { value?: { amountCents?: unknown } }).value?.amountCents === 'number',
    );
  function tamper() {
    // Edits a copy for display; the kernel's own journal is untouched.
    const copy = structuredClone(view.journal);
    const target = refundCommit(copy);
    if (!target) return;
    (target.data as { value: { amountCents: number } }).value.amountCents = 1;
    setTampered(copy);
  }

  const journal = tampered ?? view.journal;
  const chain = verify(journal);
  const live = view.processes.filter((p) => p.state !== 'exited').length;
  const caps = view.capabilities.filter((c) => allCaps || c.holder.startsWith('process:'));
  const request = customers.map((c) => [c.id, c.request] as const);

  return (
    <div className="os-app">
      <header className="os-header">
        <a className="os-brand" href={import.meta.env.BASE_URL}>
          <ArrowLeft size={18} />
          <span>RELAY</span>
          <b>OS</b>
        </a>
        <span className="os-location">Kernel / Console</span>
        <nav aria-label="Console links">
          <a href={`${import.meta.env.BASE_URL}?playground=1`}>Live playground</a>
          <a href={`${repo}/blob/main/docs/kernel.md`} target="_blank" rel="noreferrer">
            Kernel design ↗
          </a>
        </nav>
      </header>
      <main>
        <section className="os-intro" aria-labelledby="os-title">
          <div>
            <p className="os-kicker">Agents are processes. Actions are syscalls.</p>
            <h1 id="os-title">A proposal is never permission.</h1>
          </div>
          <p>
            Four customers share one kernel. Each conversation runs as a process that holds only the
            capabilities it was handed. Every call passes the same gate: capability → policy → the
            owner&apos;s consent → operator approval → atomic commit → hash-chained journal.
            <strong>
              {' '}
              Programs here are scripted stand-ins for model output, so every decision is
              reproducible.
            </strong>{' '}
            Real inference runs in the{' '}
            <a href={`${import.meta.env.BASE_URL}?playground=1`}>playground</a>.
          </p>
        </section>

        <div className="os-controls" role="group" aria-label="Scheduler controls">
          <button onClick={() => void step()} disabled={running || !live}>
            <SkipForward size={16} /> Step
          </button>
          <button className="os-primary" onClick={() => void run()} disabled={running || !live}>
            <FastForward size={16} /> Run until a person is needed
          </button>
          <button onClick={reset} disabled={running}>
            <RotateCcw size={16} /> Reset
          </button>
          <span className="os-meter" aria-live="polite">
            tick {view.tick} · {live} live · {view.requests.length} waiting on people
          </span>
        </div>
        {error && (
          <p className="os-error" role="alert">
            {error}
          </p>
        )}

        <div className="os-grid">
          <section className="os-panel os-people" aria-labelledby="people-title">
            <h2 id="people-title">Waiting on people</h2>
            {!view.requests.length && (
              <p className="os-empty">
                {view.tick ? 'Nobody is being asked anything.' : 'Run the scheduler to begin.'}
              </p>
            )}
            {view.requests.map((r) => (
              <article key={r.id} className={`os-request os-${r.kind}`}>
                <header>
                  {r.kind === 'consent' ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
                  <b>{r.kind === 'consent' ? `${r.audience}: confirm?` : 'Operator: approve?'}</b>
                  <small>
                    pid {r.pid} · {r.id}
                  </small>
                </header>
                <p>{r.summary}</p>
                <small>
                  {r.kind === 'consent'
                    ? `Grants process ${r.pid} one use of ${r.call} on ${r.resource}, narrowed from ${r.audience}'s own authority.`
                    : r.reason}
                </small>
                <div className="os-actions">
                  <button
                    className="os-primary"
                    disabled={running}
                    onClick={() =>
                      act(() =>
                        kernel.current.decide(
                          r.id,
                          true,
                          r.kind === 'consent' ? { kind: 'user', id: r.audience } : operator,
                        ),
                      )
                    }
                  >
                    <Check size={15} />{' '}
                    {r.kind === 'consent' ? `Confirm as ${r.audience}` : 'Approve'}
                  </button>
                  <button
                    disabled={running}
                    onClick={() =>
                      act(() =>
                        kernel.current.decide(
                          r.id,
                          false,
                          r.kind === 'consent' ? { kind: 'user', id: r.audience } : operator,
                        ),
                      )
                    }
                  >
                    <X size={15} /> {r.kind === 'consent' ? 'Decline' : 'Reject'}
                  </button>
                </div>
              </article>
            ))}
            <details className="os-requests-text">
              <summary>What each customer typed</summary>
              <dl>
                {request.map(([id, text]) => (
                  <div key={id}>
                    <dt>{id}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </section>

          <section className="os-panel os-ps" aria-labelledby="ps-title">
            <h2 id="ps-title">Process table</h2>
            <div className="os-scroll" tabIndex={0} aria-label="Process table, scrollable">
              <table>
                <thead>
                  <tr>
                    <th>PID</th>
                    <th>PPID</th>
                    <th>Name</th>
                    <th>State</th>
                    <th>Steps left</th>
                    <th>Tokens left</th>
                    <th>
                      <span className="os-sr">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.processes.map((p) => (
                    <tr key={p.pid} className={`os-state-${p.state}`}>
                      <td>{p.pid}</td>
                      <td>{p.ppid ?? '—'}</td>
                      <td>{p.name}</td>
                      <td>
                        {p.state === 'blocked'
                          ? `waiting: ${p.waiting?.on}`
                          : p.state === 'exited'
                            ? `exited: ${p.exit?.status}`
                            : 'ready'}
                      </td>
                      <td>{p.budget.steps}</td>
                      <td>{p.budget.tokens}</td>
                      <td>
                        {p.state !== 'exited' && (
                          <button
                            className="os-icon"
                            aria-label={`Kill process ${p.pid} as operator`}
                            title="Kill as operator"
                            disabled={running}
                            onClick={() => act(() => kernel.current.kill(p.pid, operator))}
                          >
                            <Skull size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Scheduler</h3>
            <ol className="os-log" tabIndex={0} aria-label="Most recent scheduling decisions">
              {!log.length && <li className="os-empty">No steps yet.</li>}
              {log.map((r) => (
                <li key={r.tick} className={r.result === 'ok' ? '' : 'os-flag'}>
                  <span>
                    t{r.tick} · pid {r.pid}
                  </span>
                  <code>{r.proposal}</code>
                  <b>{r.result}</b>
                  {r.note && <small>{r.note}</small>}
                </li>
              ))}
            </ol>
          </section>

          <section className="os-panel os-caps" aria-labelledby="caps-title">
            <div className="os-panel-head">
              <h2 id="caps-title">Capabilities</h2>
              <label>
                <input
                  type="checkbox"
                  checked={allCaps}
                  onChange={(e) => setAllCaps(e.target.checked)}
                />{' '}
                include people&apos;s standing authority
              </label>
            </div>
            <div className="os-scroll" tabIndex={0} aria-label="Capability table, scrollable">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Holder</th>
                    <th>Rights</th>
                    <th>Resource</th>
                    <th>From</th>
                    <th>Uses</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {caps.map((c) => {
                    const status = c.revoked
                      ? 'revoked'
                      : isLive(view.capabilities, c, view.tick)
                        ? 'live'
                        : 'spent';
                    return (
                      <tr key={c.id} className={`os-cap-${status}`}>
                        <td>{c.id}</td>
                        <td>{c.holder}</td>
                        <td>{c.rights.join(', ')}</td>
                        <td>{c.resource}</td>
                        <td>{c.parent ?? `${c.issuer.kind}:${c.issuer.id}`}</td>
                        <td>{c.uses ?? '∞'}</td>
                        <td>{status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="os-panel os-journal" aria-labelledby="journal-title">
            <div className="os-panel-head">
              <h2 id="journal-title">Journal</h2>
              <span className={chain.ok ? 'os-ok' : 'os-bad'} role="status">
                {chain.ok
                  ? `chain verified · head ${chain.head.slice(0, 10)}`
                  : `broken at #${chain.index}: ${chain.reason}`}
              </span>
            </div>
            <div className="os-actions">
              {tampered ? (
                <button onClick={() => setTampered(undefined)}>
                  <RotateCcw size={15} /> Restore the real journal
                </button>
              ) : (
                <button onClick={tamper} disabled={!refundCommit(view.journal)}>
                  <ShieldAlert size={15} /> Change a refund in the log to $0.01
                </button>
              )}
            </div>
            <ol className="os-entries" tabIndex={0} aria-label="Journal entries, newest first">
              {[...journal]
                .reverse()
                .slice(0, 60)
                .map((e) => (
                  <li
                    key={e.seq}
                    className={!chain.ok && e.seq >= chain.index ? 'os-flag' : undefined}
                  >
                    <span>#{e.seq}</span>
                    <b>{e.type}</b>
                    <span>{e.pid === null ? 'kernel' : `pid ${e.pid}`}</span>
                    <code>{e.hash.slice(0, 12)}</code>
                  </li>
                ))}
            </ol>
          </section>

          <section className="os-panel os-world" aria-labelledby="world-title">
            <h2 id="world-title">World state</h2>
            <ul className="os-orders">
              {view.world.orders.map((o) => (
                <li key={o.id}>
                  <b>{o.id}</b> {o.product} · {dollars(o.amountCents)} · {o.customer}
                  <span className={o.refunded ? 'os-ok' : undefined}>
                    {o.refunded ? 'refunded' : 'unchanged'}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              {view.world.receipts.length} receipts · {view.world.tickets.length} support tickets.
              Sample records in memory; no payment is made.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
