import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { stages, type Plan, type Policy, type Run, type RunInput } from '../src/shared.js';
import { Store } from './store.js';
import { planSchema, sandboxPlanner, type Planner } from './provider.js';

export const inputSchema = z
  .object({
    customer: z.string().trim().min(2).max(80),
    issue: z.string().trim().min(8).max(2000),
    scenario: z.enum(['refund', 'replacement', 'account']),
    amountCents: z.number().int().min(0).max(10000000),
    faultOnce: z.boolean().default(false),
  })
  .strict();
export const policySchema = z
  .object({
    autoRefundLimitCents: z.number().int().min(0).max(50000),
    hardRefundLimitCents: z.number().int().min(0).max(50000),
    maxActions: z.number().int().min(6).max(30),
    paused: z.boolean(),
  })
  .strict()
  .refine(
    (p) => p.autoRefundLimitCents <= p.hardRefundLimitCents,
    'Automatic limit cannot exceed hard limit.',
  );
export class RuntimeError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
const terminal = new Set(['completed', 'failed', 'cancelled']);
export function policyDecision(
  run: Pick<Run, 'scenario' | 'amountCents' | 'plan'>,
  policy: Policy,
): 'allow' | 'review' | 'deny' {
  const action = run.plan?.action;
  if (!action) return 'deny';
  if (action === 'escalate') return 'allow';
  if (
    action === 'refund' &&
    (run.scenario !== 'refund' ||
      run.amountCents <= 0 ||
      run.amountCents > policy.hardRefundLimitCents)
  )
    return 'deny';
  if (action === 'replace' && run.scenario !== 'replacement') return 'deny';
  return action === 'replace' || run.amountCents > policy.autoRefundLimitCents ? 'review' : 'allow';
}

