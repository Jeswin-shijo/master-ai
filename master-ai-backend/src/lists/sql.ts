import { sql, type SQL } from 'drizzle-orm';
import type { Condition, Conditions, EntityDef, EntityField } from '@onehuman/schemas';
import type { ListCheck, ResolvedRegister } from '@onehuman/agent-kit';
import { rangeDays, type ParsedListQuery } from './query';

/** "Today" and "now" in India time, fixed once per request so every query agrees. */
export interface SqlClock {
  today: string;
  now: Date;
}

const NUMERIC = new Set(['money', 'number', 'integer']);

// Every expression reads the row as `r`: the records table inside the CTE, the CTE (`flagged r`) outside it.
const text = (f: string) => sql`(r.data->>${f})`;
const blank = (f: string) => sql`(coalesce(r.data->>${f}, '') = '')`;
const num = (f: string) => sql`try_numeric(r.data->>${f})`;

/** A date or date-time field as an India-time calendar day. */
export function dayExpr(field: EntityField): SQL {
  return field.type === 'datetime'
    ? sql`(try_timestamptz(r.data->>${field.name}) at time zone 'Asia/Kolkata')::date`
    : sql`try_date(r.data->>${field.name})`;
}

export function conditionSql(entity: EntityDef, when: Conditions | undefined): SQL {
  const parts = Object.entries(when ?? {}).map(([name, cond]) => sql`(${conditionPart(entity.fields.find((f) => f.name === name), name, cond)})`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

function conditionPart(field: EntityField | undefined, name: string, cond: Condition): SQL {
  if (cond === 'filled') return sql`not ${blank(name)}`;
  if (cond === 'blank') return blank(name);
  if (Array.isArray(cond)) {
    const numeric = !!field && NUMERIC.has(field.type);
    return sql.join(
      cond.map((v) => (numeric && typeof v === 'number' ? sql`${num(name)} = ${v}` : sql`${text(name)} = ${String(v)}`)),
      sql` or `,
    );
  }
  return 'above' in cond ? sql`${num(name)} > ${cond.above}` : sql`${num(name)} < ${cond.below}`;
}

type Duplicate = Extract<ListCheck, { kind: 'duplicate' }>;

/** Items the duplicate check compares: meeting its `when`, with every key field filled. */
function eligible(check: Duplicate, entity: EntityDef): SQL {
  return sql`(${conditionSql(entity, check.when)}) and ${sql.join(check.fields.map((f) => sql`not ${blank(f.name)}`), sql` and `)}`;
}

function duplicateWindow(check: Duplicate, entity: EntityDef): SQL {
  return sql`partition by (${eligible(check, entity)}), ${sql.join(check.fields.map((f) => text(f.name)), sql`, `)}`;
}

/** True when the check finds a problem on row `r`; null (no answer) counts as no problem. */
function problemCore(check: ListCheck, entity: EntityDef, clock: SqlClock): SQL {
  switch (check.kind) {
    case 'missing':
      return check.field.type === 'boolean' ? sql`coalesce(${text(check.field.name)}, '') <> 'true'` : blank(check.field.name);
    case 'adds_up': {
      const present = sql.join([check.field, ...check.plus].map((f) => sql`${num(f.name)} is not null`), sql` and `);
      const plus = check.plus.length ? sql.join(check.plus.map((f) => num(f.name)), sql` + `) : sql`0`;
      const minus = check.minus.map((f) => sql` - coalesce(${num(f.name)}, 0)`);
      return sql`${present} and abs(${num(check.field.name)} - (${plus}${sql.join(minus, sql``)})) > ${check.tolerance}`;
    }
    case 'limit': {
      const first = check.fields[0]!;
      const above = check.max !== undefined;
      const bound = (above ? check.max : check.min)!;
      const op = sql.raw(above ? '>' : '<');
      if (first.type === 'date' && typeof bound !== 'number') return sql`${dayExpr(first)} ${op} ${dayExpr(bound)}`;
      const total = sql.join(check.fields.map((f) => num(f.name)), sql` + `);
      const limit = typeof bound === 'number' ? sql`${bound}::numeric` : sql`(${num(bound.name)} * ${check.factor}::numeric)`;
      return sql`(${total}) ${op} ${limit}`;
    }
    case 'duplicate':
      return sql`(${eligible(check, entity)}) and count(*) over (${duplicateWindow(check, entity)}) > 1`;
    case 'overdue':
      return check.field.type === 'datetime'
        ? sql`try_timestamptz(r.data->>${check.field.name}) + make_interval(days => ${check.graceDays}::int) < ${clock.now.toISOString()}::timestamptz`
        : sql`try_date(r.data->>${check.field.name}) + ${check.graceDays}::int < ${clock.today}::date`;
    case 'expiring':
      return check.field.type === 'datetime'
        ? sql`try_timestamptz(r.data->>${check.field.name}) <= ${clock.now.toISOString()}::timestamptz + make_interval(days => ${check.days}::int)`
        : sql`try_date(r.data->>${check.field.name}) <= ${clock.today}::date + ${check.days}::int`;
    case 'ref':
      return sql`not ${blank(check.field.name)} and not exists (select 1 from records t where t.workspace_id = r.workspace_id and t.entity = ${check.target.name} and t.id::text = r.data->>${check.field.name})`;
  }
}

/**
 * `with flagged as (…)`: every item of the list, each with p<i> (check i found a
 * problem) and, for a duplicate check, d<i>_min / d<i>_max (ids among the copies).
 * Window functions see the whole record type, so a duplicate is found even when
 * the other copy is filtered out of the page.
 */
export function flaggedCte(reg: ResolvedRegister, workspaceId: string, clock: SqlClock): SQL {
  const cols: SQL[] = [];
  reg.checks.forEach((c, i) => {
    cols.push(sql`coalesce((${conditionSql(reg.entity, c.when)}) and (${problemCore(c, reg.entity, clock)}), false) as ${sql.raw(`p${i}`)}`);
    if (c.kind === 'duplicate') {
      cols.push(sql`min(r.id::text) over (${duplicateWindow(c, reg.entity)}) as ${sql.raw(`d${i}_min`)}`);
      cols.push(sql`max(r.id::text) over (${duplicateWindow(c, reg.entity)}) as ${sql.raw(`d${i}_max`)}`);
    }
  });
  const extra = cols.length ? sql`, ${sql.join(cols, sql`, `)}` : sql``;
  return sql`with flagged as (select r.*${extra} from records r where r.workspace_id = ${workspaceId} and r.entity = ${reg.entity.name})`;
}

/** `r.id` and the flag columns, to read from `flagged r`. */
export function flagSelect(reg: ResolvedRegister): SQL {
  const names = reg.checks.flatMap((c, i) => (c.kind === 'duplicate' ? [`p${i}`, `d${i}_min`, `d${i}_max`] : [`p${i}`]));
  return sql.raw(['r.id', ...names.map((n) => `r.${n}`)].join(', '));
}

/** True when the item has a problem nobody has accepted. */
export function openProblems(reg: ResolvedRegister): SQL {
  if (!reg.checks.length) return sql`false`;
  return sql`(${sql.join(
    reg.checks.map((c, i) => sql`(r.${sql.raw(`p${i}`)} and not (${c.key}::text = any(r.checked_problems)))`),
    sql` or `,
  )})`;
}

/** Search: the values people see (not field names, not reference ids) or the title of a referenced item. */
function searchSql(reg: ResolvedRegister, q: string): SQL {
  const needle = sql`lower(${q}::text)`;
  const refs = reg.entity.fields.filter((f) => f.type === 'reference').map((f) => f.name);
  const skip = refs.length ? sql` and e.key not in (${sql.join(refs.map((n) => sql`${n}::text`), sql`, `)})` : sql``;
  const parts: SQL[] = [sql`exists (select 1 from jsonb_each_text(r.data) e where position(${needle} in lower(e.value)) > 0${skip})`];
  for (const c of reg.checks) {
    if (c.kind !== 'ref') continue;
    const title = c.target.title_field ?? c.target.fields.find((f) => f.type === 'string')?.name;
    if (!title) continue;
    parts.push(
      sql`exists (select 1 from records t where t.workspace_id = r.workspace_id and t.entity = ${c.target.name} and t.id::text = r.data->>${c.field.name} and position(${needle} in lower(coalesce(t.data->>${title}, ''))) > 0)`,
    );
  }
  return sql`(${sql.join(parts, sql` or `)})`;
}

export function whereSql(reg: ResolvedRegister, q: ParsedListQuery): SQL {
  const parts: SQL[] = [];
  if (q.dates && reg.dateField) parts.push(sql`${dayExpr(reg.dateField)} between ${q.dates.from}::date and ${q.dates.to}::date`);
  // position(), not ILIKE: % and _ in what someone types are searched for, not wildcards.
  if (q.q) parts.push(searchSql(reg, q.q));
  for (const f of q.filters) parts.push(sql`r.data->>${f.field.name} = ${f.value}`);
  if (q.source) parts.push(sql`r.source = ${q.source}`);
  if (q.show === 'problems') parts.push(openProblems(reg));
  if (q.show === 'not_checked') parts.push(sql`r.checked_at is null`);
  if (q.show === 'checked') parts.push(sql`r.checked_at is not null`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

export function orderSql(sort: ParsedListQuery['sort']): SQL {
  const dir = sql.raw(sort.dir === 'asc' ? 'asc' : 'desc');
  const f = sort.field;
  if (!f) return sql`r.updated_at ${dir}, r.id`;
  const key = NUMERIC.has(f.type)
    ? num(f.name)
    : f.type === 'date'
      ? sql`try_date(r.data->>${f.name})`
      : f.type === 'datetime'
        ? sql`try_timestamptz(r.data->>${f.name})`
        : sql`lower(r.data->>${f.name})`;
  return sql`${key} ${dir} nulls last, r.updated_at desc, r.id`;
}

export function totalsSelect(reg: ResolvedRegister, where: SQL): SQL {
  const sums = reg.totals.map((f, i) => sql`, sum(${num(f.name)}) as ${sql.raw(`t${i}`)}`);
  return sql`select count(*)::int as total${sql.join(sums, sql``)} from flagged r where ${where}`;
}

/** The card: its count (its `when`, else this month, else all), its sum, problems nobody accepted, items not checked. */
export function cardSelect(reg: ResolvedRegister, clock: SqlClock): SQL {
  const month = rangeDays('this_month', clock.today)!;
  const counted = reg.card?.count
    ? conditionSql(reg.entity, reg.card.count.when)
    : reg.dateField
      ? sql`${dayExpr(reg.dateField)} between ${month.from}::date and ${month.to}::date`
      : sql`true`;
  const sum = reg.card?.sum ? sql`sum(${num(reg.card.sum.field)}) filter (where ${conditionSql(reg.entity, reg.card.sum.when)})` : sql`null::numeric`;
  return sql`select count(*) filter (where ${counted})::int as count, ${sum} as sum,
    count(*) filter (where ${openProblems(reg)})::int as problems, count(*) filter (where r.checked_at is null)::int as not_checked
    from flagged r`;
}
