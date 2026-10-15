import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { EntityDef } from '@onehuman/schemas';
import { registersOf } from '@onehuman/agent-kit';
import { dueSql } from '../../../src/lists/sql';

const Bill: EntityDef = {
  name: 'Bill',
  label: 'Bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'validTill', label: 'Valid till', type: 'datetime', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
  ],
};
const followUp = (due: object, when?: object) =>
  registersOf({
    entities: [Bill],
    registers: [{ id: 'bills', entity: 'Bill', main: true, checks: [], follow_ups: [{ id: 'f', label: 'F', who: 'party', due, when, phone: { field: 'phone' }, contact: { field: 'billNo' }, about: ['billNo'], find_out: [], max_tries: 3 } as never] }],
  })[0]!.followUps[0]!;
const clock = { today: '2026-10-15', now: new Date('2026-10-15T06:00:00Z') };
const compile = (f: ReturnType<typeof followUp>) => new PgDialect().sqlToQuery(dueSql(f, Bill, clock));

describe('which items a follow-up is due to call about', () => {
  it("uses the overdue rule and the follow-up's conditions, as the list's checks do", () => {
    const q = compile(followUp({ overdue: { date: 'dueDate', grace_days: 2 } }, { paymentStatus: ['unpaid'] }));
    expect(q.sql).toBe('(((r.data->>$1) = $2)) and coalesce((try_date(r.data->>$3) + $4::int < $5::date), false)');
    expect(q.params).toEqual(['paymentStatus', 'unpaid', 'dueDate', 2, '2026-10-15']);
  });

  it('uses the expiring rule on a date-time, in India time', () => {
    const q = compile(followUp({ expiring: { date: 'validTill', days: 7 } }));
    expect(q.sql).toBe('(true) and coalesce((try_timestamptz(r.data->>$1) <= $2::timestamptz + make_interval(days => $3::int)), false)');
    expect(q.params).toEqual(['validTill', '2026-10-15T06:00:00.000Z', 7]);
  });
});
