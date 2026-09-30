import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  Cpu,
  FastForward,
  Pause,
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
import { BrowserModel, ServerModel } from '../playground/model';
import type { AgentModel } from './agent';
import { verify, type JournalEntry } from './journal';
import { isLive } from './capability';
import type { StepRecord } from './kernel';
import {
  bootLive,
  bootSupport,
  customers,
  runWorkflow,
  startConversation,
  supportWorkflows,
} from './support';
import type { RunnerMemory, StepStatus } from './workflow';

const repo = 'https://github.com/riyadadlani02/relay-agent-os';
const operator = { kind: 'operator' as const, id: 'ops' };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

type Mode = 'scripted' | 'live';
const stepMark: Record<StepStatus, string> = {
  pending: '·',
  running: '…',
  done: '✓',
  failed: '✗',
  skipped: '–',
};
const answerOf = (value: unknown) =>
  typeof (value as { result?: unknown } | undefined)?.result === 'string'
    ? (value as { result: string }).result
    : JSON.stringify(value ?? null);

export default function KernelConsole() {
  const agentModel = useRef<AgentModel | undefined>(undefined);
  const browserModel = useRef<BrowserModel | undefined>(undefined);
  const constrainRef = useRef(true);
  const bootMode = (mode: Mode) =>
    mode === 'scripted'
      ? bootSupport()
      : bootLive({ model: () => agentModel.current, constrain: () => constrainRef.current });
  const kernel = useRef<ReturnType<typeof bootSupport>>(bootSupport());
  const [mode, setMode] = useState<Mode>('scripted');
  const [view, setView] = useState(() => kernel.current.snapshot());
  const [log, setLog] = useState<StepRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [tampered, setTampered] = useState<JournalEntry[]>();
  const [allCaps, setAllCaps] = useState(false);
  const [thinking, setThinking] = useState('');
  const stopRequested = useRef(false);
  const [engine, setEngine] = useState<{ name?: string; loading?: boolean; progress?: string }>({});
  const [serverName, setServerName] = useState<string>();
  const [customer, setCustomer] = useState(customers[0].id);
  const [message, setMessage] = useState(customers[0].request);
  const [constrain, setConstrain] = useState(true);
  const [flow, setFlow] = useState('concierge');
  const workflow = supportWorkflows.find((w) => w.id === flow);

  useEffect(() => {
    if (import.meta.env.MODE === 'pages') return;
    let active = true;
    fetch('/api/live/config')
      .then((r) => r.json())
      .then((data) => active && data.enabled && setServerName(data.model))
      .catch(() => undefined);
    return () => {
      active = false;
      browserModel.current?.dispose();
    };
  }, []);

  const refresh = () => setView(kernel.current.snapshot());
  async function step() {
    const next = kernel.current.peek();
    if (mode === 'live' && next)
      setThinking(`${next.name} (pid ${next.pid}) is proposing its next call…`);
    try {
      const record = await kernel.current.step();
      if (record) setLog((l) => [record, ...l].slice(0, 80));
      return record;
    } finally {
      setThinking('');
      refresh();
    }
  }
  async function run() {
    setRunning(true);
    setError('');
    stopRequested.current = false;
    try {
      for (let i = 0; i < 200 && !stopRequested.current && (await step()); i++)
        if (mode === 'scripted' && !reducedMotion()) await new Promise((r) => setTimeout(r, 90));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  function switchMode(next: Mode) {
    if (next === mode) return;
    kernel.current = bootMode(next);
    setMode(next);
    setLog([]);
    setTampered(undefined);
    setError('');
    refresh();
  }
  async function loadEngine(useServer: boolean) {
    setError('');
    try {
      if (useServer && serverName) {
        agentModel.current = new ServerModel(serverName);
        setEngine({ name: serverName });
        return;
      }
      browserModel.current?.dispose();
      const model = new BrowserModel();
      browserModel.current = model;
      setEngine({ loading: true, progress: 'Starting…' });
      await model.load((fraction, text) =>
        setEngine({ loading: true, progress: `${Math.round(fraction * 100)}% · ${text}` }),
      );
      agentModel.current = model;
      setEngine({ name: model.name });
    } catch (e) {
      setEngine({});
      setError((e as Error).message);
    }
  }
  function start() {
    act(() =>
      workflow
        ? runWorkflow(kernel.current, workflow.id, customer, message)
        : startConversation(kernel.current, customer, message),
    );
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
    kernel.current = bootMode(mode);
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
  const conversations = view.processes.filter((p) => p.ppid === null);

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
          {mode === 'scripted' ? (
            <p>
              Four customers share one kernel. Each conversation runs as a process that holds only
              the capabilities it was handed. Every call passes the same gate: capability → policy →
              the owner&apos;s consent → operator approval → atomic commit → hash-chained journal.
              <strong>
                {' '}
                In this scenario, scripted programs stand in for model output, so every decision is
                reproducible.
              </strong>{' '}
              Switch to <em>Live AI agents</em> to run real language models on the same kernel.
            </p>
          ) : (
            <p>
              Real language-model agents run as processes. Each quantum the model sees its task, its
              own capabilities and every earlier outcome, and proposes one syscall as JSON. A
              concierge agent can start a refund agent and delegate narrowed authority to it. The
              kernel checks every proposal:{' '}
              <strong>what the model says is never what happens by itself.</strong> Customers and
              the operator answer the prompts below.
            </p>
          )}
        </section>

        <div className="os-controls" role="group" aria-label="Scheduler controls">
          <div className="os-modes" role="group" aria-label="Programs">
            {(['scripted', 'live'] as const).map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                className={mode === m ? 'os-primary' : undefined}
                disabled={running}
                onClick={() => switchMode(m)}
              >
                {m === 'scripted' ? 'Scripted scenario' : 'Live AI agents'}
              </button>
            ))}
          </div>
          <button onClick={() => void step()} disabled={running || !live}>
            <SkipForward size={16} /> Step
          </button>
          <button className="os-primary" onClick={() => void run()} disabled={running || !live}>
            <FastForward size={16} /> Run until a person is needed
          </button>
          {running && mode === 'live' ? (
            <button onClick={() => (stopRequested.current = true)}>
              <Pause size={16} /> Pause after this step
            </button>
          ) : (
            <button onClick={reset} disabled={running}>
              <RotateCcw size={16} /> Reset
            </button>
          )}
          <span className="os-meter" aria-live="polite">
            tick {view.tick} · {live} live · {view.requests.length} waiting on people
          </span>
        </div>
        {error && (
          <p className="os-error" role="alert">
            {error}
          </p>
        )}

        {mode === 'live' && (
          <section className="os-panel os-live" aria-labelledby="live-title">
            <div className="os-live-grid">
              <div>
                <h2 id="live-title">Start a conversation</h2>
                <p className="os-engine" role="status">
                  <Cpu size={16} />{' '}
                  {engine.name
                    ? `Model: ${engine.name}`
                    : engine.loading
                      ? `Loading model · ${engine.progress}`
                      : 'No model loaded.'}
                </p>
                {!engine.name && (
                  <div className="os-actions">
                    <button
                      className="os-primary"
                      disabled={engine.loading}
                      onClick={() => void loadEngine(false)}
                    >
                      <Bot size={15} /> Load browser model (Qwen 2.5 1.5B, ~830 MB, WebGPU)
                    </button>
                    {serverName && (
                      <button disabled={engine.loading} onClick={() => void loadEngine(true)}>
                        Use local server model ({serverName})
                      </button>
                    )}
                  </div>
                )}
                <div className="os-form">
                  <label>
                    Customer
                    <select
                      value={customer}
                      disabled={running}
                      onChange={(e) => {
                        setCustomer(e.target.value);
                        setMessage(customers.find((c) => c.id === e.target.value)!.request);
                      }}
                    >
                      {customers.map((c) => {
                        const order = view.world.orders.find((o) => o.id === c.orderId)!;
                        return (
                          <option key={c.id} value={c.id}>
                            {c.id} · owns {order.id}, {order.product}, {dollars(order.amountCents)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    Agents
                    <select
                      value={flow}
                      disabled={running}
                      onChange={(e) => setFlow(e.target.value)}
                    >
                      <option value="concierge">One concierge agent that decides for itself</option>
                      {supportWorkflows.map((w) => (
                        <option key={w.id} value={w.id}>
                          Workflow: {w.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {workflow && (
                    <div className="os-flow">
                      <p>{workflow.summary}</p>
                      <ol>
                        {workflow.steps.map((step) => (
                          <li key={step.id}>
                            <b>{step.title}</b> <span>({step.program})</span>
                            {step.after?.length ? (
                              <small>
                                after{' '}
                                {step.after
                                  .map((d) => workflow.steps.find((x) => x.id === d)!.title)
                                  .join(' + ')}
                              </small>
                            ) : (
                              <small>starts immediately</small>
                            )}
                            <small>
                              holds:{' '}
                              {step.grants.length
                                ? step.grants
                                    .map(
                                      (g) =>
                                        `${g.rights.join(', ')} on ${g.resource.replace('{orderId}', 'the order')}${g.uses ? ` (${g.uses} use)` : ''}`,
                                    )
                                    .join('; ')
                                : 'nothing'}
                              {step.escalate?.length
                                ? ` · may ask the customer to confirm ${step.escalate.join(', ')}`
                                : ' · may not ask anyone'}
                            </small>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <label>
                    Message
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={message}
                      disabled={running}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  <label className="os-check">
                    <input
                      type="checkbox"
                      checked={constrain}
                      disabled={running}
                      onChange={(e) => {
                        setConstrain(e.target.checked);
                        constrainRef.current = e.target.checked;
                      }}
                    />{' '}
                    Offer the model only calls and orders it holds capabilities for. Turn off to let
                    it propose anything and watch the kernel refuse.
                  </label>
                  <div className="os-actions">
                    <button
                      className="os-primary"
                      disabled={!engine.name || running || !message.trim()}
                      onClick={start}
                    >
                      <Bot size={15} />{' '}
                      {workflow ? `Start workflow for ${customer}` : `Start ${customer}'s agent`}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <h2>Conversations</h2>
                {thinking && (
                  <p className="os-thinking" role="status">
                    {thinking}
                  </p>
                )}
                {!conversations.length && (
                  <p className="os-empty">
                    Start an agent, then run the scheduler. Model output is shown as proposed; the
                    kernel&apos;s decision is shown next to it.
                  </p>
                )}
                <ul className="os-conversations">
                  {conversations.map((p) => (
                    <li key={p.pid}>
                      <b>
                        {p.owner} · pid {p.pid}
                        {p.program === 'workflow' && ` · ${(p.memory as RunnerMemory).title}`}
                      </b>
                      {p.program === 'workflow' && (
                        <span className="os-steps" aria-label="Workflow steps">
                          {(p.memory as RunnerMemory).states.map((st) => (
                            <span key={st.id} className={`os-step os-step-${st.status}`}>
                              {stepMark[st.status]} {st.title}
                              {st.pid ? ` · pid ${st.pid}` : ''}
                            </span>
                          ))}
                        </span>
                      )}
                      <span>
                        {p.state === 'exited'
                          ? p.exit?.status === 'ok'
                            ? answerOf(p.exit.value)
                            : `Stopped: ${p.exit?.status}. ${p.exit?.reason ?? ''}`
                          : p.state === 'blocked'
                            ? p.waiting?.on === 'message'
                              ? 'Waiting for its child agent'
                              : `Waiting for ${p.waiting?.on}`
                            : 'Working'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        <div className="os-grid">
          <section className="os-panel os-people" aria-labelledby="people-title">
            <h2 id="people-title">Waiting on people</h2>
            {!view.requests.length && (
              <p className="os-empty">
                {view.tick
                  ? 'Nobody is being asked anything.'
                  : mode === 'live'
                    ? 'Prompts for customers and the operator appear here.'
                    : 'Run the scheduler to begin.'}
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
            {mode === 'scripted' && (
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
            )}
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
                        {p.exit?.reason && p.exit.status !== 'ok' && (
                          <small className="os-reason">{p.exit.reason}</small>
                        )}
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
                  {r.note && (
                    <small>
                      {mode === 'scripted'
                        ? r.note
                        : view.processes.find((p) => p.pid === r.pid)?.program === 'workflow'
                          ? `Runner: ${r.note}`
                          : `Model's note: ${r.note}`}
                    </small>
                  )}
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
