import type { Href } from 'expo-router';

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Where a tapped push opens: a list item, a case or a decision. Anything else just opens the app. */
export function pushTarget(data: unknown): Href | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (text(d.listId) && text(d.itemId)) return { pathname: '/list/[id]/[itemId]', params: { id: d.listId, itemId: d.itemId } };
  if (text(d.caseId)) return { pathname: '/case/[id]', params: { id: d.caseId } };
  if (text(d.approvalId)) return { pathname: '/approval/[id]', params: { id: d.approvalId } };
  return null;
}
