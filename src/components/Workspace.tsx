import { stageIcons } from './ui';
import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Network,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { stages, type Knowledge, type Policy, type Run, type Snapshot } from '../shared';
import { Status, Avatar } from './ui';
import { money, relative, api } from '../lib';

export function Agents({ state }: { state: Snapshot }) {
  const descriptions = [
    'Turns incoming requests into a typed mission with customer context.',
    'Retrieves the applicable policy with a traceable source citation.',
    'Proposes a structured action and a customer response.',
    'Enforces allowed actions, refund limits, and approval requirements.',
    'Commits an idempotent action to the sandbox business ledger.',
    'Checks the recorded effect before marking a mission complete.',
  ];
  return (
    <>
      <div className="info-strip">
        <Network size={19} />
        <span>
          Agents are focused runtime services. The resolution agent uses{' '}
          <strong>{state.provider}</strong>.
        </span>
      </div>
      <div className="agents-grid">
        {stages.map((stage, index) => {
          const Icon = stageIcons[index];
          const working = state.runs.filter(
            (r) => r.step === index && ['running', 'queued'].includes(r.status),
          ).length;
          return (
            <article className="panel agent-card" key={stage.name}>
              <div className="agent-top">
                <span className={`node-icon color-${index}`}>
                  <Icon size={23} />
                </span>
                <span className="agent-state">
                  <i />
                  {working ? `${working} active` : 'Ready'}
                </span>
              </div>
              <h2>{stage.agent} agent</h2>
              <p>{descriptions[index]}</p>
              <div className="agent-tool">
                <Terminal size={14} />
                <code>{stage.tool}</code>
              </div>
              <div className="agent-bottom">
                <span>
                  {index === 2
                    ? 'Validated model output'
                    : index === 4
                      ? 'Idempotent write'
                      : 'Deterministic service'}
                </span>
                <ShieldCheck size={15} />
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function ApprovalCard({
  run,
  onSelect,
  onDecide,
  busy,
}: {
  run: Run;
  onSelect: () => void;
  onDecide: (d: 'approved' | 'rejected') => void;
  busy: boolean;
}) {
  return (
    <article className="panel approval-card">
      <div className="approval-top">
        <Avatar name={run.customer} />
        <div>
          <h2>{run.customer}</h2>
          <small>
            {run.id} · {relative(run.createdAt)}
          </small>
        </div>
        <Status status={run.status} />
      </div>
      <h3>
        {run.plan?.action === 'refund'
          ? `Issue ${money(run.amountCents)} refund`
          : 'Create replacement shipment'}
      </h3>
      <p>{run.issue}</p>
      <div className="info-box">
        <ShieldCheck size={18} />
        <span>{run.plan?.reason}</span>
      </div>
      <div className="approval-actions">
        <button className="text-button" onClick={onSelect}>
          Inspect full trace <ArrowUpRight size={15} />
        </button>
        <button className="button secondary" disabled={busy} onClick={() => onDecide('rejected')}>
          Reject
        </button>
        <button className="button primary" disabled={busy} onClick={() => onDecide('approved')}>
          <Check size={16} />
          Approve action
        </button>
      </div>
    </article>
  );
}

export function KnowledgeView({ articles }: { articles: Knowledge[] }) {
  const [query, setQuery] = useState('');
  return (
    <div className="knowledge-layout">
      <label className="inline-search knowledge-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your knowledge base…"
          aria-label="Search knowledge"
        />
      </label>
      {articles
        .filter((a) => (a.title + a.body).toLowerCase().includes(query.toLowerCase()))
        .map((article) => (
          <article className="panel knowledge-card" key={article.id}>
            <span className="knowledge-icon">
              <FileText size={23} />
            </span>
            <div>
              <span className="knowledge-meta">
                {article.id} <span>{article.tag}</span>
              </span>
              <h2>{article.title}</h2>
              <p>{article.body}</p>
              <span className="verified">
                <CheckCheck size={14} />
                Bundled reference policy
              </span>
            </div>
          </article>
        ))}
      <p className="muted knowledge-note">
        These bundled articles provide planning context. The active settings in Policies are
        authoritative at execution time.
      </p>
    </div>
  );
}

export function PolicyView({ policy, onSaved }: { policy: Policy; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState(policy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/policy', form, 'PUT');
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="policy-layout">
      <form className="panel policy-form" onSubmit={save}>
        <div className="panel-heading">
          <h2>Execution policy</h2>
          <ShieldCheck size={20} />
        </div>
        <div className="form-body">
          <label>
            Automatic refund limit <span>Amounts above this limit require human approval.</span>
            <div className="input-prefix">
              <span>$</span>
              <input
                type="number"
                min="0"
                max="500"
                step="0.01"
                required
                value={form.autoRefundLimitCents / 100}
                onChange={(e) =>
                  setForm({
                    ...form,
                    autoRefundLimitCents: Math.round(Number(e.target.value) * 100),
                  })
                }
              />
            </div>
          </label>
          <label>
            Hard refund limit{' '}
            <span>Amounts above this limit are always blocked. Maximum $500.</span>
            <div className="input-prefix">
              <span>$</span>
              <input
                type="number"
                min="0"
                max="500"
                step="0.01"
                required
                value={form.hardRefundLimitCents / 100}
                onChange={(e) =>
                  setForm({
                    ...form,
                    hardRefundLimitCents: Math.round(Number(e.target.value) * 100),
                  })
                }
              />
            </div>
          </label>
          <label>
            Action budget per mission{' '}
            <span>Stops missions that consume too many execution steps.</span>
            <input
              type="number"
              min="6"
              max="30"
              required
              value={form.maxActions}
              onChange={(e) => setForm({ ...form, maxActions: Number(e.target.value) })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.paused}
              onChange={(e) => setForm({ ...form, paused: e.target.checked })}
            />
            <span>Pause runtime execution</span>
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="button primary" disabled={saving}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save policy
          </button>
        </div>
      </form>
      <div className="policy-explainer">
        <span className="node-icon color-3">
          <LockKeyhole size={25} />
        </span>
        <h2>Autonomy with boundaries.</h2>
        <p>Model output proposes an action. Your policy decides whether that action can happen.</p>
        <ul>
          <li>
            <Check size={16} />
            Refund amounts come from the typed mission.
          </li>
          <li>
            <Check size={16} />
            Replacements always require approval.
          </li>
          <li>
            <Check size={16} />
            Account access always routes to a specialist.
          </li>
          <li>
            <Check size={16} />
            Policies are rechecked immediately before a write.
          </li>
          <li>
            <Check size={16} />
            All business effects stay in the sandbox.
          </li>
        </ul>
      </div>
    </div>
  );
}