export class Runtime {
  private inflight = new Set<string>();
  constructor(
    public store: Store,
    public planner: Planner = sandboxPlanner,
  ) {}
  create(
    input: RunInput,
    source: 'sample' | 'user' = 'user',
    createdAt = new Date().toISOString(),
  ): Run {
    const clean = inputSchema.parse(input);
    const run: Run = {
      ...clean,
      id: `run_${randomUUID().slice(0, 8)}`,
      status: 'queued',
      step: 0,
      actions: 0,
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      source,
      model: this.planner.name,
    };
    this.store.transaction(() => {
      this.store.save(run);
      this.store.event(run, 'run.created', 'Scheduler', 'Mission queued for execution.', {
        source,
      });
    });
    return run;
  }
  require(id: string): Run {
    const run = this.store.get(id);
    if (!run) throw new RuntimeError('Run not found.', 404);
    return run;
  }
  change(
    run: Run,
    type: string,
    agent: string,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    this.store.save(run);
    this.store.event(run, type, agent, message, data);
  }
  decide(id: string, decision: 'approved' | 'rejected'): Run {
    return this.store.transaction(() => {
      const run = this.require(id);
      if (run.status !== 'awaiting_approval')
        throw new RuntimeError('This run is no longer awaiting approval.');
      run.updatedAt = new Date().toISOString();
      run.approval = decision;
      run.status = decision === 'approved' ? 'queued' : 'cancelled';
      if (decision === 'rejected')
        run.outcome = 'Action rejected by the operator. No sandbox effect was created.';
      this.change(
        run,
        `approval.${decision}`,
        'Operator',
        decision === 'approved'
          ? 'Operator approved the proposed action.'
          : 'Operator rejected the proposed action.',
      );
      return run;
    });
  }
  cancel(id: string): Run {
    return this.store.transaction(() => {
      const run = this.require(id);
      if (terminal.has(run.status)) throw new RuntimeError('This run has already finished.');
      if (this.store.effects().some((e) => e.runId === id))
        throw new RuntimeError('The action was already committed; allow verification to finish.');
      run.status = 'cancelled';
      run.updatedAt = new Date().toISOString();
      run.outcome = 'Cancelled before execution.';
      this.change(run, 'run.cancelled', 'Operator', run.outcome);
      return run;
    });
  }
  async tick() {
    if (this.store.policy().paused) return;
    const runnable = this.store
      .runs()
      .filter((r) => ['queued', 'running'].includes(r.status))
      .reverse()
      .slice(0, 4);
    await Promise.all(runnable.map((r) => this.step(r.id)));
  }
  async step(id: string) {
    if (this.inflight.has(id) || this.store.policy().paused) return;
    let run = this.require(id);
    if (!['queued', 'running'].includes(run.status)) return;
    this.inflight.add(id);
    try {
      run.updatedAt = new Date().toISOString();
      // Reserve one step for verification before a write. Once an effect exists,
      // terminal verification must still finish if an operator lowers the budget.
      const budget = this.store.policy().maxActions;
      if (
        run.step !== 5 &&
        (run.actions >= budget || (run.step === 4 && run.actions >= budget - 1))
      ) {
        run.status = 'failed';
        run.outcome = 'Action budget exhausted. Start a new mission with an appropriate budget.';
        this.store.transaction(() =>
          this.change(run, 'budget.exceeded', 'Scheduler', run.outcome!),
        );
        return;
      }
      run.status = 'running';
      // Persist dispatch before awaiting a model. A restarted process can safely repeat this read-only step.
      this.store.save(run);
      let plan: Plan | undefined;
      if (run.step === 2)
        plan = planSchema.parse(await this.planner.plan(run, this.store.knowledge()));
      // Cancellation may occur while a provider request is in flight.
      const fresh = this.require(id);
      if (!['running', 'queued'].includes(fresh.status) || fresh.step !== run.step) return;
      run = fresh;
      run.actions++;
      run.updatedAt = new Date().toISOString();
      this.store.transaction(() => {
        const stage = stages[run.step];
        switch (run.step) {
          case 0:
            this.change(
              run,
              'tool.completed',
              stage.agent,
              `Sandbox customer context loaded for ${run.customer}.`,
              { tool: stage.tool, scenario: run.scenario },
            );
            break;
          case 1:
            this.change(
              run,
              'tool.completed',
              stage.agent,
              'Retrieved the applicable customer operations policy.',
              {
                tool: stage.tool,
                citations: [
                  run.scenario === 'refund'
                    ? 'KB-101'
                    : run.scenario === 'replacement'
                      ? 'KB-102'
                      : 'KB-103',
                ],
              },
            );
            break;
          case 2:
            run.plan = plan;
            this.change(run, 'plan.created', stage.agent, plan!.reason, {
              action: plan!.action,
              provider: this.planner.name,
              reply: plan!.reply,
            });
            break;
          case 3: {
            const decision = policyDecision(run, this.store.policy());
            if (decision === 'deny') {
              run.status = 'failed';
              run.outcome = 'Action blocked by policy. No sandbox effect was created.';
            }
            if (decision === 'review') run.status = 'awaiting_approval';
            this.change(
              run,
              `policy.${decision}`,
              stage.agent,
              decision === 'deny'
                ? run.outcome!
                : decision === 'review'
                  ? 'Human approval required before this action can execute.'
                  : 'Action is within the current policy.',
              { decision, amountCents: run.amountCents },
            );
            break;
          }
          case 4: {
            // Re-check immediately before the write: a policy may have changed after approval.
            const decision = policyDecision(run, this.store.policy());
            if (decision === 'deny') {
              run.status = 'failed';
              run.outcome = 'Current policy blocks execution, even with prior approval.';
              this.change(run, 'policy.deny', stage.agent, run.outcome);
              return;
            }
            if (decision === 'review' && run.approval !== 'approved') {
              run.status = 'awaiting_approval';
              this.change(
                run,
                'policy.review',
                stage.agent,
                'The current policy requires human approval.',
              );
              return;
            }
            if (run.faultOnce && run.attempts === 0) {
              run.attempts++;
              this.change(
                run,
                'tool.retry',
                stage.agent,
                'Simulated transient connector failure. Retrying with the same idempotency key.',
                { attempt: run.attempts, key: `${run.id}:${run.plan!.action}` },
              );
              return;
            }
            this.store.commitEffect(run);
            this.change(
              run,
              'tool.completed',
              stage.agent,
              run.plan!.action === 'refund'
                ? 'Refund committed to the sandbox ledger.'
                : run.plan!.action === 'replace'
                  ? 'Replacement created in the sandbox ledger.'
                  : 'Specialist handoff created in the sandbox ledger.',
              { tool: stage.tool, key: `${run.id}:${run.plan!.action}`, sandbox: true },
            );
            break;
          }
          case 5: {
            const effect = this.store.effects().find((e) => e.runId === run.id);
            if (!effect || effect.kind !== run.plan?.action)
              throw new Error('Outcome verification failed.');
            run.status = 'completed';
            run.outcome =
              effect.kind === 'refund'
                ? `$${(effect.amountCents / 100).toFixed(2)} refund recorded in the sandbox ledger.`
                : effect.kind === 'replace'
                  ? 'Replacement recorded in the sandbox ledger.'
                  : 'Account case handed off to a specialist in the sandbox.';
            this.change(run, 'run.completed', stage.agent, run.outcome, {
              verified: true,
              effectId: effect.id,
            });
            break;
          }
        }
        run.step++;
        this.store.save(run);
      });
    } catch (error) {
      const fresh = this.require(id);
      if (!terminal.has(fresh.status)) {
        fresh.status = 'failed';
        fresh.updatedAt = new Date().toISOString();
        fresh.outcome = 'Execution failed. Inspect the trace and launch a new mission.';
        // Provider error bodies may contain sensitive data; persist only a safe category.
        this.store.transaction(() =>
          this.change(fresh, 'run.failed', 'Scheduler', fresh.outcome!, {
            category: error instanceof z.ZodError ? 'invalid_model_output' : 'execution_error',
          }),
        );
      }
    } finally {
      this.inflight.delete(id);
    }
  }
}
