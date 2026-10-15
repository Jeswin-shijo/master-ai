import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NoteKind } from '@onehuman/schemas';
import { normalizeSnapshot, registersOf, titleOf } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { requireManager, type Session } from '../common/auth';
import { isUuid } from '../lists/format';
import { DbService, type Tx } from '../db/db.service';
import { doNotCall, followUpAttempts, recordNotes, records } from '../db/schema';
import { RecordsService } from '../records/records.service';
import { istDate } from '../voice/time';

export interface NewNote {
  recordId: string;
  callId: string | null;
  /** The follow-up (`<list>.<id>`) the call was for; null for collection calls. */
  followUp: string | null;
  kind: NoteKind;
  speaker: string;
  said: string;
  proposed?: Record<string, unknown>;
  promiseOn?: string | null;
}

type NoteRow = typeof recordNotes.$inferSelect;

/**
 * Notes calls leave on list items. What an outside party says is never applied
 * by itself: the head applies a note (its proposed fields go through
 * RecordsService.update) or dismisses it. Either way, a follow-up that was
 * waiting for the head starts again the next day. A follow-up that stopped
 * (nobody to reach, or a wrong number) starts again only when the head says
 * "Call again".
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
  ) {}

  /** Adds a note inside the caller's transaction. */
  async create(tx: Tx, tenantId: string, note: NewNote): Promise<string> {
    const [row] = await tx
      .insert(recordNotes)
      .values({
        tenantId,
        recordId: note.recordId,
        callId: note.callId,
        followUp: note.followUp,
        kind: note.kind,
        speaker: note.speaker,
        said: note.said,
        proposed: note.proposed ?? {},
        promiseOn: note.promiseOn ?? null,
      })
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'note.created',
      actor: SYSTEM,
      refId: note.recordId,
      payload: { noteId: row!.id, kind: note.kind, speaker: note.speaker, title: await this.title(tx, note.recordId) },
    });
    return row!.id;
  }

  async apply(session: Session, noteId: string): Promise<{ applied: true }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const { note, rec } = await this.open(tx, noteId);
      if (Object.keys(note.proposed).length === 0) throw new BadRequestException('This note has nothing to apply. Mark it as seen instead.');
      const ws = await this.records.activeWorkspace(tx);
      await this.records.update(tx, session.tenantId, ws, rec.entity, rec.id, note.proposed, {
        actor: { id: session.principalId, kind: 'human' },
        via: 'manual',
        ref: note.id,
        note: `From the call: "${note.said}"`,
        checkedBy: session.principalId,
      });
      await this.decide(tx, session, note, 'applied');
      return { applied: true as const };
    });
  }

  async dismiss(session: Session, noteId: string): Promise<{ dismissed: true }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const { note } = await this.open(tx, noteId);
      await this.decide(tx, session, note, 'dismissed');
      return { dismissed: true as const };
    });
  }

  /**
   * "Call again" on a note saying a follow-up stopped: the item is due today
   * with its tries reset, and a wrong-number block the call put on the number
   * is lifted. Owner only for calls to outside parties, as for the switch.
   */
  async callAgain(session: Session, noteId: string): Promise<{ restarted: true }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      if (!isUuid(noteId)) throw new NotFoundException('Note not found');
      const [note] = await tx.select().from(recordNotes).where(eq(recordNotes.id, noteId)).for('update');
      if (!note) throw new NotFoundException('Note not found');
      if (note.kind !== 'unreachable' && note.kind !== 'wrong_number') throw new BadRequestException('Call again is only for a follow-up that stopped: nobody to reach, or a wrong number.');
      if (!note.followUp) throw new BadRequestException('This note is not from a follow-up, so there is no call to start again.');
      const ws = await this.records.activeWorkspace(tx);
      const f = registersOf(normalizeSnapshot(ws.pack))
        .flatMap((r) => r.followUps)
        .find((x) => x.key === note.followUp);
      if (!f) throw new BadRequestException('This follow-up is no longer in your setup.');
      if (f.who === 'party' && session.role !== 'owner') throw new ForbiddenException('Only the owner can start calls to customers and suppliers again');
      requireManager(session);

      if (note.status === 'new') await this.decide(tx, session, note, 'dismissed');
      const today = istDate();
      await tx
        .insert(followUpAttempts)
        .values({ tenantId: session.tenantId, recordId: note.recordId, followUp: note.followUp, nextDueOn: today, state: 'active', tries: 0 })
        .onConflictDoUpdate({ target: [followUpAttempts.recordId, followUpAttempts.followUp], set: { state: 'active', tries: 0, nextDueOn: today } });
      const lifted =
        note.kind === 'wrong_number'
          ? await tx
              .delete(doNotCall)
              .where(and(eq(doNotCall.reason, 'wrong_number'), note.callId ? eq(doNotCall.callId, note.callId) : eq(doNotCall.recordId, note.recordId)))
              .returning({ id: doNotCall.id })
          : [];
      await this.audit.append(tx, session.tenantId, {
        type: 'followup.restarted',
        actor: { id: session.principalId, kind: 'human' },
        refId: note.recordId,
        payload: { title: await this.title(tx, note.recordId), unblocked: lifted.length > 0 },
      });
      return { restarted: true as const };
    });
  }

  private async open(tx: Tx, noteId: string): Promise<{ note: NoteRow; rec: typeof records.$inferSelect }> {
    if (!isUuid(noteId)) throw new NotFoundException('Note not found');
    const [row] = await tx.select({ note: recordNotes, rec: records }).from(recordNotes).innerJoin(records, eq(records.id, recordNotes.recordId)).where(eq(recordNotes.id, noteId)).for('update');
    if (!row) throw new NotFoundException('Note not found');
    if (row.note.status !== 'new') throw new ConflictException('This note was already handled');
    return row;
  }

  private async decide(tx: Tx, session: Session, note: NoteRow, status: 'applied' | 'dismissed') {
    await tx.update(recordNotes).set({ status, decidedBy: session.principalId, decidedAt: new Date() }).where(eq(recordNotes.id, note.id));
    if (note.followUp) {
      await tx
        .update(followUpAttempts)
        .set({ state: 'active', nextDueOn: istDate(new Date(Date.now() + 86_400_000)) })
        .where(and(eq(followUpAttempts.recordId, note.recordId), eq(followUpAttempts.followUp, note.followUp), eq(followUpAttempts.state, 'waiting_for_you')));
    }
    await this.audit.append(tx, session.tenantId, {
      type: status === 'applied' ? 'note.applied' : 'note.dismissed',
      actor: { id: session.principalId, kind: 'human' },
      refId: note.recordId,
      payload: { noteId: note.id, kind: note.kind, title: await this.title(tx, note.recordId) },
    });
  }

  private async title(tx: Tx, recordId: string): Promise<string> {
    const [rec] = await tx.select().from(records).where(eq(records.id, recordId));
    if (!rec) return 'an item';
    const ws = await this.records.activeWorkspace(tx);
    const entity = normalizeSnapshot(ws.pack).entities.find((e) => e.name === rec.entity);
    return entity ? titleOf(entity, rec.data) : rec.entity;
  }
}
