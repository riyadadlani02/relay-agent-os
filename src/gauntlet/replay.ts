import type { Action, Model, Session } from '../playground/domain';
import type { CaseResult } from './evaluate';

// Replays a published run's recorded tool choices through the current kernel. This is not new
// inference: it answers "what would the current runtime have done with exactly those proposals?"
// The kernel's model-visible prompts only differ from the original run after a change that now
// stops for customer confirmation, which is where replay and original are meant to diverge.

/** Rebuilds the model's actions from a recorded session: each model trace plus its tool input. */
export function recordedActions(session: Session, fromTrace = 0): Action[] {
  const actions: Action[] = [];
  session.traces.forEach((trace, index) => {
    if (index < fromTrace) return;
    if (trace.kind === 'error' && trace.name === 'model.invalid_output')
      throw new Error('Invalid model outputs were not recorded verbatim and cannot be replayed.');
    if (trace.kind !== 'model') return;
    const tool = (trace.output as { selectedTool: Action['tool'] }).selectedTool;
    if (tool === 'respond')
      throw new Error('Free-text replies are not linked to their trace and cannot be replayed.');
    const rest = session.traces.slice(index + 1);
    const nextModel = rest.findIndex((t) => t.kind === 'model');
    const call = (nextModel < 0 ? rest : rest.slice(0, nextModel)).find(
      (t) => t.kind === 'tool' && t.name === tool,
    );
    if (!call) throw new Error(`No recorded input for ${tool} at trace ${index}.`);
    const input = call.input as { orderId: string; query: string };
    actions.push({ tool, orderId: input.orderId, query: input.query, reply: '' });
  });
  return actions;
}

export function replayModel(original: CaseResult): Model & { remaining(): number } {
  // Each turn's session also contains every earlier turn's traces.
  const queue = original.turns.flatMap((turn, i) =>
    recordedActions(turn.session, i ? original.turns[i - 1].session.traces.length : 0),
  );
  return {
    name: 'Replay of recorded proposals — not inference',
    interrupt() {},
    remaining: () => queue.length,
    async complete() {
      const next = queue.shift();
      if (!next) throw new Error('Replay diverged: the kernel asked for an unrecorded step.');
      return { content: JSON.stringify(next), tokens: 0, milliseconds: 0 };
    },
  };
}
