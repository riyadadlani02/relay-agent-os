import { stageIcons } from './ui';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Fingerprint,
  GitBranch,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { stages, type Run, type Snapshot } from '../shared';
import { Avatar, Empty } from './ui';
import { money, relative } from '../lib';
import { RunTable } from './Missions';
import type { Page } from '../App';

export function Overview({
  state,
  pending,
  onSelect,
  onNavigate,
  onNew,
}: {
  state: Snapshot;
  pending: Run[];
  onSelect: (id: string) => void;
  onNavigate: (p: Page) => void;
  onNew: () => void;
}) {
  const completed = state.runs.filter((r) => r.status === 'completed');
  const active = state.runs.filter((r) => ['running', 'queued'].includes(r.status));
  const done = state.runs.filter((r) => ['completed', 'failed', 'cancelled'].includes(r.status));
  const metrics = [
    {
      label: 'Missions completed',
      value: completed.length,
      foot: `of ${state.runs.length} total missions`,
      icon: CheckCheck,
      color: 'blue',
    },
    {
      label: 'Running now',
      value: active.length,
      foot: state.policy.paused ? 'Runtime paused' : '4 concurrent worker slots',
      icon: Activity,
      color: 'green',
    },
    {
      label: 'Awaiting your review',
      value: pending.length,
      foot: 'Human judgment, right on time',
      icon: ShieldCheck,
      color: 'orange',
    },
    {
      label: 'Completion rate',
      value: done.length ? `${Math.round((completed.length / done.length) * 100)}%` : '—',
      foot: 'Across finished missions',
      icon: GitBranch,
      color: 'purple',
    },
  ];
  return (
    <>
      <div className="metrics">
        {metrics.map((m, i) => (
          <div className="metric" key={m.label}>
            <div className="metric-label">
              {m.label}
              <m.icon size={17} />
            </div>
            <div className="metric-mid">
              <strong>{m.value}</strong>
              <MissionSparkline runs={state.runs} metric={i} color={m.color} />
            </div>
            <div className="metric-foot">
              <span className={`mini-dot ${m.color}`} />
              {m.foot}
            </div>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel workflow-panel">
          <div className="panel-heading">
            <div>
              <h2>
                The work behind the work <span className="subtle-badge">Live runtime</span>
              </h2>
              <p>One mission. Six services working together.</p>
            </div>
            <button
              className="icon-button"
              onClick={() => onNavigate('Agents')}
              aria-label="View agents"
            >
              <ArrowUpRight size={19} />
            </button>
          </div>
          <div className="workflow-map">
            <div className="flow-caption">
              <span className="live-dot" />
              {active.length
                ? `${active.length} mission${active.length === 1 ? '' : 's'} in motion`
                : 'Ready for your next mission'}
              <span>Customer operations</span>
            </div>
            <svg
              className="flow-lines"
              viewBox="0 0 600 230"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M130 62H480Q520 62 520 110V125Q520 168 480 168H120" />
              <path d="m287 57 6 5-6 5m0 96-6 5 6 5" />
            </svg>
            <div className="flow-nodes">
              {[0, 1, 2, 5, 4, 3].map((index) => {
                const stage = stages[index];
                const Icon = stageIcons[index];
                const count = active.filter((r) => r.step === index).length;
                return (
                  <button
                    key={stage.name}
                    className={`flow-node node-${index} ${count ? 'working' : ''}`}
                    onClick={() => onNavigate('Agents')}
                  >
                    <span className={`node-icon color-${index}`}>
                      <Icon size={21} />
                    </span>
                    <span>
                      <strong>{stage.name}</strong>
                      <small>{stage.agent} agent</small>
                    </span>
                    <span className={`node-light ${count ? 'on' : ''}`} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flow-footer">
            <span>
              <Fingerprint size={15} />
              Every step leaves a trace.
            </span>
            <button onClick={onNew}>
              Run a mission <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section className="panel review-panel">
          <div className="panel-heading">
            <h2>
              A little human judgment <span className="count-badge">{pending.length}</span>
            </h2>
          </div>
          {pending.length ? (
            <>
              <div className="review-avatar-row">
                <Avatar name={pending[0].customer} />
                <div>
                  <strong>{pending[0].customer}</strong>
                  <small>
                    {pending[0].scenario === 'refund' ? 'Refund request' : 'Replacement request'}
                  </small>
                </div>
                <span className="review-amount">{money(pending[0].amountCents)}</span>
              </div>
              <p className="review-quote">“{pending[0].issue}”</p>
              <div className="review-reason">
                <ShieldCheck size={15} />
                {pending[0].scenario === 'refund'
                  ? `Above the ${money(state.policy.autoRefundLimitCents)} automatic limit`
                  : 'Replacement shipments need approval'}
              </div>
              <button className="button review-button" onClick={() => onSelect(pending[0].id)}>
                Review action <ArrowRight size={16} />
              </button>
              <button className="text-button all-approvals" onClick={() => onNavigate('Approvals')}>
                View all approvals <ChevronRight size={14} />
              </button>
            </>
          ) : (
            <Empty title="All clear" description="Your agents are operating within policy." />
          )}
        </section>
        <section className="panel recent-panel">
          <div className="panel-heading">
            <h2>
              Recent missions <span className="subtle-badge">{state.runs.length} total</span>
            </h2>
            <button className="text-button" onClick={() => onNavigate('Mission log')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <RunTable runs={state.runs.slice(0, 5)} onSelect={onSelect} compact />
        </section>
        <section className="panel activity-panel">
          <div className="panel-heading">
            <h2>Activity stream</h2>
            <span className="live-label">
              <i />
              Live
            </span>
          </div>
          <div className="activity-list">
            {state.events.slice(0, 5).map((event) => (
              <button
                key={event.id}
                className="activity-item"
                onClick={() => onSelect(event.runId)}
              >
                <span className={`activity-icon ${event.type.includes('review') ? 'amber' : ''}`}>
                  {event.type.includes('review') ? (
                    <ShieldCheck size={14} />
                  ) : event.type.includes('completed') ? (
                    <Check size={14} />
                  ) : (
                    <GitBranch size={14} />
                  )}
                </span>
                <span>
                  <strong>
                    {event.agent}
                    <small>{relative(event.at)}</small>
                  </strong>
                  <p>{event.message}</p>
                </span>
              </button>
            ))}
          </div>
          <div className="activity-foot">
            <span className="live-dot" />
            All events persisted to the audit log
          </div>
        </section>
      </div>
      <div className="bottom-callout">
        <div className="callout-icon">
          <Terminal size={22} />
        </div>
        <div>
          <strong>Built to be opened up.</strong>
          <p>
            Inspect the plan, the policy decision, and every tool call. Nothing behind the curtain.
          </p>
        </div>
        <button className="text-button" onClick={() => onNavigate('Mission log')}>
          Explore mission traces <ArrowUpRight size={16} />
        </button>
      </div>
    </>
  );
}

export function MissionSparkline({
  runs,
  metric,
  color,
}: {
  runs: Run[];
  metric: number;
  color: string;
}) {
  const now = Date.now();
  const values = Array.from({ length: 12 }, (_, index) => {
    const bucket = runs.filter(
      (run) => Math.floor((now - Date.parse(run.createdAt)) / 1800000) === 11 - index,
    );
    if (metric === 0) return bucket.filter((run) => run.status === 'completed').length;
    if (metric === 1)
      return bucket.filter((run) => ['queued', 'running'].includes(run.status)).length;
    if (metric === 2) return bucket.filter((run) => run.status === 'awaiting_approval').length;
    const finished = bucket.filter((run) =>
      ['completed', 'failed', 'cancelled'].includes(run.status),
    );
    return finished.length
      ? bucket.filter((run) => run.status === 'completed').length / finished.length
      : 0;
  });
  const maximum = Math.max(1, ...values);
  return (
    <svg
      className={`sparkline ${color}`}
      viewBox="0 0 100 35"
      role="img"
      aria-label="Mission distribution by creation time over the last six hours"
    >
      <title>30-minute buckets by mission creation time; empty buckets have no bar.</title>
      {values.map((value, index) => (
        <rect
          key={index}
          x={index * 8.4}
          y={35 - (value / maximum) * 30}
          width="4.5"
          height={(value / maximum) * 30}
          rx="2"
        />
      ))}
    </svg>
  );
}
