import { useEffect, useState, type CSSProperties } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Download,
  GitBranch,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  SkipForward,
  Square,
  X,
} from 'lucide-react';
import { stages, type Run, type RunInput } from '../shared';
import { createBrowserRuntime } from './browser-store';
import '@fontsource/anton/latin-400.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import './site.css';
import Evidence from './Evidence';

const repo = 'https://github.com/riyadadlani02/relay-agent-os';
const scenarios: { title: string; code: string; detail: string; input: RunInput }[] = [
  {
    title: 'Autonomous run',
    code: 'A—01',
    detail: 'A $49 refund. Six services. No intervention.',
    input: {
      customer: 'Alex Morgan',
      issue: 'Please refund the duplicate $49 subscription charge.',
      scenario: 'refund',
      amountCents: 4900,
      faultOnce: false,
    },
  },
  {
    title: 'Human in the loop',
    code: 'B—02',
    detail: 'A $249 refund pauses for your approval.',
    input: {
      customer: 'Sam Rivera',
      issue: 'My annual plan renewed after cancellation. Please refund $249.',
      scenario: 'refund',
      amountCents: 24900,
      faultOnce: false,
    },
  },
  {
    title: 'The hard boundary',
    code: 'C—03',
    detail: 'A $750 request. The policy has the final say.',
    input: {
      customer: 'Jordan Lee',
      issue: 'Please refund the entire $750 enterprise invoice.',
      scenario: 'refund',
      amountCents: 75000,
      faultOnce: false,
    },
  },
  {
    title: 'A second chance',
    code: 'D—04',
    detail: 'One connector failure. One retry. One effect.',
    input: {
      customer: 'Taylor Brooks',
      issue: 'Please refund my duplicate $49 subscription charge.',
      scenario: 'refund',
      amountCents: 4900,
      faultOnce: true,
    },
  },
];
const agentDetails = [
  [
    'A signal becomes a mission.',
    'Typed customer context gives every run a clear starting point. No loose instructions wandering through your system.',
  ],
  [
    'Context before confidence.',
    'The knowledge service retrieves the applicable policy and attaches a source citation to the trace.',
  ],
  [
    'A plan, with boundaries.',
    'The resolution agent proposes a structured action. A plan is a proposal; permission comes next.',
  ],
  [
    'Your rules have the last word.',
    'Refund limits, capability checks, and human approval gates are enforced before an action can happen.',
  ],
  [
    'Do it once. Do it right.',
    'A run-scoped idempotency key keeps a connector retry from creating a duplicate sandbox effect.',
  ],
  [
    'An outcome you can inspect.',
    'The quality service checks the ledger before marking the mission complete. Every step leaves evidence.',
  ],
];
const statusLabel: Record<Run['status'], string> = {
  queued: 'IN THE QUEUE',
  running: 'MISSION IN MOTION',
  awaiting_approval: 'WAITING FOR YOU',
  completed: 'MISSION COMPLETE',
  failed: 'POLICY / RUNTIME STOP',
  cancelled: 'MISSION CANCELLED',
};
function Star({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 60" fill="currentColor" aria-hidden="true">
      <path d="M30 0C30 23 37 30 60 30C37 30 30 37 30 60C30 37 23 30 0 30C23 30 30 23 30 0Z" />
    </svg>
  );
}
function Mark() {
  return (
    <svg viewBox="0 0 60 34" fill="none" aria-hidden="true">
      <ellipse cx="20" cy="17" rx="10" ry="17" transform="rotate(43 20 17)" />
      <ellipse cx="40" cy="17" rx="10" ry="17" transform="rotate(43 40 17)" />
    </svg>
  );
}

