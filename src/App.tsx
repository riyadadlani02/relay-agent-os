import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  CirclePause,
  GitBranch,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { type Snapshot } from './shared';
import { api } from './lib';
import { Avatar, Empty, Modal } from './components/ui';
import { Overview } from './components/Overview';
import { MissionLog, NewMission, RunDetail } from './components/Missions';
import { Agents, ApprovalCard, KnowledgeView, PolicyView } from './components/Workspace';

export type Page = 'Overview' | 'Mission log' | 'Agents' | 'Approvals' | 'Knowledge' | 'Policies';
const nav: { page: Page; icon: LucideIcon }[] = [
  { page: 'Overview', icon: LayoutGrid },
  { page: 'Mission log', icon: Workflow },
  { page: 'Agents', icon: Bot },
  { page: 'Approvals', icon: ShieldCheck },
  { page: 'Knowledge', icon: BookOpen },
  { page: 'Policies', icon: LockKeyhole },
];
export default function App() {
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>('Overview');
  const [newMission, setNewMission] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [about, setAbout] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setState(await api<Snapshot>('/state'));
      setError('');
    } catch {
      setError('Connection interrupted. Your last snapshot is shown. Reconnecting…');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const pending =
    state?.runs
      .filter((r) => r.status === 'awaiting_approval')
      .sort((a, b) => b.amountCents - a.amountCents) ?? [];
  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(true);
    try {
      await api(`/runs/${id}/decision`, { decision });
      await refresh();
      setNotice(
        decision === 'approved'
          ? 'Approved. The mission will resume.'
          : 'Action rejected. Mission cancelled.',
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function togglePause() {
    if (!state) return;
    setBusy(true);
    try {
      await api('/policy', { ...state.policy, paused: !state.policy.paused }, 'PUT');
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const navigate = (next: Page) => {
    setPage(next);
    setSearchOpen(false);
    setSearch('');
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('Overview')} aria-label="Relay OS home">
          <img src="/favicon.svg" alt="" />
          <span>
            relay<span className="brand-os">OS</span>
          </span>
        </button>
        <div className="workspace">
          <span className="workspace-mark">
            <Network size={16} />
          </span>
          <div>
            <strong>Acme workspace</strong>
            <small>Customer operations</small>
          </div>
          <span className="workspace-dots">
            <MoreHorizontal size={17} />
          </span>
        </div>
        <div className="nav-label">Workspace</div>
        <nav>
          {nav.map(({ page: item, icon: Icon }) => (
            <button
              key={item}
              onClick={() => setPage(item)}
              className={`nav-item ${page === item ? 'active' : ''}`}
              aria-current={page === item ? 'page' : undefined}
              aria-label={item}
            >
              <Icon size={18} />
              <span>{item}</span>
              {item === 'Approvals' && pending.length > 0 && (
                <b className="nav-badge">{pending.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sandbox-card">
            <span>
              <span className="live-dot" />
              Sandbox workspace
            </span>
            <p>
              Real orchestration.
              <br />
              Safe, simulated actions.
            </p>
            <button onClick={() => setAbout(true)}>
              How it works <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="help-link" onClick={() => setAbout(true)}>
            <CircleHelp size={17} />
            Quick guide <span>?</span>
          </button>
          <div className="profile">
            <Avatar name="Riya Dadlani" small />
            <div>
              <strong>Workspace operator</strong>
              <small>Local demo</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="search-trigger"
              aria-label="Search workspace"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} />
              <span>Search anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <span className={`connection ${error ? 'offline' : ''}`}>
              <i />
              {error ? 'Reconnecting' : 'System online'}
            </span>
            <button
              className="operator-avatar"
              onClick={() => setAbout(true)}
              aria-label="Workspace information"
            >
              RD
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {!state ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              <p>Connecting to your workspace…</p>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="page-context">
                    {page === 'Overview'
                      ? 'Mission control'
                      : page === 'Mission log'
                        ? 'Execution history'
                        : page === 'Agents'
                          ? 'Your operating layer'
                          : page === 'Approvals'
                            ? 'Human in the loop'
                            : page === 'Knowledge'
                              ? 'Grounded in your business'
                              : 'Built-in boundaries'}
                  </div>
                  <h1>{page === 'Overview' ? 'Your agents. In sync.' : page}</h1>
                  <p>
                    {page === 'Overview'
                      ? 'A clear view of every agent, every action, every outcome.'
                      : page === 'Mission log'
                        ? 'Follow every mission from the first request to its final outcome.'
                        : page === 'Agents'
                          ? 'Six focused services. One coordinated workflow.'
                          : page === 'Approvals'
                            ? 'Give your agents the judgment that only you can provide.'
                            : page === 'Knowledge'
                              ? 'The policies your agents retrieve before they act.'
                              : 'Set the rules your agents follow on every mission.'}
                  </p>
                </div>
                <div className="heading-actions">
                  {page === 'Overview' && (
                    <button
                      className="button secondary compact"
                      disabled={busy}
                      onClick={togglePause}
                    >
                      {state.policy.paused ? <Play size={15} /> : <Pause size={15} />}{' '}
                      {state.policy.paused ? 'Resume' : 'Pause'} runtime
                    </button>
                  )}
                  <button className="button primary" onClick={() => setNewMission(true)}>
                    <Plus size={17} />
                    New mission
                  </button>
                </div>
              </div>
              {state.policy.paused && (
                <div className="pause-banner">
                  <CirclePause size={17} />
                  Runtime paused. Queued missions will wait until you resume it.
                </div>
              )}
              {page === 'Overview' && (
                <Overview
                  state={state}
                  pending={pending}
                  onSelect={setSelected}
                  onNavigate={navigate}
                  onNew={() => setNewMission(true)}
                />
              )}
              {page === 'Mission log' && <MissionLog runs={state.runs} onSelect={setSelected} />}
              {page === 'Agents' && <Agents state={state} />}
              {page === 'Approvals' && (
                <div className="approval-list">
                  {pending.length ? (
                    pending.map((run) => (
                      <ApprovalCard
                        key={run.id}
                        run={run}
                        onSelect={() => setSelected(run.id)}
                        onDecide={(decision) => void decide(run.id, decision)}
                        busy={busy}
                      />
                    ))
                  ) : (
                    <Empty
                      title="You're all caught up"
                      description="Missions that need your judgment will appear here."
                    />
                  )}
                </div>
              )}
              {page === 'Knowledge' && <KnowledgeView articles={state.knowledge} />}
              {page === 'Policies' && (
                <PolicyView
                  policy={state.policy}
                  onSaved={async () => {
                    await refresh();
                    setNotice('Workspace policy saved.');
                  }}
                />
              )}
              <footer className="footer">
                <span>
                  <GitBranch size={13} />
                  Relay OS <span className="version">v0.1</span>
                </span>
                <span>Sandbox data · {state.provider}</span>
                <span>Every action, accounted for.</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button onClick={() => setNotice('')} aria-label="Dismiss notification">
            <X size={15} />
          </button>
        </div>
      )}
      {newMission && (
        <NewMission
          onClose={() => setNewMission(false)}
          onCreated={async (run) => {
            setNewMission(false);
            setSelected(run.id);
            await refresh();
            setNotice('Mission launched. Follow its progress in the trace.');
          }}
        />
      )}
      {selected && (
        <RunDetail
          id={selected}
          onClose={() => setSelected(undefined)}
          onRefresh={refresh}
          onDecide={decide}
          busy={busy}
        />
      )}
      {searchOpen && (
        <Modal title="Find your way" onClose={() => setSearchOpen(false)}>
          <div className="command-search">
            <Search size={20} />
            <input
              autoFocus
              aria-label="Search pages or missions"
              placeholder="Search pages, customers, or missions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="command-results">
            {nav
              .filter((n) => n.page.toLowerCase().includes(search.toLowerCase()))
              .map((n) => (
                <button key={n.page} onClick={() => navigate(n.page)}>
                  <n.icon size={18} />
                  {n.page}
                  <ChevronRight size={15} />
                </button>
              ))}
            {state?.runs
              .filter((r) =>
                (r.customer + ' ' + r.id + ' ' + r.issue)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .slice(0, 6)
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelected(r.id);
                    setSearchOpen(false);
                  }}
                >
                  <Avatar name={r.customer} small />
                  <span>
                    {r.customer}
                    <small>{r.issue.slice(0, 65)}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
          </div>
        </Modal>
      )}
      {about && (
        <Modal title="A small OS for meaningful work" onClose={() => setAbout(false)}>
          <div className="about-content">
            <div className="about-icon">
              <Network size={32} />
            </div>
            <p>
              Relay turns a customer request into a durable, observable workflow. Each mission
              passes through intake, retrieval, planning, policy, execution, and verification.
            </p>
            <ol>
              <li>
                <strong>Launch a mission.</strong> Try a $49 refund for a fully automatic run.
              </li>
              <li>
                <strong>Review an action.</strong> A $249 refund pauses until you approve it.
              </li>
              <li>
                <strong>Test resilience.</strong> Enable a connector failure to see an idempotent
                retry.
              </li>
            </ol>
            <div className="info-box">
              All customer records and business actions are simulated. Runs, approval decisions,
              policy enforcement, and audit events are persisted in SQLite. The default planner is
              deterministic; you can configure a model provider on the server.
            </div>
            <p className="muted">
              Built as an independent engineering portfolio project. No affiliation with Wonderful.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
