import { z } from 'zod';
import { authorize, consume, mint, type Capability, type Principal } from '../os/capability';

export const actionSchema = z
  .object({
    tool: z.enum([
      'orders.lookup',
      'knowledge.search',
      'refunds.request',
      'replacements.request',
      'handoff.create',
      'respond',
    ]),
    orderId: z.string().max(30),
    query: z.string().max(300),
    reply: z.string().max(1600),
  })
  .strict();
export type Action = z.infer<typeof actionSchema>;
export const actionJSONSchema = z.toJSONSchema(actionSchema);
export function schemaForTools(allowedTools: Action['tool'][], orderIds: string[] = []) {
  return {
    ...actionJSONSchema,
    properties: {
      ...actionJSONSchema.properties,
      tool: { type: 'string', enum: allowedTools },
      ...(orderIds.length ? { orderId: { type: 'string', enum: orderIds } } : {}),
    },
  };
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface Completion {
  content: string;
  tokens: number;
  milliseconds: number;
}
export interface Model {
  name: string;
  complete(
    messages: ChatMessage[],
    signal: AbortSignal,
    allowedTools: Action['tool'][],
    orderIds: string[],
  ): Promise<Completion>;
  interrupt(): void;
}
export interface Order {
  id: string;
  product: string;
  amountCents: number;
  ageDays: number;
  status: 'delivered' | 'in_transit';
  refunded: boolean;
  replacement: boolean;
}
export interface Receipt {
  id: string;
  orderId: string;
  kind: 'refund' | 'replacement' | 'handoff';
  amountCents: number;
  at: string;
  /** The customer-granted capability that authorized this change. */
  capability?: string;
}
export interface Trace {
  id: string;
  at: string;
  kind: 'model' | 'tool' | 'policy' | 'customer' | 'operator' | 'error';
  name: string;
  input: unknown;
  output: unknown;
  milliseconds: number;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  sources?: string[];
}

export function unsupportedNumbers(reply: string, evidence: unknown[]): number[] {
  const numbers = (text: string) =>
    (text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const supported = new Set(numbers(JSON.stringify(evidence)));
  return [...new Set(numbers(reply).filter((value) => !supported.has(value)))];
}
export interface Pending {
  id: string;
  action: Action;
  amountCents: number;
  createdAt: string;
  /** Capability the customer granted; revoked if the operator rejects. */
  capability?: string;
}
/** A model-proposed change waiting for the customer to authorize it. */
export interface Consent {
  id: string;
  action: Action;
  amountCents: number;
  createdAt: string;
}
export interface Session {
  id: string;
  createdAt: string;
  messages: Message[];
  traces: Trace[];
  orders: Order[];
  receipts: Receipt[];
  pending?: Pending;
  consent?: Consent;
  /** Authority granted to this session's agent. Absent in sessions saved before consent existed. */
  capabilities?: Capability[];
  tokens: number;
  model?: string;
}
export interface SessionStore {
  read(): Promise<Session>;
  update(change: (session: Session) => void): Promise<Session>;
}
export const policies = [
  {
    id: 'REF-01',
    title: 'Refunds',
    text: 'Full refunds are available for delivered orders within 30 days. Up to $100 can be processed automatically. Above $100 through $500 requires operator approval. Above $500 is blocked. Already-refunded orders cannot be refunded again. Amounts always come from the order record.',
  },
  {
    id: 'SHP-02',
    title: 'Replacements',
    text: 'Damaged delivered orders within 30 days may receive one replacement after operator approval. Refunded orders and orders already replaced are ineligible. No replacement can be shipped by this demo; it records a fulfillment request.',
  },
  {
    id: 'HUM-03',
    title: 'Human handoff',
    text: 'Account access, exceptions, and requests outside these policies can be assigned to a human by creating a support ticket. Do not change credentials or invent an exception.',
  },
];
export function newSession(): Session {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    messages: [],
    traces: [],
    receipts: [],
    tokens: 0,
    orders: [
      {
        id: 'R-1042',
        product: 'Studio cable',
        amountCents: 4900,
        ageDays: 4,
        status: 'delivered',
        refunded: false,
        replacement: false,
      },
      {
        id: 'R-1043',
        product: 'Field headphones',
        amountCents: 24900,
        ageDays: 12,
        status: 'delivered',
        refunded: false,
        replacement: false,
      },
      {
        id: 'R-1044',
        product: 'Reference amplifier',
        amountCents: 75000,
        ageDays: 8,
        status: 'delivered',
        refunded: false,
        replacement: false,
      },
      {
        id: 'R-1045',
        product: 'Travel speaker',
        amountCents: 8900,
        ageDays: 46,
        status: 'delivered',
        refunded: false,
        replacement: false,
      },
    ],
  };
}
export const dollars = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);

