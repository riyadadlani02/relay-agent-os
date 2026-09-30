import { z } from 'zod';
import {
  authorize,
  CapabilityError,
  derive,
  mint,
  narrows,
  isLive,
  principalId,
  revoke,
  consume,
  type Capability,
  type Principal,
} from './capability';
import { append, canonical, type JournalEntry } from './journal';

// Relay kernel: agents run as processes that can only affect the world through syscalls. Every
// syscall is mediated here: argument validation, capability check, business policy, human consent
// or operator approval, an atomic commit, and a hash-chained journal entry. Programs (model-driven
// or scripted) only ever *propose* the next call.

export type Errno =
  | 'EPERM' // no capability, and nobody entitled to grant one
  | 'EPOLICY' // business policy denies it; no human can override
  | 'EDECLINED' // the owner declined consent
  | 'EREJECTED' // an operator rejected the review
  | 'EINVAL' // malformed proposal or arguments
  | 'ENOSYS' // unknown syscall
  | 'ESRCH' // no such process
  | 'EBUDGET' // a delegated budget would exceed what the caller has left
  | 'EAGAIN' // receiver's mailbox is full
  | 'EFAULT'; // the syscall implementation failed; nothing was committed

export interface PolicyDecision {
  decision: 'allow' | 'review' | 'deny';
  reason: string;
}
export interface CallContext {
  pid: number;
  owner: string;
  tick: number;
}
export interface Syscall<W, A = any> {
  name: string;
  effect: 'read' | 'write';
  args: z.ZodType<A>;
  resource(args: A): string;
  /** Plain-language description shown in consent and approval prompts. */
  describe(args: A, world: W): string;
  policy?(args: A, world: W): PolicyDecision;
  run(args: A, world: W, context: CallContext): unknown;
  /** One-line description offered to model-driven programs. */
  summary?: string;
  /** Argument fields that name a resource, mapped to its prefix, e.g. `{ orderId: 'order:' }`. */
  argResources?: Record<string, string>;
}
export interface SyscallInfo {
  name: string;
  effect: 'read' | 'write';
  summary: string;
  /** JSON Schema of the arguments. */
  args: Record<string, unknown>;
  argResources: Record<string, string>;
}
/** What a process may know about itself: its own authority, the syscall table and its quota. */
export interface ProcessView {
  pid: number;
  ppid: number | null;
  owner: string;
  capabilities: { id: string; rights: string[]; resource: string; uses: number | null }[];
  /** Calls this process may put in front of its owner for consent. */
  canAsk: Escalation;
  syscalls: SyscallInfo[];
  budget: { steps: number; tokens: number };
  mailbox: number;
}

export type Outcome =
  | { call: string; ok: true; value: unknown }
  | { call: string; ok: false; errno: Errno; message: string };
export type Proposal =
  | { call: string; args?: unknown; tokens?: number; note?: string }
  | { exit: unknown; tokens?: number; note?: string };
export interface Program<M = any> {
  name: string;
  init(arg: unknown): M;
  step(input: {
    pid: number;
    memory: M;
    last?: Outcome;
    view: ProcessView;
  }): Proposal | Promise<Proposal>;
}

export interface Envelope {
  from: number;
  body: unknown;
  tick: number;
}
export interface Process {
  pid: number;
  ppid: number | null;
  name: string;
  program: string;
  owner: string;
  priority: number;
  state: 'ready' | 'blocked' | 'exited';
  waiting?: { on: 'consent' | 'approval' | 'message'; request?: string };
  budget: { steps: number; tokens: number };
  used: { steps: number; tokens: number };
  memory: unknown;
  /** Calls this process may escalate to its owner for consent. */
  escalate: Escalation;
  last?: Outcome;
  mailbox: Envelope[];
  exit?: { status: 'ok' | 'killed' | 'budget' | 'fault'; value?: unknown; reason?: string };
  scheduledAt: number;
}
export interface HumanRequest {
  id: string;
  kind: 'consent' | 'approval';
  pid: number;
  call: string;
  args: unknown;
  resource: string;
  summary: string;
  reason: string;
  /** The user who may consent, or `operator` for policy reviews. */
  audience: string;
  capability?: string;
  /** True when the capability was minted by this request's consent and dies if rejected. */
  ephemeral?: boolean;
  tick: number;
}
export interface StepRecord {
  tick: number;
  pid: number;
  name: string;
  proposal: string;
  note?: string;
  result: string;
}
export interface Grant {
  rights: string[];
  resource: string;
  uses?: number | null;
  expiresAt?: number | null;
}

