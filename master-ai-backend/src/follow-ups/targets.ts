import { and, eq, sql } from 'drizzle-orm';
import type { ResolvedFollowUp, ResolvedPath } from '@onehuman/agent-kit';
import type { Tx } from '../db/db.service';
import { records, staff } from '../db/schema';
import { isUuid } from '../lists/format';

type StaffRow = typeof staff.$inferSelect;

/** A phone number's last ten digits: how the do-not-call list knows a number however it was typed. */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

/** The team member a name on an item means: an active person with that full name, or — when only a first name is given — the one active person with that first name. */
export function matchStaff(people: StaffRow[], name: string): StaffRow | null {
  const found = staffNamed(people, name);
  return found.length === 1 ? found[0]! : null;
}

/** Every active person a name could mean: those with that full name, or — when only a first name is given and no full name matches one person — those with that first name. */
export function staffNamed(people: StaffRow[], name: string): StaffRow[] {
  const want = name.trim().toLowerCase();
  if (!want) return [];
  const active = people.filter((p) => p.status === 'active');
  const full = active.filter((p) => p.name.trim().toLowerCase() === want);
  if (full.length === 1 || /\s/.test(want)) return full;
  const firstOf = (s: string) => s.trim().toLowerCase().split(/\s+/)[0];
  return active.filter((p) => firstOf(p.name) === firstOf(want));
}

const text = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));

/** The value at a path for an item: its own field, the field of the item a reference points at, or of the one record a lookup finds. */
export async function readPath(tx: Tx, workspaceId: string, path: ResolvedPath, data: Record<string, unknown>): Promise<string | null> {
  if (path.kind === 'field') return text(data[path.field.name]);
  if (path.kind === 'ref') {
    const id = data[path.ref.name];
    if (!isUuid(id)) return null;
    const [row] = await tx
      .select({ data: records.data })
      .from(records)
      .where(and(eq(records.id, id), eq(records.workspaceId, workspaceId), eq(records.entity, path.target.name)));
    return row ? text(row.data[path.field.name]) : null;
  }
  const value = text(data[path.value.name]);
  if (!value) return null;
  const rows = await tx
    .select({ data: records.data })
    .from(records)
    .where(and(eq(records.workspaceId, workspaceId), eq(records.entity, path.target.name), sql`lower(trim(${records.data}->>${path.match.name})) = lower(trim(${value}))`))
    .limit(2);
  return rows.length === 1 ? text(rows[0]!.data[path.field.name]) : null;
}

/** Who a party call asks for: the contact path's value, else the words a reference was given as. */
export async function contactName(tx: Tx, workspaceId: string, f: ResolvedFollowUp, data: Record<string, unknown>): Promise<string | null> {
  const name = f.contact ? await readPath(tx, workspaceId, f.contact, data) : null;
  if (name) return name;
  if (f.contact?.kind === 'ref') {
    const words = data[f.contact.ref.name];
    if (typeof words !== 'string') return null;
    const said = words.trim();
    return said && !isUuid(said) ? said : null;
  }
  return null;
}
