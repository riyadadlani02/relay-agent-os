import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  CheckCheck,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  Play,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { stages, type Run, type RunEvent, type RunInput } from '../shared';
import { Status, Avatar, Modal, Empty } from './ui';
import { money, relative, api } from '../lib';

export function RunTable({
  runs,
  onSelect,
  compact = false,
}: {
  runs: Run[];
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  return runs.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Mission / customer</th>
            <th>Status</th>
            {!compact && <th>Action</th>}
            <th>Created</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} onClick={() => onSelect(run.id)}>
              <td>
                <div className="mission-cell">
                  <span className={`mission-icon ${run.scenario}`}>
                    {run.scenario === 'refund' ? (
                      <RotateCcw size={16} />
                    ) : run.scenario === 'replacement' ? (
                      <Send size={16} />
                    ) : (
                      <LockKeyhole size={16} />
                    )}
                  </span>
                  <div>
                    <button
                      className="table-title"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(run.id);
                      }}
                    >
                      {run.scenario === 'refund'
                        ? 'Resolve billing request'
                        : run.scenario === 'replacement'
                          ? 'Replace damaged delivery'
                          : 'Recover account access'}
                    </button>
                    <small>
                      {run.customer}
                      <span className="source-tag">
                        {run.source === 'sample' ? 'Sample' : 'New'}
                      </span>
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <Status status={run.status} />
              </td>
              {!compact && (
                <td>
                  {run.scenario === 'refund'
                    ? money(run.amountCents)
                    : run.scenario === 'replacement'
                      ? 'Replacement'
                      : 'Handoff'}
                </td>
              )}
              <td className="muted nowrap">{relative(run.createdAt)}</td>
              <td>
                <ChevronRight size={15} className="muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No missions found"
      description="Try another filter or launch your first mission."
    />
  );
}

