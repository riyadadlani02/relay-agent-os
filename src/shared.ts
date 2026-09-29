export type RunStatus =
  'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
export type Scenario = 'refund' | 'replacement' | 'account';
export interface RunInput {
  customer: string;
  issue: string;
  scenario: Scenario;
  amountCents: number;
  faultOnce: boolean;
}
export interface Plan {
  action: 'refund' | 'replace' | 'escalate';
  reason: string;
  reply: string;
}
export interface Run extends RunInput {
  id: string;
  status: RunStatus;
  step: number;
  actions: number;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  plan?: Plan;
  outcome?: string;
  approval?: 'approved' | 'rejected';
  source: 'sample' | 'user';
  model: string;
}
export interface RunEvent {
  id: number;
  runId: string;
  at: string;
  type: string;
  agent: string;
  message: string;
  data: Record<string, unknown>;
}
export interface Policy {
  autoRefundLimitCents: number;
  hardRefundLimitCents: number;
  maxActions: number;
  paused: boolean;
}
export interface Effect {
  id: string;
  runId: string;
  kind: string;
  amountCents: number;
  at: string;
}
export interface Knowledge {
  id: string;
  title: string;
  body: string;
  tag: string;
}
export interface Snapshot {
  runs: Run[];
  events: RunEvent[];
  policy: Policy;
  effects: Effect[];
  knowledge: Knowledge[];
  provider: string;
}
export const stages = [
  { name: 'Intake', agent: 'Triage', tool: 'customer.lookup' },
  { name: 'Retrieve', agent: 'Knowledge', tool: 'knowledge.search' },
  { name: 'Reason', agent: 'Resolution', tool: 'model.plan' },
  { name: 'Guard', agent: 'Policy', tool: 'policy.evaluate' },
  { name: 'Execute', agent: 'Action', tool: 'sandbox.commit' },
  { name: 'Verify', agent: 'Quality', tool: 'outcome.verify' },
] as const;
