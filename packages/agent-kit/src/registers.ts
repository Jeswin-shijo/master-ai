import type { Check, Collect, Conditions, ContactPath, EntityDef, EntityField, FieldType, FollowUp, Register, ResolvedPack, RoutineTemplate } from '@onehuman/schemas';
import { pluralize } from './pack';

const NUMBERS: FieldType[] = ['money', 'number', 'integer'];
const DATES: FieldType[] = ['date', 'datetime'];
const FILTERABLE: FieldType[] = ['enum', 'boolean', 'reference'];

interface CheckBase {
  /** Tells this problem apart from the others, stable when the pack reorders its checks. */
  key: string;
  when?: Conditions;
  why?: string;
}

/** One problem a list looks for: a pack check (one per field for `missing`), or the built-in check that a reference points at a real item. */
export type ListCheck =
  | (CheckBase & { kind: 'missing'; field: EntityField })
  | (CheckBase & { kind: 'adds_up'; field: EntityField; plus: EntityField[]; minus: EntityField[]; tolerance: number })
  | (CheckBase & { kind: 'limit'; fields: EntityField[]; max?: EntityField | number; min?: EntityField | number; factor: number })
  | (CheckBase & { kind: 'duplicate'; fields: EntityField[] })
  | (CheckBase & { kind: 'overdue'; field: EntityField; graceDays: number })
  | (CheckBase & { kind: 'expiring'; field: EntityField; days: number })
  | (CheckBase & { kind: 'ref'; field: EntityField; target: EntityDef });

/** Where a call reads a phone number or a name, resolved against the pack's record types. */
export type ResolvedPath =
  | { kind: 'field'; field: EntityField }
  | { kind: 'ref'; ref: EntityField; target: EntityDef; field: EntityField }
  | { kind: 'lookup'; target: EntityDef; match: EntityField; value: EntityField; field: EntityField };

export interface ResolvedFollowUp {
  /** `<list>.<follow-up>`: unique in the workspace. Switches, attempts and calls use it. */
  key: string;
  id: string;
  registerId: string;
  label: string;
  who: 'party' | 'staff';
  /** When an item is due: the same overdue or expiring rule the list's checks use. */
  due: Extract<ListCheck, { kind: 'overdue' | 'expiring' }>;
  when?: Conditions;
  phone: ResolvedPath | null;
  contact: ResolvedPath | null;
  staffField: EntityField | null;
  about: EntityField[];
  findOut: EntityField[];
  everyDays: number;
  maxTries: number;
  hours: { start: string; end: string } | null;
}

export interface ResolvedRegister {
  id: string;
  label: string;
  /** A card on the Lists page; the rest are under "Other lists". */
  main: boolean;
  /** Defined by the pack; false for a record type's default list. */
  explicit: boolean;
  entity: EntityDef;
  columns: EntityField[];
  filters: EntityField[];
  dateField: EntityField | null;
  /** A null field sorts by last change. */
  sort: { field: EntityField | null; dir: 'asc' | 'desc' };
  totals: EntityField[];
  card: Register['card'];
  checks: ListCheck[];
  followUps: ResolvedFollowUp[];
}