export function MissionLog({ runs, onSelect }: { runs: Run[]; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = runs.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      (r.customer + ' ' + r.issue + ' ' + r.id).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="list-toolbar">
        <div className="filter-tabs">
          {[
            ['all', 'All missions'],
            ['completed', 'Completed'],
            ['awaiting_approval', 'Needs review'],
            ['failed', 'Failed'],
          ].map(([v, l]) => (
            <button key={v} className={v === filter ? 'selected' : ''} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
        <label className="inline-search">
          <Search size={16} />
          <input
            aria-label="Filter missions"
            placeholder="Search missions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <RunTable runs={filtered} onSelect={onSelect} />
    </section>
  );
}

const presets: { name: string; input: RunInput }[] = [
  {
    name: 'Quick refund',
    input: {
      customer: 'Alex Morgan',
      issue:
        'I was billed twice for my monthly subscription. Please refund the duplicate $49 charge.',
      scenario: 'refund',
      amountCents: 4900,
      faultOnce: false,
    },
  },
  {
    name: 'Approval gate',
    input: {
      customer: 'Sam Rivera',
      issue: 'My annual plan renewed after cancellation. Please refund the $249 renewal.',
      scenario: 'refund',
      amountCents: 24900,
      faultOnce: false,
    },
  },
  {
    name: 'Damaged order',
    input: {
      customer: 'Jordan Lee',
      issue: 'My headphones arrived damaged. Please send a replacement.',
      scenario: 'replacement',
      amountCents: 8900,
      faultOnce: false,
    },
  },
  {
    name: 'Policy boundary',
    input: {
      customer: 'Taylor Brooks',
      issue: 'Please refund the entire $750 enterprise invoice.',
      scenario: 'refund',
      amountCents: 75000,
      faultOnce: false,
    },
  },
];
export function NewMission({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (run: Run) => Promise<void>;
}) {
  const [form, setForm] = useState<RunInput>(presets[0].input);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onCreated(await api<Run>('/runs', form));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Launch a mission" onClose={onClose}>
      <form onSubmit={submit} className="form-body">
        <p className="form-intro">Give your agents a customer request. Watch the work happen.</p>
        <div className="preset-label">Start with a scenario</div>
        <div className="presets">
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              className={form.issue === p.input.issue ? 'selected' : ''}
              onClick={() => setForm(p.input)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="form-row">
          <label>
            Customer name
            <input
              required
              minLength={2}
              maxLength={80}
              value={form.customer}
              onChange={(e) => setForm({ ...form, customer: e.target.value })}
            />
          </label>
          <label>
            Workflow
            <select
              value={form.scenario}
              onChange={(e) =>
                setForm({ ...form, scenario: e.target.value as RunInput['scenario'] })
              }
            >
              <option value="refund">Refund request</option>
              <option value="replacement">Replacement</option>
              <option value="account">Account access</option>
            </select>
          </label>
        </div>
        <label>
          Customer request
          <textarea
            required
            minLength={8}
            maxLength={2000}
            rows={4}
            value={form.issue}
            onChange={(e) => setForm({ ...form, issue: e.target.value })}
          />
        </label>
        <label>
          Requested amount (USD)
          <input
            type="number"
            required
            min="0"
            max="100000"
            step="0.01"
            value={form.amountCents / 100}
            onChange={(e) =>
              setForm({ ...form, amountCents: Math.round(Number(e.target.value) * 100) })
            }
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.faultOnce}
            onChange={(e) => setForm({ ...form, faultOnce: e.target.checked })}
          />
          <span>
            Simulate one connector failure <small>See how a safe retry works.</small>
          </span>
        </label>
        <div className="info-box">
          <ShieldCheck size={17} />
          <span>
            Actions run against simulated customer systems. No real refunds or shipments are issued.
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}Launch mission
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RunDetail({
  id,
  onClose,
  onRefresh,
  onDecide,
  busy,
}: {
  id: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDecide: (id: string, d: 'approved' | 'rejected') => Promise<void>;
  busy: boolean;
}) {
  const [data, setData] = useState<{ run: Run; events: RunEvent[] }>();
  const [error, setError] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await api(`/runs/${id}`));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [refresh]);
  async function cancel() {
    setLocalBusy(true);
    try {
      await api(`/runs/${id}/cancel`, {});
      await refresh();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLocalBusy(false);
    }
  }
  const run = data?.run;
  return (
    <Modal title="Mission trace" onClose={onClose} wide>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!run ? (
        <div className="loading">
          <LoaderCircle className="spin" />
        </div>
      ) : (
        <div className="run-detail">
          <div className="detail-summary">
            <Avatar name={run.customer} />
            <div>
              <h3>{run.customer}</h3>
              <small>
                {run.id} · {run.model}
              </small>
            </div>
            <Status status={run.status} />
          </div>
          <p className="detail-request">{run.issue}</p>
          <div className="detail-stats">
            <span>
              Requested amount<strong>{money(run.amountCents)}</strong>
            </span>
            <span>
              Execution steps<strong>{run.actions}</strong>
            </span>
            <span>
              Connector retries<strong>{run.attempts}</strong>
            </span>
            <span>
              Environment<strong>Sandbox</strong>
            </span>
          </div>
          <div className="stage-track">
            {stages.map((s, i) => (
              <div key={s.name} className={run.step > i ? 'done' : run.step === i ? 'current' : ''}>
                <span>{run.step > i ? <Check size={13} /> : i + 1}</span>
                {s.name}
              </div>
            ))}
          </div>
          {run.plan && (
            <div className="plan-box">
              <h4>
                <Sparkles size={15} />
                Proposed action: {run.plan.action}
              </h4>
              <p>{run.plan.reason}</p>
              <details>
                <summary>Customer response draft</summary>
                <p>{run.plan.reply}</p>
              </details>
            </div>
          )}
          {run.status === 'awaiting_approval' && (
            <div className="approval-inline">
              <div>
                <ShieldCheck size={19} />
                <strong>Your approval is needed</strong>
              </div>
              <p>Approve this specific action to resume the mission.</p>
              <div>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    await onDecide(id, 'rejected');
                    await refresh();
                  }}
                >
                  Reject
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    await onDecide(id, 'approved');
                    await refresh();
                  }}
                >
                  <Check size={16} />
                  Approve action
                </button>
              </div>
            </div>
          )}
          {run.outcome && (
            <div className={`outcome ${run.status}`}>
              <CheckCheck size={19} />
              {run.outcome}
            </div>
          )}
          <div className="trace-heading">
            <h3>Execution trace</h3>
            <span>{data.events.length} events</span>
          </div>
          <ol className="trace-list">
            {data.events.map((event) => (
              <li key={event.id}>
                <span className={`trace-dot ${event.type.includes('review') ? 'amber' : ''}`} />
                <div className="trace-event-head">
                  <strong>{event.agent}</strong>
                  <code>{event.type}</code>
                  <time>{new Date(event.at).toLocaleTimeString('en-US', { hour12: false })}</time>
                </div>
                <p>{event.message}</p>
                {Object.keys(event.data).length > 0 && (
                  <details>
                    <summary>Event payload</summary>
                    <pre>{JSON.stringify(event.data, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
          {['queued', 'running', 'awaiting_approval'].includes(run.status) && (
            <button className="button secondary cancel-run" disabled={localBusy} onClick={cancel}>
              <X size={14} />
              Cancel mission
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
