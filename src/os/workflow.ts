import type { Grant, Program, Proposal, RelayKernel } from './kernel';

// Multi-agent workflows as data. A workflow is a small graph of steps; each step is an agent
// program with a task and exactly the capabilities that step needs. A deterministic runner process
// starts steps as their dependencies finish (independent steps run in parallel), hands each one the
// results it depends on, and returns the answer. The runner can only delegate what it was granted,
// and every step's calls still go through the kernel's gate.

export interface WorkflowStep {
  id: string;
  title: string;
  /** Agent program that performs the step. */
  program: string;
  /** Task template; `{name}` placeholders are filled from the workflow inputs. */
  task: string;
  /** Capabilities delegated to this step only. Resource templates may use placeholders. */
  grants: Grant[];
  /** Calls this step may put in front of the person for consent. Default: none. */
  escalate?: string[];
  after?: string[];
  budget: { steps: number; tokens: number };
}
export interface Workflow {
  id: string;
  title: string;
  summary: string;
  steps: WorkflowStep[];
  /** The step whose result is the workflow's answer. */
  answer: string;
}
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface StepState {
  id: string;
  title: string;
  status: StepStatus;
  pid?: number;
  result?: string;
}
export interface RunnerMemory {
  title: string;
  answer: string;
  steps: WorkflowStep[];
  states: StepState[];
  spawning?: string;
}

export function render(template: string, inputs: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!(key in inputs)) throw new Error(`Missing workflow input "${key}".`);
    return inputs[key];
  });
}

/** Rejects duplicate IDs, unknown dependencies, cycles and a missing answer step. */
export function validateWorkflow(workflow: Workflow) {
  const ids = workflow.steps.map((s) => s.id);
  if (!ids.length) throw new Error('A workflow needs at least one step.');
  if (new Set(ids).size !== ids.length) throw new Error('Step IDs must be unique.');
  if (!ids.includes(workflow.answer)) throw new Error(`Unknown answer step "${workflow.answer}".`);
  for (const step of workflow.steps)
    for (const dep of step.after ?? [])
      if (!ids.includes(dep)) throw new Error(`Step "${step.id}" depends on unknown "${dep}".`);
  const order: string[] = [];
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (order.includes(id)) return;
    if (visiting.has(id)) throw new Error(`Workflow has a cycle through "${id}".`);
    visiting.add(id);
    workflow.steps.find((s) => s.id === id)!.after?.forEach(visit);
    visiting.delete(id);
    order.push(id);
  };
  ids.forEach(visit);
  return order;
}

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