export function searchPolicies(query: string) {
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  const scored = policies.map((policy) => ({
    ...policy,
    score: words.filter((w) => `${policy.title} ${policy.text}`.toLowerCase().includes(w)).length,
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, 2);
}

export function checkAction(
  action: Action,
  session: Session,
): {
  decision: 'allow' | 'review' | 'deny';
  explanation: string;
  amountCents: number;
  policy: string;
} {
  const order = session.orders.find((o) => o.id === action.orderId);
  const policy = action.tool === 'refunds.request' ? 'REF-01' : 'SHP-02';
  const deny = (explanation: string) => ({
    decision: 'deny' as const,
    explanation,
    amountCents: 0,
    policy,
  });
  if (!order) return deny('Order does not exist in this session.');
  if (!['refunds.request', 'replacements.request'].includes(action.tool))
    return deny('This tool cannot mutate an order.');
  if (
    !Number.isSafeInteger(order.amountCents) ||
    order.amountCents <= 0 ||
    !Number.isFinite(order.ageDays) ||
    order.ageDays < 0
  )
    return deny('The order record is invalid; operator review is required.');
  if (order.refunded || order.replacement)
    return deny('This order already has a resolution. A second action is blocked.');
  if (order.ageDays > 30 || order.status !== 'delivered')
    return deny('Only delivered orders within 30 days are eligible.');
  if (action.tool === 'refunds.request') {
    if (order.amountCents > 50000)
      return deny('The refund exceeds the $500 hard limit. Human approval cannot override it.');
    return {
      decision: order.amountCents > 10000 ? 'review' : 'allow',
      explanation:
        order.amountCents > 10000
          ? 'Refunds above $100 require operator approval.'
          : 'Refund is eligible for automatic processing.',
      amountCents: order.amountCents,
      policy,
    };
  }
  return {
    decision: 'review',
    explanation: 'Every replacement requires operator approval.',
    amountCents: 0,
    policy,
  };
}

export const AGENT = 'agent';
export const CUSTOMER: Principal = { kind: 'user', id: 'customer' };
export const orderResource = (orderId: string) => `order:${orderId}`;

/**
 * The customer's confirmation becomes a single-use capability for exactly this tool and order.
 * The model can select a tool, but only the customer can mint the authority to use it.
 */
export function grantConsent(session: Session, action: Action): Capability {
  session.capabilities ??= [];
  return mint(
    session.capabilities,
    {
      id: crypto.randomUUID(),
      holder: AGENT,
      rights: [action.tool],
      resource: orderResource(action.orderId),
      uses: 1,
    },
    CUSTOMER,
  );
}
export function customerGrant(session: Session, action: Action) {
  return authorize(
    session.capabilities ?? [],
    AGENT,
    action.tool,
    orderResource(action.orderId),
    Date.now(),
  );
}

// Called inside the store's write transaction. Eligibility is rechecked at commit time, and the
// change must be covered by a customer-granted capability, which it spends.
export function commitAction(session: Session, action: Action, approved: boolean): Receipt {
  const check = checkAction(action, session);
  if (check.decision === 'deny' || (check.decision === 'review' && !approved))
    throw new Error(check.explanation);
  const grant = customerGrant(session, action);
  if (!grant.ok)
    throw new Error('The customer has not authorized this change. No record was changed.');
  consume(session.capabilities!, grant.capability.id);
  const order = session.orders.find((o) => o.id === action.orderId)!;
  const receipt: Receipt = {
    id: crypto.randomUUID(),
    orderId: order.id,
    kind: action.tool === 'refunds.request' ? 'refund' : 'replacement',
    amountCents: check.amountCents,
    at: new Date().toISOString(),
    capability: grant.capability.id,
  };
  if (receipt.kind === 'refund') order.refunded = true;
  else order.replacement = true;
  session.receipts.push(receipt);
  return receipt;
}
