import type { CheckinValue, EntityDef, Routine } from '@onehuman/schemas';

/** A routine's defaults as values: `today` is today's date in India, `now` the moment, anything else as given. */
export function collectDefaults(defaults: Record<string, string | number | boolean>, entity: EntityDef, now: Date = new Date()): Record<string, unknown> {
  const today = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  return Object.fromEntries(
    Object.entries(defaults).map(([name, v]) => {
      const f = entity.fields.find((x) => x.name === name);
      if (v === 'today' && f?.type === 'date') return [name, today];
      if (v === 'now' && f?.type === 'datetime') return [name, now.toISOString()];
      return [name, v];
    }),
  );
}

/** "3 bills added · 1 difference noted". */
export function collectedText(routine: Pick<Routine, 'collect'>, values: Record<string, CheckinValue>): string {
  const c = routine.collect!;
  const plural = c.listLabel.toLowerCase();
  const items = Number(values.items ?? 0);
  const differences = Number(values.differences ?? 0);
  const added = items === 0 ? `No ${plural} added` : `${items} ${items === 1 ? c.itemLabel : plural} added`;
  return differences ? `${added} · ${differences} difference${differences === 1 ? '' : 's'} noted` : added;
}
