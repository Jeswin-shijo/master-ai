/**
 * Deterministic JSON: object keys sorted, no whitespace. Used for the audit
 * hash chain and for approval signatures, so client and server always sign and
 * hash exactly the same bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = sortKeys(v);
  }
  return out;
}

export type ApprovalDecisionKind = 'approved' | 'rejected' | 'edited';

export interface ApprovalSigningInput {
  approvalId: string;
  decision: ApprovalDecisionKind;
  editedArgs?: Record<string, unknown> | null;
  notes?: string | null;
  signedAt: string;
}

/** The exact message a device signs when its owner decides an approval. */
export function approvalSigningMessage(input: ApprovalSigningInput): string {
  return `onehuman-approval:v1:${canonicalJson({
    approvalId: input.approvalId,
    decision: input.decision,
    editedArgs: input.editedArgs ?? null,
    notes: input.notes ?? null,
    signedAt: input.signedAt,
  })}`;
}