export default function Site() {
  useEffect(() => {
    // The lazy entry renders after the browser's initial fragment lookup.
    const hash = location.hash;
    let active = true;
    void document.fonts.ready.then(() => {
      if (!active || !hash || location.hash !== hash) return;
      try {
        document
          .getElementById(decodeURIComponent(hash.slice(1)))
          ?.scrollIntoView({ behavior: 'instant' });
      } catch {
        /* Ignore malformed fragments. */
      }
    });
    return () => {
      active = false;
    };
  }, []);
  const [{ runtime, store }] = useState(createBrowserRuntime);
  const [snapshot, setSnapshot] = useState(() => ({
    runs: store.runs(),
    events: store.events(),
    effects: store.effects(),
    policy: store.policy(),
  }));
  const [scenario, setScenario] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [agent, setAgent] = useState(0);
  const [motion, setMotion] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const refresh = () =>
      setSnapshot({
        runs: store.runs(),
        events: store.events(),
        effects: store.effects(),
        policy: store.policy(),
      });
    const unsubscribe = store.subscribe(refresh);
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      runtime
        .tick()
        .catch(() =>
          setError('The runtime paused unexpectedly. Reload to recover your local session.'),
        )
        .finally(() => {
          busy = false;
        });
    }, 850);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [runtime, store]);
  const run = snapshot.runs.find((r) => r.id === selected) ?? snapshot.runs[0];
  const trace = run ? snapshot.events.filter((e) => e.runId === run.id) : [];
  const active = run && ['running', 'queued'].includes(run.status);
  const completed = snapshot.runs.filter((r) => r.status === 'completed').length;
  function launch(index = scenario) {
    try {
      if (snapshot.runs.filter((r) => ['running', 'queued'].includes(r.status)).length >= 4) {
        setError('Four missions are already in motion. Let one finish, then launch another.');
        return;
      }
      if (store.policy().paused) store.setPolicy({ ...store.policy(), paused: false });
      const mission = runtime.create(scenarios[index].input);
      setSelected(mission.id);
      setError('');
      setExpanded(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function boot() {
    location.href = `${import.meta.env.BASE_URL}?playground=1`;
  }
  function decide(decision: 'approved' | 'rejected') {
    if (!run) return;
    try {
      runtime.decide(run.id, decision);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download() {
    if (!run) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { run, events: trace, effects: snapshot.effects.filter((e) => e.runId === run.id) },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `relay-${run.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className={`relay-site ${motion ? 'motion-on' : 'motion-off'}`} id="top">
      <a className="site-skip" href="#console">
        Skip to interactive demo
      </a>
      <header className="site-header">
        <a href="#top" className="site-logo" aria-label="Relay OS home">
          <Mark />
          <span>
            RELAY<span>®</span>
          </span>
          <small>
            OPERATING
            <br />
            SYSTEM
          </small>
        </a>
        <nav aria-label="Site navigation">
          <a href="#evidence">EVIDENCE</a>
          <a href={`${import.meta.env.BASE_URL}?playground=1`}>PLAYGROUND</a>
          <a href="#film">WATCH FILM</a>
          <a href={repo} target="_blank" rel="noreferrer">
            GITHUB <ArrowUpRight size={14} />
          </a>
        </nav>
        <button className="header-boot" onClick={boot}>
          <span className="rec-dot" />
          BOOT SYSTEM <ArrowUpRight size={15} />
        </button>
      </header>
      <main className="site-main">
        <section className="proof-hero" aria-labelledby="hero-title">
          <div className="proof-copy">
            <p className="proof-kicker">Customer operations, with a permission boundary.</p>
            <h1 id="hero-title">
              Agents act.
              <br />
              You set the limits.
            </h1>
            <p className="proof-lead">
              Relay turns customer requests into refunds and replacements, with policy checks, human
              approval, and a receipt for every action.
            </p>
            <div className="proof-links">
              <button className="header-boot" onClick={boot}>
                Open live playground <ArrowUpRight size={17} />
              </button>
              <a href="#evidence">
                Read the measured results <ArrowDownRight size={17} />
              </a>
            </div>
            <p className="proof-note">
              Try the three outcomes below instantly. The live AI playground downloads a browser
              model on first use. Sample business data; no real money.
            </p>
          </div>
          <div className="proof-device">
            <img
              src={`${import.meta.env.BASE_URL}images/agent-core.png`}
              alt="Relay’s olive cassette-inspired agent core with twin silver reels"
              width="1254"
              height="1254"
              fetchPriority="high"
            />
            <span>A proposal is never permission.</span>
          </div>
          <div className="proof-outcomes" aria-label="Try a refund outcome">
            {[
              ['$49', 'Completes automatically', 'Eligible refund, verified receipt.'],
              ['$249', 'Waits for your approval', 'Nothing commits until you approve.'],
              ['$750', 'Blocked by policy', 'Even a human cannot override the limit.'],
            ].map(([amount, title, detail], index) => (
              <button
                key={amount}
                onClick={() => {
                  setScenario(index);
                  launch(index);
                  document.getElementById('console')?.scrollIntoView({ behavior: 'smooth' });
                }}
                aria-label={`Run ${amount} refund demo`}
              >
                <span className="proof-amount">{amount}</span>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <Play size={20} />
              </button>
            ))}
          </div>
          <div className="proof-foot">
            <span>Three deterministic walkthroughs · no model download</span>
            <button onClick={() => setMotion(!motion)} aria-pressed={motion}>
              {motion ? <Pause size={12} /> : <Play size={12} />} Motion {motion ? 'on' : 'off'}
            </button>
          </div>
        </section>
        <section id="console" className="console-section" aria-labelledby="console-title">
          <div className="section-index">
            <span>[ 02 — HANDS ON THE CONTROLS ]</span>
            <span>DETERMINISTIC WALKTHROUGH</span>
          </div>
          <div className="console-intro">
            <h2 id="console-title">
              DON’T JUST WATCH.
              <br />
              PRESS PLAY.
            </h2>
            <p>
              Explore the deterministic runtime, or{' '}
              <a href={`${import.meta.env.BASE_URL}?playground=1`}>open the live AI playground</a>.
              <br />
              Type your own requests. Inspect every tool call.
            </p>
            <div className="cassette-stamp">
              <Mark />
              <span>
                RELAY
                <br />
                DEMO TAPE VOL. 01
              </span>
            </div>
          </div>
          <div className="demo-deck">
            <div className="deck-top">
              <span>
                <span className="rec-dot" />
                RELAY / MISSION CONSOLE
              </span>
              <span>
                BROWSER SANDBOX <LockSymbol />
              </span>
              <div className="deck-screws">
                <span>⊕</span>
                <span>⊕</span>
              </div>
            </div>
            <div className="deck-grid">
              <div className="track-picker">
                <span className="deck-label">SELECT A TRACK</span>
                {scenarios.map((item, index) => (
                  <button
                    className={scenario === index ? 'selected' : ''}
                    key={item.code}
                    onClick={() => setScenario(index)}
                    aria-pressed={scenario === index}
                  >
                    <span>{item.code}</span>
                    <strong>{item.title}</strong>
                    <ArrowUpRight size={14} />
                    <small>{item.detail}</small>
                  </button>
                ))}
                <div className="track-note">
                  <ShieldCheck size={18} />
                  <span>
                    Real orchestration.
                    <br />
                    Simulated business actions.
                  </span>
                </div>
              </div>
              <div className="deck-display">
                <div className="lcd">
                  <div className="lcd-top">
                    <span>
                      <span className={`lcd-led ${active ? 'lit' : ''}`} />
                      {snapshot.policy.paused
                        ? 'RUNTIME PAUSED'
                        : run
                          ? statusLabel[run.status]
                          : 'READY FOR INPUT'}
                    </span>
                    <span>R—OS / 001</span>
                  </div>
                  <div className="lcd-main">
                    <div>
                      <span className="lcd-number">
                        {run ? String(Math.min(run.step, 6)).padStart(2, '0') : '00'}
                        <small>/06</small>
                      </span>
                      <p>{run ? run.customer : 'NO MISSION LOADED'}</p>
                    </div>
                    <div
                      className={`equalizer ${active && !snapshot.policy.paused ? 'playing' : ''}`}
                      aria-hidden="true"
                    >
                      {Array.from({ length: 22 }, (_, i) => (
                        <i
                          key={i}
                          style={
                            {
                              '--bar': `${((i * 7) % 17) + 5}%`,
                              '--delay': `${i * -0.07}s`,
                            } as CSSProperties
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <div className="lcd-stages">
                    {stages.map((stage, i) => (
                      <span
                        key={stage.name}
                        className={
                          run && run.step > i ? 'done' : run && run.step === i ? 'current' : ''
                        }
                      >
                        <i />
                        {stage.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="deck-transport">
                  <div className="transport-buttons">
                    <button
                      className="play-key"
                      onClick={() => launch()}
                      aria-label="Launch selected mission"
                    >
                      <Play size={18} fill="currentColor" />
                      PLAY
                    </button>
                    <button
                      onClick={() =>
                        store.setPolicy({ ...store.policy(), paused: !snapshot.policy.paused })
                      }
                      aria-label={
                        snapshot.policy.paused ? 'Resume demo runtime' : 'Pause demo runtime'
                      }
                      aria-pressed={snapshot.policy.paused}
                    >
                      {snapshot.policy.paused ? <Play size={17} /> : <Pause size={17} />}
                    </button>
                    <button
                      disabled={
                        !run ||
                        !['queued', 'running', 'awaiting_approval'].includes(run.status) ||
                        snapshot.effects.some((e) => e.runId === run.id)
                      }
                      onClick={() => {
                        if (run)
                          try {
                            runtime.cancel(run.id);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                      }}
                      aria-label="Stop selected mission"
                    >
                      <Square size={15} fill="currentColor" />
                    </button>
                    <button
                      onClick={() => setScenario((scenario + 1) % scenarios.length)}
                      aria-label="Select next scenario"
                    >
                      <SkipForward size={17} />
                    </button>
                  </div>
                  <span className="transport-note">
                    {scenarios[scenario].code}
                    <br />
                    {scenarios[scenario].title}
                  </span>
                </div>
                {error && (
                  <p className="demo-error" role="alert">
                    {error}
                  </p>
                )}
                {run?.status === 'awaiting_approval' && (
                  <div className="human-gate" role="status">
                    <div>
                      <ShieldCheck size={18} />
                      <strong>Your judgment. Your call.</strong>
                    </div>
                    <p>
                      This $249 refund is above the $100 automatic limit. No action has been
                      committed.
                    </p>
                    <button onClick={() => decide('rejected')}>
                      <X size={14} />
                      REJECT
                    </button>
                    <button className="approve-key" onClick={() => decide('approved')}>
                      <Check size={14} />
                      APPROVE $249
                    </button>
                  </div>
                )}
                {run?.outcome && (
                  <div className={`demo-outcome ${run.status}`} role="status">
                    <span>
                      {run.status === 'completed' ? <Check size={17} /> : <ShieldCheck size={17} />}
                    </span>
                    <p>{run.outcome}</p>
                  </div>
                )}
                <div className="trace-screen">
                  <div className="trace-title">
                    <span>THE SIGNAL PATH</span>
                    <span>{trace.length.toString().padStart(2, '0')} EVENTS</span>
                  </div>
                  {trace.length ? (
                    <ol aria-label="Execution events">
                      {(expanded ? trace : trace.slice(-4)).map((event) => (
                        <li key={event.id}>
                          <span>{String(event.id).padStart(2, '0')}</span>
                          <strong>{event.agent}</strong>
                          <p>{event.message}</p>
                          <Check size={12} />
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="trace-empty">
                      <span>_</span>
                      <p>
                        Your mission starts with a play.
                        <br />
                        Every decision will appear right here.
                      </p>
                    </div>
                  )}
                  <div className="trace-actions">
                    <button disabled={!trace.length} onClick={() => setExpanded(!expanded)}>
                      {expanded ? 'COLLAPSE TRACE' : 'INSPECT FULL TRACE'} <Plus size={12} />
                    </button>
                    <button disabled={!run} onClick={download}>
                      EXPORT <Download size={12} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="deck-bottom">
              <span>⊕</span>
              <span>
                <i />
                NO API KEY REQUIRED / NO REAL TRANSACTIONS
              </span>
              <span>⊕</span>
            </div>
          </div>
          <div className="session-row">
            <span>
              <i className="tiny-led" />
              {store.persistenceAvailable
                ? 'SESSION SAVED IN THIS BROWSER'
                : 'TEMPORARY SESSION — BROWSER STORAGE UNAVAILABLE'}
            </span>
            <span>
              {completed.toString().padStart(2, '0')} COMPLETED /{' '}
              {snapshot.effects.length.toString().padStart(2, '0')} SANDBOX EFFECTS
            </span>
            {snapshot.runs.length > 1 && (
              <label>
                PAST MISSIONS{' '}
                <select value={run?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
                  {snapshot.runs.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.customer} / {r.id.slice(-4)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>

        <Evidence />
        <section id="film" className="film-section" aria-labelledby="film-title">
          <div className="section-index">
            <span>[ PLAY / THE PRODUCT FILM ]</span>
            <span>01:15 · SOUND ON</span>
          </div>
          <div className="film-intro">
            <h2 id="film-title">SEE IT IN MOTION.</h2>
            <p>
              A request. An action. Your control. Watch Relay work through real model inference,
              human approval, and a hard policy boundary.
            </p>
          </div>
          <video
            controls
            playsInline
            preload="none"
            poster={`${import.meta.env.BASE_URL}media/relay-demo-poster.jpg`}
            aria-label="Relay OS product demo with English narration and open captions"
          >
            <source
              src={`${import.meta.env.BASE_URL}media/relay-demo.webm`}
              type='video/webm; codecs="vp9, opus"'
            />
            <source src={`${import.meta.env.BASE_URL}media/relay-demo.mp4`} type="video/mp4" />
            <track
              kind="captions"
              src={`${import.meta.env.BASE_URL}media/relay-demo.vtt`}
              srcLang="en"
              label="English"
            />
            <a href={`${import.meta.env.BASE_URL}media/relay-demo.mp4`}>Download the demo film</a>
          </video>
          <div className="film-meta">
            <span>REAL PLAYGROUND CAPTURES · EDITED FOR CLARITY · FICTIONAL BUSINESS DATA</span>
            <div>
              <a href={`${import.meta.env.BASE_URL}media/relay-demo-transcript.txt`}>
                Read transcript <ArrowUpRight size={14} />
              </a>
              <a href={`${import.meta.env.BASE_URL}media/relay-demo.mp4`} download>
                Download film <Download size={14} />
              </a>
            </div>
          </div>
        </section>

        <section id="system" className="system-section">
          <div className="section-index">
            <span>[ 01 — THE OPERATING LAYER ]</span>
            <span>NO MYSTERY. JUST MACHINERY.</span>
          </div>
          <div className="system-intro">
            <h2>
              BIG IDEAS.
              <br />
              CONNECTED MINDS.
            </h2>
            <div>
              <Star className="intro-star" />
              <p>Give your agents a world to work in.</p>
              <p>
                Relay turns a customer request into a coordinated mission. Six focused services.
                Clear boundaries. And a human hand on the controls whenever it matters.
              </p>
              <a href="#console">
                TAKE IT FOR A SPIN <ArrowDownRight size={20} />
              </a>
            </div>
          </div>
          <div className="agent-rack">
            {stages.map((stage, index) => (
              <button
                className={`agent-module ${index === agent ? 'engaged' : ''}`}
                key={stage.name}
                onClick={() => setAgent(index)}
                aria-pressed={index === agent}
              >
                <span className="module-number">
                  0{index + 1}
                  <Plus size={13} />
                </span>
                <span className="module-symbol" aria-hidden="true">
                  {index === 0
                    ? '↙'
                    : index === 1
                      ? '≋'
                      : index === 2
                        ? '✳'
                        : index === 3
                          ? '⌾'
                          : index === 4
                            ? '↯'
                            : '✓'}
                </span>
                <strong>{stage.name.toUpperCase()}</strong>
                <span className="module-type">{stage.agent.toUpperCase()} SERVICE</span>
                <span className="module-connector">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </button>
            ))}
          </div>
          <div className="agent-description" aria-live="polite">
            <span>
              CHANNEL 0{agent + 1} <span className="tiny-led" />
            </span>
            <h3>{agentDetails[agent][0]}</h3>
            <p>{agentDetails[agent][1]}</p>
            <code>{stages[agent].tool}</code>
          </div>
        </section>

        <section className="spec-section" id="specification">
          <div className="section-index">
            <span>[ 03 — UNDER THE SHELL ]</span>
            <span>OPEN IT UP. IT’S ALL THERE.</span>
          </div>
          <div className="spec-layout">
            <h2>
              NOTHING
              <br />
              TO HIDE.
            </h2>
            <div className="spec-table">
              {[
                ['EXECUTION', 'Resumable. Step by step.'],
                ['PERMISSIONS', 'A proposal is never permission.'],
                ['MEMORY', 'SQLite on the server. Local state in this demo.'],
                ['RELIABILITY', 'Retry safely. Verify the outcome.'],
                ['VISIBILITY', 'Every action leaves a trace.'],
                ['MODEL', 'Live Qwen inference in the playground. No API key.'],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <p>{value}</p>
                  <ArrowUpRight size={14} />
                </div>
              ))}
              <a href={`${repo}/blob/main/docs/architecture.md`} target="_blank" rel="noreferrer">
                READ THE ENGINEERING NOTES <ArrowRight size={17} />
              </a>
            </div>
          </div>
        </section>
        <section className="closing-section">
          <div>
            <Mark />
            <span>
              BUILD SOMETHING
              <br />
              WORTH SETTING FREE.
            </span>
          </div>
          <a href={repo} target="_blank" rel="noreferrer">
            GET THE SOURCE <GitBranch size={20} />
            <ArrowUpRight size={22} />
          </a>
        </section>
      </main>
      <footer className="site-footer">
        <a href="#top">
          RELAY OS <span>®</span>
        </a>
        <div>
          <span>INDEPENDENT PROJECT BY RIYA DADLANI</span>
          <span>DESIGNED TO BE EXPLORED. BUILT TO BE UNDERSTOOD.</span>
        </div>
        <a
          href="https://dribbble.com/shots/25961667-Retro-Futuristic-Website-Concept-for-a-Cassette-Player"
          target="_blank"
          rel="noreferrer"
        >
          DESIGN INSPIRATION <ArrowUpRight size={12} />
        </a>
        <button
          onClick={() => {
            document
              .getElementById('top')
              ?.scrollIntoView({ behavior: motion ? 'smooth' : 'instant' });
          }}
          aria-label="Back to top"
        >
          <ArrowUpRight size={20} />
        </button>
      </footer>
    </div>
  );
}
function LockSymbol() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="8" height="6" rx="1" />
      <path d="M4 5V3a2 2 0 0 1 4 0v2" />
    </svg>
  );
}