/** `*` means any call the owner could authorize; a list narrows it; `[]` means never ask. */
export type Escalation = '*' | string[];
const narrowEscalation = (parent: Escalation, requested?: string[]): Escalation =>
  requested === undefined
    ? parent
    : parent === '*'
      ? [...new Set(requested)]
      : requested.filter((r) => parent.includes(r));

export class KernelError extends Error {}
const resultOf = (p: Process) =>
  p.state === 'blocked' ? `waiting: ${p.waiting?.on}` : p.last?.ok === false ? p.last.errno : 'ok';
export const KERNEL: Principal = { kind: 'kernel', id: 'relay' };
const MAILBOX_LIMIT = 16;
const BUILTINS = ['proc.spawn', 'ipc.send', 'ipc.recv', 'cap.list'];

const proposalSchema = z.union([
  z
    .object({
      call: z.string().min(1).max(64),
      args: z.json().optional(),
      tokens: z.number().optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      exit: z.json(),
      tokens: z.number().optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
]);
const grantSchema = z
  .object({
    rights: z.array(z.string().min(1).max(64)).min(1).max(8),
    resource: z.string().min(1).max(120),
    uses: z.number().int().positive().nullable().optional(),
    expiresAt: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
const budgetSchema = z
  .object({ steps: z.number().int().positive(), tokens: z.number().int().nonnegative() })
  .strict();
const spawnSchema = z
  .object({
    program: z.string().min(1).max(64),
    name: z.string().min(1).max(40).optional(),
    arg: z.json().optional(),
    priority: z.number().int().min(0).max(9).optional(),
    budget: budgetSchema,
    delegate: z.array(grantSchema).max(8).default([]),
    escalate: z.array(z.string().min(1).max(64)).max(16).optional(),
  })
  .strict();
const sendSchema = z.object({ to: z.number().int().positive(), body: z.json() }).strict();

export interface KernelOptions<W> {
  world: W;
  syscalls: Syscall<W>[];
  programs: Program[];
  /** Ticks before an unused consent grant expires. */
  consentTtl?: number;
}

export class RelayKernel<W> {
  tick = 0;
  world: W;
  processes: Process[] = [];
  capabilities: Capability[] = [];
  requests: HumanRequest[] = [];
  journal: JournalEntry[] = [];
  private syscalls = new Map<string, Syscall<W>>();
  private syscallInfo: SyscallInfo[] = [];
  private programs = new Map<string, Program>();
  private ids = { pid: 0, cap: 0, request: 0 };
  private stepping = false;
  private consentTtl: number;

  constructor(options: KernelOptions<W>) {
    this.world = structuredClone(options.world);
    this.consentTtl = options.consentTtl ?? 500;
    for (const spec of options.syscalls) {
      if (BUILTINS.includes(spec.name) || this.syscalls.has(spec.name))
        throw new KernelError(`Syscall ${spec.name} is already defined.`);
      this.syscalls.set(spec.name, spec);
      const { $schema: _, ...args } = z.toJSONSchema(spec.args) as Record<string, unknown>;
      this.syscallInfo.push({
        name: spec.name,
        effect: spec.effect,
        summary: spec.summary ?? spec.name,
        args,
        argResources: spec.argResources ?? {},
      });
    }
    for (const program of options.programs) this.programs.set(program.name, program);
  }

  process(pid: number) {
    return this.processes.find((p) => p.pid === pid);
  }
  private holder(pid: number) {
    return `process:${pid}`;
  }
  private log(type: string, pid: number | null, data: unknown) {
    append(this.journal, { tick: this.tick, pid, type, data });
  }
  private nextCap() {
    return `cap-${++this.ids.cap}`;
  }

  /** Standing authority a person holds, such as over the orders they own. */
  grantStanding(user: string, grant: Grant): Capability {
    const cap = mint(
      this.capabilities,
      { id: this.nextCap(), holder: `user:${user}`, ...grant },
      KERNEL,
    );
    this.log('capability.minted', null, { capability: cap.id, holder: cap.holder, ...grant });
    return cap;
  }

  /**
   * Starts a root process. Users can only hand their agent authority they hold themselves; the
   * kernel and operators mint it. Either way the process never receives more than it is granted.
   */
  spawn(
    by: Principal,
    spec: {
      program: string;
      owner: string;
      name?: string;
      arg?: unknown;
      priority?: number;
      budget: { steps: number; tokens: number };
      grants?: Grant[];
      escalate?: string[];
    },
  ): number {
    if (by.kind === 'process') throw new KernelError('Processes spawn children with proc.spawn.');
    if (by.kind === 'user' && by.id !== spec.owner)
      throw new KernelError('A user can only start processes they own.');
    const program = this.programs.get(spec.program);
    if (!program) throw new KernelError(`Unknown program ${spec.program}.`);
    const budget = budgetSchema.parse(spec.budget);
    const pid = this.ids.pid + 1;
    const scratch = structuredClone(this.capabilities);
    const granted = (spec.grants ?? []).map((raw) => {
      const g = grantSchema.parse(raw);
      const request = { id: this.nextCap(), holder: this.holder(pid), ...g };
      if (by.kind !== 'user') return mint(scratch, request, by).id;
      const parent = this.coveringCapability(scratch, principalId(by), g);
      if (!parent)
        throw new CapabilityError(`${by.id} does not hold ${g.rights} on ${g.resource}.`);
      return derive(scratch, parent.id, by, request, this.tick).id;
    });
    this.capabilities = scratch;
    this.ids.pid = pid;
    this.processes.push(
      this.newProcess(pid, null, program, spec, budget, narrowEscalation('*', spec.escalate)),
    );
    this.log('process.spawned', pid, {
      program: spec.program,
      owner: spec.owner,
      by: principalId(by),
      capabilities: granted,
      budget,
    });
    return pid;
  }

  private newProcess(
    pid: number,
    ppid: number | null,
    program: Program,
    spec: { owner: string; name?: string; arg?: unknown; priority?: number },
    budget: { steps: number; tokens: number },
    escalate: Escalation,
  ): Process {
    return {
      pid,
      ppid,
      name: spec.name ?? program.name,
      program: program.name,
      owner: spec.owner,
      priority: spec.priority ?? 1,
      state: 'ready',
      budget: { ...budget },
      used: { steps: 0, tokens: 0 },
      memory: program.init(structuredClone(spec.arg)),
      escalate,
      mailbox: [],
      scheduledAt: 0,
    };
  }

  private coveringCapability(table: Capability[], holder: string, grant: Grant) {
    return table.find(
      (c) =>
        c.holder === holder &&
        grant.rights.every((r) => c.rights.includes(r)) &&
        narrows(grant.resource, c.resource) &&
        isLive(table, c, this.tick),
    );
  }

  private held(pid: number) {
    return this.capabilities
      .filter((c) => c.holder === this.holder(pid) && isLive(this.capabilities, c, this.tick))
      .map(({ id, rights, resource, uses, expiresAt }) => ({
        id,
        rights,
        resource,
        uses,
        expiresAt,
      }));
  }

  /** A detached copy, so a program cannot reach kernel state through what it is shown. */
  view(p: Process): ProcessView {
    return structuredClone({
      pid: p.pid,
      ppid: p.ppid,
      owner: p.owner,
      capabilities: this.held(p.pid).map(({ id, rights, resource, uses }) => ({
        id,
        rights,
        resource,
        uses,
      })),
      canAsk: p.escalate,
      syscalls: this.syscallInfo,
      budget: p.budget,
      mailbox: p.mailbox.length,
    });
  }

  /** Runs one scheduling quantum: one proposal from the highest-priority, least-recent process. */
  /** The process the scheduler would run next: highest priority, then least recently run. */
  peek(): Process | undefined {
    return this.processes
      .filter((p) => p.state === 'ready')
      .sort((a, b) => b.priority - a.priority || a.scheduledAt - b.scheduledAt || a.pid - b.pid)[0];
  }

  async step(): Promise<StepRecord | null> {
    if (this.stepping) throw new KernelError('A step is already running.');
    const p = this.peek();
    if (!p) return null;
    this.stepping = true;
    try {
      this.tick++;
      p.scheduledAt = this.tick;
      const record: StepRecord = {
        tick: this.tick,
        pid: p.pid,
        name: p.name,
        proposal: '',
        result: '',
      };
      if (p.budget.steps <= 0) {
        this.exit(p, 'budget', undefined, 'Step budget exhausted.');
        return { ...record, proposal: '—', result: 'killed: step budget exhausted' };
      }
      p.budget.steps--;
      p.used.steps++;
      const last = p.last;
      p.last = undefined;
      let raw: unknown;
      try {
        raw = await this.programs
          .get(p.program)!
          .step({ pid: p.pid, memory: p.memory, last, view: this.view(p) });
      } catch (error) {
        this.exit(
          p,
          'fault',
          undefined,
          error instanceof Error ? error.message : 'Program failed.',
        );
        return { ...record, proposal: '—', result: 'fault' };
      }
      // The world can change while a program is thinking. A late proposal from a process that was
      // killed or blocked meanwhile is discarded, never executed.
      if (p.state !== 'ready') {
        this.log('proposal.discarded', p.pid, { reason: `Process is ${p.state}.` });
        return { ...record, proposal: '—', result: 'discarded' };
      }
      // Tokens were spent even when the output turns out to be unusable.
      const reported = (raw as { tokens?: unknown } | null)?.tokens;
      const tokens =
        typeof reported === 'number' && Number.isSafeInteger(reported) && reported > 0
          ? reported
          : 0;
      p.used.tokens += tokens;
      p.budget.tokens -= tokens;
      if (p.budget.tokens < 0) {
        this.exit(p, 'budget', undefined, 'Token budget exhausted; the last proposal did not run.');
        return { ...record, proposal: '—', result: 'killed: token budget exhausted' };
      }
      const parsed = proposalSchema.safeParse(raw);
      if (!parsed.success) {
        p.last = { call: '?', ok: false, errno: 'EINVAL', message: 'Malformed proposal.' };
        this.log('proposal.invalid', p.pid, { message: parsed.error.issues[0]?.message });
        return { ...record, proposal: 'malformed', result: 'EINVAL' };
      }
      const proposal = parsed.data;
      record.note = proposal.note;
      if ('exit' in proposal) {
        this.exit(p, 'ok', proposal.exit);
        return { ...record, proposal: 'exit', result: 'exited' };
      }
      record.proposal = `${proposal.call} ${canonical(proposal.args ?? {})}`;
      this.dispatch(p, proposal.call, proposal.args);
      return { ...record, result: resultOf(p) };
    } finally {
      this.stepping = false;
    }
  }

  /** Steps until no process is runnable (all exited or waiting on a person), or `limit` quanta. */
  async run(limit = 200): Promise<StepRecord[]> {
    const records: StepRecord[] = [];
    while (records.length < limit) {
      const record = await this.step();
      if (!record) break;
      records.push(record);
    }
    return records;
  }

  private fail(p: Process, call: string, errno: Errno, message: string) {
    p.last = { call, ok: false, errno, message };
    this.log('syscall.failed', p.pid, { call, errno, message });
  }

  private dispatch(p: Process, call: string, rawArgs: unknown) {
    if (call === 'proc.spawn') return this.procSpawn(p, rawArgs);
    if (call === 'ipc.send') return this.ipcSend(p, rawArgs);
    if (call === 'ipc.recv') return this.ipcRecv(p);
    if (call === 'cap.list') {
      const value = this.held(p.pid);
      p.last = { call, ok: true, value };
      return;
    }
    const spec = this.syscalls.get(call);
    if (!spec) return this.fail(p, call, 'ENOSYS', `No syscall named ${call}.`);
    const parsed = spec.args.safeParse(rawArgs ?? {});
    if (!parsed.success)
      return this.fail(p, call, 'EINVAL', parsed.error.issues[0]?.message ?? 'Invalid arguments.');
    const resource = spec.resource(parsed.data);
    if (spec.effect === 'read') {
      const auth = authorize(this.capabilities, this.holder(p.pid), call, resource, this.tick);
      if (!auth.ok) return this.fail(p, call, 'EPERM', auth.reason);
      return this.execute(p, spec, parsed.data, resource, false);
    }
    this.write(p, spec, parsed.data, resource);
  }

  private write(p: Process, spec: Syscall<W>, args: unknown, resource: string, minted?: string) {
    const auth = authorize(this.capabilities, this.holder(p.pid), spec.name, resource, this.tick);
    // A proposal is not permission. Without a capability, only the process owner can supply one,
    // and only if they could do this themselves: nobody consents on someone else's behalf. This
    // runs before policy so an unauthorized caller learns nothing about the resource's state.
    const owner = auth.ok
      ? auth
      : authorize(this.capabilities, `user:${p.owner}`, spec.name, resource, this.tick);
    if (!owner.ok)
      return this.fail(
        p,
        spec.name,
        'EPERM',
        `Neither this process nor its owner (${p.owner}) may ${spec.name} ${resource}.`,
      );
    if (!auth.ok && p.escalate !== '*' && !p.escalate.includes(spec.name))
      return this.fail(
        p,
        spec.name,
        'EPERM',
        `This process may not ask ${p.owner} to authorize ${spec.name}.`,
      );
    const policy = this.policy(spec, args);
    // Never ask a person to authorize something that cannot happen.
    if (policy.decision === 'deny') return this.fail(p, spec.name, 'EPOLICY', policy.reason);
    if (!auth.ok) return this.request(p, 'consent', spec, args, resource, policy.reason);
    if (policy.decision === 'review')
      return this.request(p, 'approval', spec, args, resource, policy.reason, {
        capability: auth.capability.id,
        ephemeral: auth.capability.id === minted,
      });
    this.execute(p, spec, args, resource, false);
  }

  private policy(spec: Syscall<W>, args: unknown): PolicyDecision {
    return (
      spec.policy?.(args, this.world) ?? { decision: 'allow', reason: 'No policy restriction.' }
    );
  }

  private execute(
    p: Process,
    spec: Syscall<W>,
    args: unknown,
    resource: string,
    approved: boolean,
  ) {
    // Authority and policy are checked again at commit time; either may have changed meanwhile.
    const auth = authorize(this.capabilities, this.holder(p.pid), spec.name, resource, this.tick);
    if (!auth.ok) return this.fail(p, spec.name, 'EPERM', auth.reason);
    if (spec.effect === 'write') {
      const policy = this.policy(spec, args);
      if (policy.decision === 'deny' || (policy.decision === 'review' && !approved))
        return this.fail(p, spec.name, 'EPOLICY', policy.reason);
    }
    const draft = structuredClone(this.world);
    let value: unknown;
    try {
      value = structuredClone(
        spec.run(args, draft, { pid: p.pid, owner: p.owner, tick: this.tick }),
      );
    } catch (error) {
      return this.fail(p, spec.name, 'EFAULT', error instanceof Error ? error.message : 'Failed.');
    }
    // Reads run against a copy as well, so a buggy syscall cannot leak a mutation.
    if (spec.effect === 'write') this.world = draft;
    consume(this.capabilities, auth.capability.id);
    this.log(spec.effect === 'write' ? 'syscall.commit' : 'syscall.read', p.pid, {
      call: spec.name,
      args,
      resource,
      capability: auth.capability.id,
      ...(spec.effect === 'write' ? { value } : {}),
    });
    p.last = { call: spec.name, ok: true, value };
  }

  private request(
    p: Process,
    kind: HumanRequest['kind'],
    spec: Syscall<W>,
    args: unknown,
    resource: string,
    reason: string,
    binding: { capability?: string; ephemeral?: boolean } = {},
  ) {
    const request: HumanRequest = {
      id: `req-${++this.ids.request}`,
      kind,
      pid: p.pid,
      call: spec.name,
      args: structuredClone(args),
      resource,
      summary: spec.describe(args, this.world),
      reason,
      audience: kind === 'consent' ? p.owner : 'operator',
      ...binding,
      tick: this.tick,
    };
    this.requests.push(request);
    p.state = 'blocked';
    p.waiting = { on: kind, request: request.id };
    this.log(`${kind}.requested`, p.pid, {
      request: request.id,
      call: spec.name,
      args,
      resource,
      audience: request.audience,
    });
  }

  /**
   * A person answers a consent or approval request. The kernel then continues the exact stored
   * call; the program is not consulted again, so it cannot swap in different arguments.
   */
  decide(requestId: string, granted: boolean, by: Principal) {
    const request = this.requests.find((r) => r.id === requestId);
    if (!request) throw new KernelError('That request is no longer pending.');
    if (request.kind === 'consent' && !(by.kind === 'user' && by.id === request.audience))
      throw new KernelError(`Only ${request.audience} can answer this consent request.`);
    if (request.kind === 'approval' && by.kind !== 'operator')
      throw new KernelError('Only an operator can approve a policy review.');
    const p = this.process(request.pid)!;
    this.requests = this.requests.filter((r) => r !== request);
    p.state = 'ready';
    p.waiting = undefined;
    this.log(`${request.kind}.${granted ? 'granted' : 'declined'}`, p.pid, {
      request: request.id,
      by: principalId(by),
    });
    const spec = this.syscalls.get(request.call)!;
    if (!granted) {
      if (request.ephemeral && request.capability) this.revokeAll([request.capability]);
      return this.fail(
        p,
        request.call,
        request.kind === 'consent' ? 'EDECLINED' : 'EREJECTED',
        request.kind === 'consent' ? `${by.id} declined.` : 'An operator rejected the action.',
      );
    }
    if (request.kind === 'approval')
      return this.execute(p, spec, request.args, request.resource, true);
    // Consent is delegation: the owner narrows their own authority to one use of this exact call.
    const owner = authorize(
      this.capabilities,
      principalId(by),
      request.call,
      request.resource,
      this.tick,
    );
    if (!owner.ok) return this.fail(p, request.call, 'EPERM', owner.reason);
    const cap = derive(
      this.capabilities,
      owner.capability.id,
      by,
      {
        id: this.nextCap(),
        holder: this.holder(p.pid),
        rights: [request.call],
        resource: request.resource,
        uses: 1,
        expiresAt: this.tick + this.consentTtl,
      },
      this.tick,
    );
    this.log('capability.derived', p.pid, {
      capability: cap.id,
      from: owner.capability.id,
      rights: cap.rights,
      resource: cap.resource,
      uses: 1,
    });
    this.write(p, spec, request.args, request.resource, cap.id);
  }

  private procSpawn(p: Process, rawArgs: unknown) {
    const parsed = spawnSchema.safeParse(rawArgs ?? {});
    if (!parsed.success)
      return this.fail(p, 'proc.spawn', 'EINVAL', parsed.error.issues[0]?.message ?? 'Invalid.');
    const args = parsed.data;
    const auth = authorize(
      this.capabilities,
      this.holder(p.pid),
      'proc.spawn',
      `program:${args.program}`,
      this.tick,
    );
    if (!auth.ok) return this.fail(p, 'proc.spawn', 'EPERM', auth.reason);
    const program = this.programs.get(args.program);
    if (!program) return this.fail(p, 'proc.spawn', 'EINVAL', `Unknown program ${args.program}.`);
    if (args.budget.steps > p.budget.steps || args.budget.tokens > p.budget.tokens)
      return this.fail(
        p,
        'proc.spawn',
        'EBUDGET',
        'A child cannot receive more budget than its parent has left.',
      );
    const pid = this.ids.pid + 1;
    // Validate every delegation before committing any, so a rejected spawn leaves no trace.
    const scratch = structuredClone(this.capabilities);
    const delegated: string[] = [];
    try {
      for (const grant of args.delegate) {
        const parent = this.coveringCapability(scratch, this.holder(p.pid), grant);
        if (!parent)
          throw new CapabilityError(
            `Delegation cannot add authority: no held capability covers ${grant.rights} on ${grant.resource}.`,
          );
        const request = { id: this.nextCap(), holder: this.holder(pid), ...grant };
        delegated.push(
          derive(scratch, parent.id, { kind: 'process', id: String(p.pid) }, request, this.tick).id,
        );
      }
    } catch (error) {
      return this.fail(p, 'proc.spawn', 'EPERM', (error as Error).message);
    }
    this.capabilities = scratch;
    this.ids.pid = pid;
    p.budget.steps -= args.budget.steps;
    p.budget.tokens -= args.budget.tokens;
    this.processes.push(
      this.newProcess(
        pid,
        p.pid,
        program,
        { ...args, owner: p.owner, priority: args.priority ?? p.priority },
        args.budget,
        // A child can put at most what its parent could in front of a person.
        narrowEscalation(p.escalate, args.escalate),
      ),
    );
    // Parent and child may message each other; nobody else gains a channel.
    for (const [holder, target] of [
      [p.pid, pid],
      [pid, p.pid],
    ])
      mint(
        this.capabilities,
        {
          id: this.nextCap(),
          holder: this.holder(holder),
          rights: ['ipc.send'],
          resource: `proc:${target}`,
        },
        KERNEL,
      );
    this.log('process.spawned', pid, {
      parent: p.pid,
      program: args.program,
      capabilities: delegated,
      budget: args.budget,
    });
    p.last = { call: 'proc.spawn', ok: true, value: { pid } };
  }

  private ipcSend(p: Process, rawArgs: unknown) {
    const parsed = sendSchema.safeParse(rawArgs ?? {});
    if (!parsed.success || canonical(parsed.data.body).length > 4000)
      return this.fail(p, 'ipc.send', 'EINVAL', 'Messages need a numeric target and a small body.');
    const { to, body } = parsed.data;
    const auth = authorize(
      this.capabilities,
      this.holder(p.pid),
      'ipc.send',
      `proc:${to}`,
      this.tick,
    );
    if (!auth.ok) return this.fail(p, 'ipc.send', 'EPERM', auth.reason);
    const target = this.process(to);
    if (!target || target.state === 'exited')
      return this.fail(p, 'ipc.send', 'ESRCH', 'No such process.');
    if (!this.deliver(target, { from: p.pid, body, tick: this.tick }))
      return this.fail(p, 'ipc.send', 'EAGAIN', 'Mailbox full.');
    this.log('ipc.sent', p.pid, { to });
    p.last = { call: 'ipc.send', ok: true, value: { delivered: true } };
  }

  private ipcRecv(p: Process) {
    const envelope = p.mailbox.shift();
    if (envelope) {
      p.last = { call: 'ipc.recv', ok: true, value: envelope };
      return;
    }
    p.state = 'blocked';
    p.waiting = { on: 'message' };
  }

  private deliver(target: Process, envelope: Envelope) {
    if (target.state === 'blocked' && target.waiting?.on === 'message') {
      target.state = 'ready';
      target.waiting = undefined;
      target.last = { call: 'ipc.recv', ok: true, value: structuredClone(envelope) };
      return true;
    }
    if (target.mailbox.length >= MAILBOX_LIMIT) return false;
    target.mailbox.push(structuredClone(envelope));
    return true;
  }

  private revokeAll(ids: string[]) {
    const revoked = ids.flatMap((id) => revoke(this.capabilities, id));
    if (revoked.length) this.log('capability.revoked', null, { capabilities: revoked });
  }

  /** A process's authority dies with it, and children cannot outlive their parent. */
  private exit(
    p: Process,
    status: NonNullable<Process['exit']>['status'],
    value?: unknown,
    reason?: string,
  ) {
    if (p.state === 'exited') return;
    p.state = 'exited';
    p.waiting = undefined;
    p.exit = { status, value: structuredClone(value), reason };
    const cancelled = this.requests.filter((r) => r.pid === p.pid).map((r) => r.id);
    this.requests = this.requests.filter((r) => r.pid !== p.pid);
    this.log('process.exited', p.pid, { status, value, reason, cancelled });
    this.revokeAll(
      this.capabilities
        .filter((c) => c.holder === this.holder(p.pid) && !c.revoked)
        .map((c) => c.id),
    );
    for (const child of this.processes.filter((c) => c.ppid === p.pid))
      this.exit(child, 'killed', undefined, `Parent ${p.pid} exited.`);
    const parent = p.ppid === null ? undefined : this.process(p.ppid);
    if (parent && parent.state !== 'exited')
      this.deliver(parent, {
        from: p.pid,
        body: { exited: status, value, reason },
        tick: this.tick,
      });
  }

  kill(pid: number, by: Principal) {
    const p = this.process(pid);
    if (!p) throw new KernelError('No such process.');
    if (!(
      by.kind === 'operator' ||
      by.kind === 'kernel' ||
      (by.kind === 'user' && by.id === p.owner)
    ))
      throw new KernelError('Only the owner or an operator can kill this process.');
    this.exit(p, 'killed', undefined, `Killed by ${principalId(by)}.`);
  }

  revokeCapability(id: string, by: Principal) {
    const cap = this.capabilities.find((c) => c.id === id);
    if (!cap) throw new KernelError('Unknown capability.');
    if (!(
      by.kind === 'operator' ||
      by.kind === 'kernel' ||
      principalId(by) === principalId(cap.issuer)
    ))
      throw new KernelError('Only its issuer or an operator can revoke a capability.');
    this.revokeAll([id]);
  }

  /** A detached, serializable copy for inspection and rendering. */
  snapshot() {
    return structuredClone({
      tick: this.tick,
      world: this.world,
      processes: this.processes,
      capabilities: this.capabilities,
      requests: this.requests,
      journal: this.journal,
    });
  }
}
