// Capabilities are the only source of authority in Relay. A model-driven process can propose any
// call, but a call only executes when the caller holds a capability that names the operation and
// covers the resource. Processes can narrow what they hold and hand it on; they can never mint.

export type PrincipalKind = 'kernel' | 'user' | 'operator' | 'process';
export interface Principal {
  kind: PrincipalKind;
  id: string;
}
export const principalId = (p: Principal) => `${p.kind}:${p.id}`;

export interface Capability {
  id: string;
  /** Subject allowed to exercise it, such as `process:3` or `user:alice`. */
  holder: string;
  /** Operation names, e.g. `refund.issue`. */
  rights: string[];
  /** An exact resource (`order:R-1042`) or a prefix pattern ending in `*` (`order:*`). */
  resource: string;
  issuer: Principal;
  /** The capability this one was attenuated from, if any. */
  parent?: string;
  /** Remaining uses; `null` means unlimited. */
  uses: number | null;
  /** Logical time after which it is invalid; `null` means no expiry. */
  expiresAt: number | null;
  revoked: boolean;
}

export class CapabilityError extends Error {}

const MINTERS: PrincipalKind[] = ['kernel', 'user', 'operator'];

export function covers(pattern: string, resource: string) {
  return pattern.endsWith('*') ? resource.startsWith(pattern.slice(0, -1)) : pattern === resource;
}
/** True when every resource matched by `child` is also matched by `parent`. */
export function narrows(child: string, parent: string) {
  if (!parent.endsWith('*')) return child === parent;
  return child.startsWith(parent.slice(0, -1));
}

export function isLive(table: Capability[], cap: Capability, now: number): boolean {
  if (cap.revoked || cap.uses === 0) return false;
  if (cap.expiresAt !== null && now >= cap.expiresAt) return false;
  // A derived capability dies with any revoked ancestor. Spent ancestors do not matter: their
  // uses were carved into this capability when it was delegated.
  for (let id = cap.parent; id;) {
    const ancestor = table.find((c) => c.id === id);
    if (!ancestor || ancestor.revoked) return false;
    id = ancestor.parent;
  }
  return true;
}

export interface MintRequest {
  id: string;
  holder: string;
  rights: string[];
  resource: string;
  uses?: number | null;
  expiresAt?: number | null;
}
function checkShape(r: MintRequest) {
  if (!r.rights.length) throw new CapabilityError('A capability must name at least one right.');
  if (r.uses !== undefined && r.uses !== null && (!Number.isSafeInteger(r.uses) || r.uses < 1))
    throw new CapabilityError('Uses must be a positive integer or unlimited.');
  const star = r.resource.indexOf('*');
  if (!r.resource || (star !== -1 && star !== r.resource.length - 1))
    throw new CapabilityError('Only a single trailing * is allowed in a resource pattern.');
}

/** Only trusted principals mint new authority. */
export function mint(table: Capability[], request: MintRequest, issuer: Principal): Capability {
  if (!MINTERS.includes(issuer.kind))
    throw new CapabilityError(
      'Processes cannot mint capabilities; they can only narrow ones they hold.',
    );
  checkShape(request);
  if (table.some((c) => c.id === request.id)) throw new CapabilityError('Duplicate capability ID.');
  const cap: Capability = {
    id: request.id,
    holder: request.holder,
    rights: [...new Set(request.rights)],
    resource: request.resource,
    issuer,
    uses: request.uses ?? null,
    expiresAt: request.expiresAt ?? null,
    revoked: false,
  };
  table.push(cap);
  return cap;
}

/**
 * Delegation with attenuation: the child can only ever be narrower than its parent. Use-limited
 * authority is carved out of the parent, so delegating cannot multiply the number of uses.
 */
export function derive(
  table: Capability[],
  parentId: string,
  delegator: Principal,
  request: MintRequest,
  now: number,
): Capability {
  const parent = table.find((c) => c.id === parentId);
  if (!parent || parent.holder !== principalId(delegator))
    throw new CapabilityError('The delegator does not hold that capability.');
  if (!isLive(table, parent, now))
    throw new CapabilityError('The parent capability is no longer valid.');
  checkShape(request);
  if (table.some((c) => c.id === request.id)) throw new CapabilityError('Duplicate capability ID.');
  if (!request.rights.every((r) => parent.rights.includes(r)))
    throw new CapabilityError('Delegation cannot add rights.');
  if (!narrows(request.resource, parent.resource))
    throw new CapabilityError('Delegation cannot widen the resource.');
  const uses = request.uses === undefined ? parent.uses : request.uses;
  if (parent.uses !== null && (uses === null || uses > parent.uses))
    throw new CapabilityError('Delegation cannot add uses.');
  const expiresAt = request.expiresAt === undefined ? parent.expiresAt : request.expiresAt;
  if (parent.expiresAt !== null && (expiresAt === null || expiresAt > parent.expiresAt))
    throw new CapabilityError('Delegation cannot extend expiry.');
  if (parent.uses !== null && uses !== null) parent.uses -= uses;
  const cap: Capability = {
    id: request.id,
    holder: request.holder,
    rights: [...new Set(request.rights)],
    resource: request.resource,
    issuer: delegator,
    parent: parent.id,
    uses,
    expiresAt,
    revoked: false,
  };
  table.push(cap);
  return cap;
}

export type Authorization = { ok: true; capability: Capability } | { ok: false; reason: string };

/** Finds the narrowest live capability that lets `holder` perform `right` on `resource`. */
export function authorize(
  table: Capability[],
  holder: string,
  right: string,
  resource: string,
  now: number,
): Authorization {
  if (resource.includes('*')) return { ok: false, reason: 'A concrete resource is required.' };
  const candidates = table.filter(
    (c) =>
      c.holder === holder &&
      c.rights.includes(right) &&
      covers(c.resource, resource) &&
      isLive(table, c, now),
  );
  if (!candidates.length)
    return { ok: false, reason: `${holder} holds no capability for ${right} on ${resource}.` };
  // Spend exact, use-limited grants before broad standing ones.
  const rank = (c: Capability) => (c.resource.endsWith('*') ? 2 : 0) + (c.uses === null ? 1 : 0);
  candidates.sort((a, b) => rank(a) - rank(b));
  return { ok: true, capability: candidates[0] };
}

export function consume(table: Capability[], id: string) {
  const cap = table.find((c) => c.id === id);
  if (!cap) throw new CapabilityError('Unknown capability.');
  if (cap.uses === 0 || cap.revoked) throw new CapabilityError('Capability already spent.');
  if (cap.uses !== null) cap.uses -= 1;
}

/** Revocation cascades to everything delegated from the capability. Returns revoked IDs. */
export function revoke(table: Capability[], id: string): string[] {
  const revoked: string[] = [];
  const visit = (capId: string) => {
    const cap = table.find((c) => c.id === capId);
    if (!cap) return;
    if (!cap.revoked) {
      cap.revoked = true;
      revoked.push(cap.id);
    }
    table.filter((c) => c.parent === capId).forEach((c) => visit(c.id));
  };
  visit(id);
  return revoked;
}