/** The id of a record type's default list: CashlessRequest → cashless-request. */
export function defaultRegisterId(entityName: string): string {
  return entityName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** An item's title: its title field, else its first text field, else the record type's name. */
export function titleOf(entity: EntityDef, data: Record<string, unknown>): string {
  const name = entity.title_field ?? entity.fields.find((f) => f.type === 'string')?.name;
  const value = name ? data[name] : undefined;
  return value === undefined || value === null || value === '' ? entity.label : String(value);
}

/** Keys that tell a check's problems apart: kind and fields. */
export function checkKeys(check: Check): string[] {
  if ('missing' in check) return check.missing.map((f) => `missing:${f}`);
  if ('adds_up' in check) return [`adds_up:${check.adds_up.field}`];
  if ('limit' in check) {
    const l = check.limit;
    return [`limit:${l.fields.join('+')}${l.max !== undefined ? `<=${l.max}` : `>=${l.min}`}`];
  }
  if ('duplicate' in check) return [`duplicate:${check.duplicate.join(',')}`];
  if ('overdue' in check) return [`overdue:${check.overdue.date}`];
  return [`expiring:${check.expiring.date}`];
}

/**
 * Every list a workspace has: the pack's registers, then a default list for
 * each record type no register covers. Lenient on purpose: a field a stored
 * snapshot no longer has is left out rather than failing (validateRegisters
 * reports it when a pack is checked).
 */
export function registersOf(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): ResolvedRegister[] {
  const out: ResolvedRegister[] = [];
  const covered = new Set<string>();
  for (const r of pack.registers ?? []) {
    const entity = pack.entities.find((e) => e.name === r.entity);
    if (!entity) continue;
    covered.add(entity.name);
    out.push(resolveRegister(r, entity, pack.entities, true));
  }
  for (const e of pack.entities) {
    if (covered.has(e.name)) continue;
    out.push(resolveRegister({ id: defaultRegisterId(e.name), entity: e.name, main: false, checks: [] }, e, pack.entities, false));
  }
  return out;
}

function resolveRegister(r: Register, entity: EntityDef, entities: EntityDef[], explicit: boolean): ResolvedRegister {
  const byName = (name: string) => entity.fields.find((f) => f.name === name);
  const pick = (names: string[]) => names.map(byName).filter((f): f is EntityField => !!f);
  const dateField =
    r.date_field !== undefined ? (byName(r.date_field) ?? null) : explicit ? null : (entity.fields.find((f) => DATES.includes(f.type)) ?? null);
  return {
    id: r.id,
    label: r.label ?? entity.plural_label ?? pluralize(entity.label),
    main: r.main,
    explicit,
    entity,
    columns: pick(r.columns ?? entity.list_columns ?? entity.fields.slice(0, 5).map((f) => f.name)),
    filters: r.filters ? pick(r.filters) : entity.fields.filter((f) => FILTERABLE.includes(f.type)).slice(0, 4),
    dateField,
    sort: { field: r.sort ? (byName(r.sort.field) ?? null) : dateField, dir: r.sort?.dir ?? 'desc' },
    totals: r.totals ? pick(r.totals) : explicit ? [] : entity.fields.filter((f) => f.type === 'money'),
    card: r.card,
    checks: expandChecks(r.checks, entity, entities),
    followUps: resolveFollowUps(r, entity, entities),
  };
}

function expandChecks(checks: Check[], entity: EntityDef, entities: EntityDef[]): ListCheck[] {
  const byName = (name: string) => entity.fields.find((f) => f.name === name);
  const all = (names: string[]) => {
    const found = names.map(byName);
    return found.every(Boolean) ? (found as EntityField[]) : null;
  };
  const out: ListCheck[] = [];
  for (const c of checks) {
    const extras = { ...(c.when && { when: c.when }), ...(c.why && { why: c.why }) };
    const key = checkKeys(c)[0]!;
    if ('missing' in c) {
      for (const name of c.missing) {
        const field = byName(name);
        if (field) out.push({ kind: 'missing', key: `missing:${name}`, field, ...extras });
      }
    } else if ('adds_up' in c) {
      const field = byName(c.adds_up.field);
      const plus = all(c.adds_up.plus);
      const minus = all(c.adds_up.minus);
      if (field && plus && minus) out.push({ kind: 'adds_up', key, field, plus, minus, tolerance: c.adds_up.tolerance, ...extras });
    } else if ('limit' in c) {
      const fields = all(c.limit.fields);
      const bound = (b: string | number | undefined) => (typeof b === 'string' ? byName(b) : b);
      const max = bound(c.limit.max);
      const min = bound(c.limit.min);
      if (fields && (max !== undefined || min !== undefined)) {
        out.push({ kind: 'limit', key, fields, ...(max !== undefined && { max }), ...(min !== undefined && { min }), factor: c.limit.factor, ...extras });
      }
    } else if ('duplicate' in c) {
      const fields = all(c.duplicate);
      if (fields) out.push({ kind: 'duplicate', key, fields, ...extras });
    } else if ('overdue' in c) {
      const field = byName(c.overdue.date);
      if (field) out.push({ kind: 'overdue', key, field, graceDays: c.overdue.grace_days, ...extras });
    } else {
      const field = byName(c.expiring.date);
      if (field) out.push({ kind: 'expiring', key, field, days: c.expiring.days, ...extras });
    }
  }
  for (const field of entity.fields) {
    const target = field.type === 'reference' && field.ref ? entities.find((e) => e.name === field.ref) : undefined;
    if (target) out.push({ kind: 'ref', key: `ref:${field.name}`, field, target });
  }
  return out;
}

/** A path against the pack, or null when a part of it is missing (a stored snapshot may lack a field). */
export function resolvePath(p: ContactPath, entity: EntityDef, entities: EntityDef[]): ResolvedPath | null {
  const own = (n: string) => entity.fields.find((f) => f.name === n);
  if ('lookup' in p) {
    const target = entities.find((e) => e.name === p.lookup);
    const match = target?.fields.find((f) => f.name === p.match);
    const field = target?.fields.find((f) => f.name === p.field);
    const value = own(p.value);
    return target && match && field && value ? { kind: 'lookup', target, match, value, field } : null;
  }
  if ('ref' in p) {
    const ref = own(p.ref);
    const target = ref?.type === 'reference' ? entities.find((e) => e.name === ref.ref) : undefined;
    const field = target?.fields.find((f) => f.name === p.field);
    return ref && target && field ? { kind: 'ref', ref, target, field } : null;
  }
  const field = own(p.field);
  return field ? { kind: 'field', field } : null;
}

function resolveFollowUps(r: Register, entity: EntityDef, entities: EntityDef[]): ResolvedFollowUp[] {
  const own = (n: string) => entity.fields.find((f) => f.name === n);
  const pick = (names: string[]) => names.map(own).filter((f): f is EntityField => !!f);
  const out: ResolvedFollowUp[] = [];
  for (const f of r.follow_ups ?? []) {
    const key = `${r.id}.${f.id}`;
    const dueField = own('overdue' in f.due ? f.due.overdue.date : f.due.expiring.date);
    if (!dueField) continue;
    const due: ResolvedFollowUp['due'] =
      'overdue' in f.due
        ? { kind: 'overdue', key: `due:${key}`, field: dueField, graceDays: f.due.overdue.grace_days }
        : { kind: 'expiring', key: `due:${key}`, field: dueField, days: f.due.expiring.days };
    const phone = f.phone ? resolvePath(f.phone, entity, entities) : null;
    const contact = f.contact ? resolvePath(f.contact, entity, entities) : null;
    const staffField = f.staff ? (own(f.staff.field) ?? null) : null;
    if (f.who === 'party' ? !phone || !contact : !staffField) continue;
    out.push({
      key,
      id: f.id,
      registerId: r.id,
      label: f.label,
      who: f.who,
      due,
      ...(f.when && { when: f.when }),
      phone,
      contact,
      staffField,
      about: pick(f.about),
      findOut: pick(f.find_out),
      everyDays: f.every_days ?? (f.who === 'party' ? 3 : 1),
      maxTries: f.max_tries,
      hours: f.hours ?? null,
    });
  }
  return out;
}

/** What is wrong with a pack's lists, in words, for the pack tests and the generator's repair round. */
export function validateRegisters(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): string[] {
  const issues: string[] = [];
  const registers = pack.registers ?? [];
  const covered = new Set(registers.map((r) => r.entity));
  const defaultIds = new Set(pack.entities.filter((e) => !covered.has(e.name)).map((e) => defaultRegisterId(e.name)));
  const ids = new Set<string>();
  for (const r of registers) {
    const at = `register ${r.id}`;
    if (ids.has(r.id)) issues.push(`${at}: duplicate id`);
    ids.add(r.id);
    if (defaultIds.has(r.id)) issues.push(`${at}: the id is taken by the default list of another record type`);
    const entity = pack.entities.find((e) => e.name === r.entity);
    if (!entity) {
      issues.push(`${at}: unknown entity ${r.entity}`);
      continue;
    }
    const need = (name: string | undefined, role: string, types?: FieldType[]) => {
      if (name === undefined) return;
      const f = entity.fields.find((x) => x.name === name);
      if (!f) issues.push(`${at}: ${role} ${name} is not a field of ${entity.name}`);
      else if (types && !types.includes(f.type)) issues.push(`${at}: ${role} ${name} must be ${types.join(' or ')}, not ${f.type}`);
    };
    r.columns?.forEach((n) => need(n, 'column'));
    r.filters?.forEach((n) => need(n, 'filter', FILTERABLE));
    need(r.date_field, 'date_field', DATES);
    need(r.sort?.field, 'sort');
    r.totals?.forEach((n) => need(n, 'total', NUMBERS));
    need(r.card?.sum?.field, 'card sum', NUMBERS);
    conditionIssues(entity, r.card?.count?.when, `${at} card count`, issues);
    conditionIssues(entity, r.card?.sum?.when, `${at} card sum`, issues);
    const keys = new Set<string>();
    for (const c of r.checks) {
      const where = `${at} check ${checkKeys(c)[0]}`;
      for (const key of checkKeys(c)) {
        if (keys.has(key)) issues.push(`${at}: two checks share the key ${key}`);
        keys.add(key);
      }
      conditionIssues(entity, c.when, where, issues);
      if ('missing' in c) c.missing.forEach((n) => need(n, 'missing'));
      else if ('adds_up' in c) [c.adds_up.field, ...c.adds_up.plus, ...c.adds_up.minus].forEach((n) => need(n, 'adds_up', NUMBERS));
      else if ('limit' in c) limitIssues(entity, c.limit, where, issues);
      else if ('duplicate' in c) c.duplicate.forEach((n) => need(n, 'duplicate'));
      else if ('overdue' in c) need(c.overdue.date, 'overdue', DATES);
      else need(c.expiring.date, 'expiring', DATES);
    }
    const followUpIds = new Set<string>();
    for (const f of r.follow_ups ?? []) {
      const where = `${at} follow-up ${f.id}`;
      if (followUpIds.has(f.id)) issues.push(`${where}: duplicate id`);
      followUpIds.add(f.id);
      followUpIssues(entity, pack.entities, f, where, issues);
    }
  }
  return issues;
}

function followUpIssues(entity: EntityDef, entities: EntityDef[], f: FollowUp, where: string, issues: string[]) {
  const own = (n: string) => entity.fields.find((x) => x.name === n);
  const date = 'overdue' in f.due ? f.due.overdue.date : f.due.expiring.date;
  const d = own(date);
  if (!d) issues.push(`${where}: due ${date} is not a field of ${entity.name}`);
  else if (!DATES.includes(d.type)) issues.push(`${where}: due ${date} must be ${DATES.join(' or ')}, not ${d.type}`);
  conditionIssues(entity, f.when, where, issues);
  if (f.phone) pathIssues(f.phone, 'phone', entity, entities, where, issues, 'phone');
  if (f.contact) pathIssues(f.contact, 'contact', entity, entities, where, issues);
  if (f.staff && !own(f.staff.field)) issues.push(`${where}: staff ${f.staff.field} is not a field of ${entity.name}`);
  for (const n of f.about) if (!own(n)) issues.push(`${where}: about ${n} is not a field of ${entity.name}`);
  for (const n of f.find_out) if (!own(n)) issues.push(`${where}: find_out ${n} is not a field of ${entity.name}`);
}

/** Checks a call path. `type` is the field type a phone path must end at. */
function pathIssues(p: ContactPath, role: string, entity: EntityDef, entities: EntityDef[], where: string, issues: string[], type?: FieldType) {
  const own = (n: string) => entity.fields.find((x) => x.name === n);
  let target: EntityDef | undefined = entity;
  if ('lookup' in p) {
    target = entities.find((e) => e.name === p.lookup);
    if (!target) {
      issues.push(`${where}: ${role} looks up ${p.lookup}, which is not a record type`);
      return;
    }
    if (!target.fields.some((x) => x.name === p.match)) issues.push(`${where}: ${role} matches ${p.match}, which is not a field of ${target.name}`);
    if (!own(p.value)) issues.push(`${where}: ${role} value ${p.value} is not a field of ${entity.name}`);
  } else if ('ref' in p) {
    const ref = own(p.ref);
    if (!ref) {
      issues.push(`${where}: ${role} ${p.ref} is not a field of ${entity.name}`);
      return;
    }
    if (ref.type !== 'reference') {
      issues.push(`${where}: ${role} ${p.ref} is not a reference field`);
      return;
    }
    target = entities.find((e) => e.name === ref.ref);
    if (!target) {
      issues.push(`${where}: ${role} ${p.ref} points at ${ref.ref ?? 'nothing'}, which is not a record type`);
      return;
    }
  }
  const field = target.fields.find((x) => x.name === p.field);
  if (!field) issues.push(`${where}: ${role} ${p.field} is not a field of ${target.name}`);
  else if (type && field.type !== type) issues.push(`${where}: ${role} ${p.field} must be a ${type} field, not ${field.type}`);
}

type LimitDef = Extract<Check, { limit: unknown }>['limit'];

function limitIssues(entity: EntityDef, l: LimitDef, where: string, issues: string[]) {
  const field = (n: string) => entity.fields.find((f) => f.name === n);
  const bound = l.max ?? l.min;
  const fields = l.fields.map((n) => ({ n, f: field(n) }));
  for (const { n, f } of fields) if (!f) issues.push(`${where}: ${n} is not a field of ${entity.name}`);
  if (typeof bound === 'string' && !field(bound)) {
    issues.push(`${where}: ${bound} is not a field of ${entity.name}`);
    return;
  }
  if (fields.some((x) => x.f?.type === 'date')) {
    if (fields.length !== 1 || typeof bound !== 'string' || field(bound)!.type !== 'date') {
      issues.push(`${where}: a date limit compares one date field with another date field`);
    }
    return;
  }
  for (const { n, f } of fields) if (f && !NUMBERS.includes(f.type)) issues.push(`${where}: ${n} must be a number, money or integer field`);
  if (typeof bound === 'string' && !NUMBERS.includes(field(bound)!.type)) issues.push(`${where}: ${bound} must be a number, money or integer field`);
}

function conditionIssues(entity: EntityDef, when: Conditions | undefined, where: string, issues: string[]) {
  for (const [name, cond] of Object.entries(when ?? {})) {
    const f = entity.fields.find((x) => x.name === name);
    if (!f) {
      issues.push(`${where}: condition on ${name}, which is not a field of ${entity.name}`);
      continue;
    }
    if (Array.isArray(cond)) {
      if (f.type === 'enum') for (const v of cond) if (!f.options?.includes(String(v))) issues.push(`${where}: ${String(v)} is not an option of ${name}`);
      if (f.type === 'boolean' && cond.some((v) => typeof v !== 'boolean')) issues.push(`${where}: ${name} takes true or false`);
    } else if (typeof cond === 'object' && !NUMBERS.includes(f.type)) {
      issues.push(`${where}: above and below need a number field, ${name} is ${f.type}`);
    }
  }
}

/**
 * The lists that fit the pack's record types, for a pack a model designed, which inherits
 * lists it cannot see: a type it redefines may no longer fit them. A follow-up that no longer
 * fits is left out rather than the list.
 */
export function fittingRegisters(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): Register[] {
  const fits = (r: Register) => validateRegisters({ entities: pack.entities, registers: [r] }).length === 0;
  return (pack.registers ?? []).flatMap((r) => {
    if (fits(r)) return [r];
    const kept = { ...r, follow_ups: (r.follow_ups ?? []).filter((f) => fits({ ...r, follow_ups: [f] })) };
    return fits(kept) ? [kept] : [];
  });
}

/** The routines whose collection (if any) still has its list and fields. */
export function fittingRoutines(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[]; routines?: RoutineTemplate[] }): RoutineTemplate[] {
  return (pack.routines ?? []).filter((t) => validateCollects({ ...pack, routines: [t] }).length === 0);
}

