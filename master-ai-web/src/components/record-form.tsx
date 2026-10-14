import { useState, type SelectHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EntityDef, EntityField } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { referenceText } from '@/lib/lists';
import { dataValue, formValue } from '@/lib/record-values';
import { cn } from '@/lib/utils';

/** Pick an item of the record type a reference field points at, by its title. */
export function ReferenceSelect({
  field,
  entities,
  anyLabel = '—',
  currentTitle,
  ...props
}: { field: EntityField; entities: EntityDef[]; anyLabel?: string; currentTitle?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const target = entities.find((e) => e.name === field.ref);
  const items = useQuery({ queryKey: ['records', field.ref], queryFn: () => api.records.list(field.ref!), enabled: !!field.ref });
  const titleField = target?.title_field ?? target?.fields.find((f) => f.type === 'string')?.name;
  const options = (items.data ?? []).map((r) => ({ id: r.id, title: titleField && r.data[titleField] ? String(r.data[titleField]) : (target?.label ?? 'Item') }));
  const value = typeof props.value === 'string' ? props.value : '';
  return (
    <Select {...props}>
      <option value="">{anyLabel}</option>
      {value && !options.some((o) => o.id === value) && <option value={value}>{currentTitle ?? referenceText(value)}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </Select>
  );
}

/**
 * Schema-driven form for one item, rendered from the pack's entity, so a new
 * organization type needs no app release. With `initial` it edits: blanks are
 * sent as null so a field can be cleared.
 */
export function RecordForm({
  entity,
  entities,
  initial,
  titles,
  submitLabel,
  withNote = false,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  entity: EntityDef;
  entities: EntityDef[];
  initial?: Record<string, unknown>;
  titles?: Record<string, string>;
  submitLabel: string;
  withNote?: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (data: Record<string, unknown>, note: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(entity.fields.map((f) => [f.name, formValue(f, initial?.[f.name])])));
  const [note, setNote] = useState('');
  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }));

  const input = (f: EntityField) => {
    const id = `f-${f.name}`;
    const common = { id, required: f.required, value: String(values[f.name] ?? ''), onChange: (e: { target: { value: string } }) => set(f.name, e.target.value) };
    switch (f.type) {
      case 'enum':
        return (
          <Select {...common}>
            <option value="">—</option>
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        );
      case 'reference':
        return <ReferenceSelect {...common} field={f} entities={entities} currentTitle={titles?.[f.name]} />;
      case 'text':
        return <Textarea {...common} rows={2} />;
      case 'boolean':
        return <input id={id} type="checkbox" checked={values[f.name] === true} onChange={(e) => set(f.name, e.target.checked)} className="size-4 accent-[var(--oh-primary)]" />;
      default: {
        const type = { number: 'number', money: 'number', integer: 'number', date: 'date', datetime: 'datetime-local', email: 'email', phone: 'tel' }[f.type as string] ?? 'text';
        return <Input {...common} type={type} step={f.type === 'integer' ? 1 : 'any'} />;
      }
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data: Record<string, unknown> = {};
        for (const f of entity.fields) {
          const v = dataValue(f, values[f.name]);
          if (initial || v !== null) data[f.name] = v;
        }
        onSubmit(data, note.trim());
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {entity.fields.map((f) => (
          <div key={f.name} className={cn(f.type === 'text' && 'sm:col-span-2')}>
            <Field label={`${f.label}${f.required ? ' *' : ''}`} htmlFor={`f-${f.name}`} hint={f.description}>
              {input(f)}
            </Field>
          </div>
        ))}
      </div>
      {withNote && (
        <Field label="Why the change (optional)" htmlFor="f-change-note">
          <Input id="f-change-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
