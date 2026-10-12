import type { CallRecord } from '@onehuman/schemas';
import type { calls, staff } from '../db/schema';

/** A call as the apps see it, whatever it was about (delegated work or a check-in). */
export function toCall(c: typeof calls.$inferSelect, person: typeof staff.$inferSelect, title: string, suggestions?: string[]): CallRecord {
  return {
    id: c.id,
    delegationId: c.delegationId,
    checkinId: c.checkinId,
    staffId: c.staffId,
    staffName: person.name,
    staffTitle: person.title,
    stage: c.stage,
    attempt: c.attempt,
    status: c.status,
    provider: c.provider,
    scheduledFor: c.scheduledFor.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSec: c.startedAt && c.endedAt ? Math.round((c.endedAt.getTime() - c.startedAt.getTime()) / 1000) : null,
    transcript: c.transcript,
    summary: c.summary,
    outcome: c.outcome,
    extracted: c.extracted,
    delegationTitle: title,
    ...(suggestions?.length && { suggestions }),
    createdAt: c.createdAt.toISOString(),
  };
}