/** The asked fields of a collection, in order, less any the routine fills itself. */
export function collectAsk(reg: ResolvedRegister, collect: Pick<Collect, 'ask' | 'defaults'>): EntityField[] {
  return collect.ask.filter((n) => !(n in collect.defaults)).flatMap((n) => reg.entity.fields.filter((f) => f.name === n));
}

/** What is wrong with a pack's collection routines: the list, the fields, the defaults, and required fields nobody fills. */
export function validateCollects(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[]; routines?: RoutineTemplate[] }): string[] {
  const issues: string[] = [];
  const lists = registersOf(pack);
  for (const t of pack.routines ?? []) {
    const c = t.collect;
    if (!c) continue;
    const at = `routine ${t.id}`;
    const reg = lists.find((l) => l.id === c.list);
    if (!reg) {
      issues.push(`${at}: no list ${c.list}`);
      continue;
    }
    const field = (n: string) => reg.entity.fields.find((f) => f.name === n);
    for (const n of c.ask) if (!field(n)) issues.push(`${at}: ask ${n} is not a field of ${reg.entity.name}`);
    for (const [n, v] of Object.entries(c.defaults)) {
      const f = field(n);
      if (!f) issues.push(`${at}: default ${n} is not a field of ${reg.entity.name}`);
      else if (v === 'today' && f.type !== 'date') issues.push(`${at}: today is for date fields, ${n} is ${f.type}`);
      else if (v === 'now' && f.type !== 'datetime') issues.push(`${at}: now is for date-time fields, ${n} is ${f.type}`);
      else if (f.type === 'enum' && !f.options?.includes(String(v))) issues.push(`${at}: ${String(v)} is not an option of ${n}`);
      if (c.ask.includes(n)) issues.push(`${at}: ${n} is both asked and defaulted`);
    }
    for (const f of reg.entity.fields) {
      if (f.required && !c.ask.includes(f.name) && !(f.name in c.defaults)) issues.push(`${at}: required field ${f.name} is neither asked nor defaulted`);
    }
  }
  return issues;
}