/** The deterministic runner. It is a trusted program, but still an ordinary kernel process. */
export const workflowRunner: Program<RunnerMemory> = {
  name: 'workflow',
  init: (arg) => {
    const spec = arg as Omit<RunnerMemory, 'states'>;
    return {
      ...spec,
      states: spec.steps.map((s) => ({ id: s.id, title: s.title, status: 'pending' as const })),
    };
  },
  step({ memory: m, last, view }): Proposal {
    const state = (id: string) => m.states.find((s) => s.id === id)!;
    if (last?.call === 'proc.spawn' && m.spawning) {
      const s = state(m.spawning);
      if (last.ok) {
        s.status = 'running';
        s.pid = (last.value as { pid: number }).pid;
      } else {
        s.status = 'failed';
        s.result = `Could not start: ${last.errno}: ${last.message}`;
      }
      m.spawning = undefined;
    }
    if (last?.call === 'ipc.recv' && last.ok) {
      const { from, body } = last.value as {
        from: number;
        body: { exited?: string; value?: { result?: unknown }; reason?: string };
      };
      const s = m.states.find((x) => x.pid === from && x.status === 'running');
      if (s && body?.exited) {
        s.status = body.exited === 'ok' ? 'done' : 'failed';
        s.result =
          body.exited === 'ok'
            ? clip(String(body.value?.result ?? ''), 400)
            : `Stopped (${body.exited}). ${body.reason ?? ''}`.trim();
      }
    }
    // A step whose dependency did not finish is skipped rather than run on missing facts.
    for (let changed = true; changed;) {
      changed = false;
      for (const step of m.steps) {
        const s = state(step.id);
        if (
          s.status === 'pending' &&
          step.after?.some((d) => ['failed', 'skipped'].includes(state(d).status))
        ) {
          s.status = 'skipped';
          s.result = 'Skipped: a step it depends on did not finish.';
          changed = true;
        }
      }
    }
    const ready = m.steps.find(
      (step) =>
        state(step.id).status === 'pending' &&
        (step.after ?? []).every((d) => state(d).status === 'done'),
    );
    if (ready) {
      m.spawning = ready.id;
      const facts = (ready.after ?? [])
        .map((d) => `- ${state(d).title}: ${state(d).result ?? ''}`)
        .join('\n');
      return {
        call: 'proc.spawn',
        args: {
          program: ready.program,
          name: `${ready.id}/${view.owner}`.slice(0, 40),
          arg: {
            task: clip(
              ready.task + (facts ? `\n\nResults from earlier steps:\n${facts}` : ''),
              1500,
            ),
          },
          budget: ready.budget,
          delegate: ready.grants,
          escalate: ready.escalate ?? [],
        },
        note: `Start step "${ready.title}" with ${ready.grants.length} delegated capabilit${ready.grants.length === 1 ? 'y' : 'ies'}.`,
      };
    }
    if (m.states.some((s) => s.status === 'running'))
      return { call: 'ipc.recv', args: {}, note: 'Wait for a running step to finish.' };
    const answer = state(m.answer);
    return {
      exit: {
        result:
          answer.status === 'done'
            ? answer.result
            : `The workflow could not finish: ${answer.title} ${answer.status}.`,
        steps: m.states.map(({ id, status, result }) => ({ id, status, result: result ?? '' })),
      },
      note: 'All steps settled.',
    };
  },
};

/** Grants for the runner: the union of every step's grants, plus the right to start each program. */
function runnerGrants(steps: WorkflowStep[]): Grant[] {
  const merged = new Map<string, Grant>();
  const add = (g: Grant) => {
    const key = JSON.stringify([[...g.rights].sort(), g.resource]);
    const existing = merged.get(key);
    if (!existing) return merged.set(key, { ...g, uses: g.uses ?? null });
    // Use-limited grants add up, so each step can still receive its own uses.
    existing.uses =
      existing.uses === null ||
      existing.uses === undefined ||
      g.uses === null ||
      g.uses === undefined
        ? null
        : existing.uses + g.uses;
  };
  steps.flatMap((s) => s.grants).forEach(add);
  [...new Set(steps.map((s) => s.program))].forEach((p) =>
    add({ rights: ['proc.spawn'], resource: `program:${p}` }),
  );
  return [...merged.values()].map((g) =>
    g.uses === null ? { rights: g.rights, resource: g.resource } : g,
  );
}

/**
 * Starts a workflow for a person. The runner is derived from that person's own authority, so a
 * workflow can never do more than the person who started it could.
 */
export function startWorkflow<W>(
  kernel: RelayKernel<W>,
  workflow: Workflow,
  owner: string,
  inputs: Record<string, string>,
) {
  validateWorkflow(workflow);
  const steps = workflow.steps.map((s) => ({
    ...s,
    task: render(s.task, inputs),
    grants: s.grants.map((g) => ({ ...g, resource: render(g.resource, inputs) })),
  }));
  const sum = (key: 'steps' | 'tokens') => steps.reduce((n, s) => n + s.budget[key], 0);
  return kernel.spawn(
    { kind: 'user', id: owner },
    {
      program: workflowRunner.name,
      owner,
      name: `${workflow.id}/${owner}`.slice(0, 40),
      arg: { title: workflow.title, answer: workflow.answer, steps },
      // Every spawn and every collected result costs the runner one quantum.
      budget: { steps: sum('steps') + 2 * steps.length + 2, tokens: sum('tokens') },
      grants: runnerGrants(steps),
      escalate: [...new Set(steps.flatMap((s) => s.escalate ?? []))],
    },
  );
}
