import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Plus, Search } from 'lucide-react';
import type { EntityDef, EntityField } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { cn, formatInr, formatValue, timeAgo } from '@/lib/utils';

/**
 * Schema-driven records: tables and forms are rendered from the pack's entity
 * definitions, so a new industry needs no app release.
 */
function cell(field: EntityField | undefined, value: unknown): string {
  if (field?.type === 'money' && typeof value === 'number') return formatInr(value);
  return formatValue(value);
}

function RecordForm({ entity, onDone }: { entity: EntityDef; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const create = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {};
      for (const f of entity.fields) {
        const v = values[f.name];
        if (v === undefined || v === '') continue;
        data[f.name] = typeof v === 'boolean' ? v : ['number', 'money', 'integer'].includes(f.type) ? Number(v) : v;
      }
      return api.records.create(entity.name, data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['records', entity.name] });
      onDone();
    },
  });

  const input = (f: EntityField) => {
    const id = `f-${f.name}`;
    const common = { id, required: f.required, value: (values[f.name] as string) ?? '', onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.name]: e.target.value })) };
    switch (f.type) {
      case 'enum':
        return (
          <Select {...common}>
            <option value="">—</option>
            {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        );
      case 'text':
        return <Textarea {...common} rows={2} />;
      case 'boolean':
        return <input id={id} type="checkbox" checked={values[f.name] === true} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))} className="size-4 accent-[var(--oh-primary)]" />;
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
        create.mutate();
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
      <ErrorNote error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending}>Save {entity.label.toLowerCase()}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function RecordsPage() {
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const entities = workspaces.data?.[0]?.pack.entities ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const entity = entities.find((e) => e.name === selected) ?? entities[0];
  const records = useQuery({
    queryKey: ['records', entity?.name, query],
    queryFn: () => api.records.list(entity!.name, query || undefined),
    enabled: !!entity,
  });

  if (workspaces.isLoading) return <Spinner />;
  if (!entity) return <EmptyState icon={<Database />} title="No records yet">Install an industry pack first.</EmptyState>;
  const columns = (entity.list_columns ?? entity.fields.slice(0, 5).map((f) => f.name)).map((name) => entity.fields.find((f) => f.name === name)).filter(Boolean) as EntityField[];

  return (
    <div>
      <PageHeader lead="Your business" title="records." description="Your business data, shaped by your industry pack. Agents read and write these through tools." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {entities.map((e) => (
          <button
            key={e.name}
            onClick={() => {
              setSelected(e.name);
              setAdding(false);
            }}
            className={cn('rounded-full border px-3 py-1 text-sm', e.name === entity.name ? 'border-primary bg-primary-soft text-primary' : 'border-border text-fg-muted hover:text-fg')}
          >
            {e.plural_label ?? `${e.label}s`}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={entity.plural_label ?? `${entity.label}s`}
          description={entity.description}
          action={
            !adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> New {entity.label.toLowerCase()}
              </Button>
            )
          }
        />
        {adding ? (
          <CardBody>
            <RecordForm entity={entity} onDone={() => setAdding(false)} />
          </CardBody>
        ) : (
          <>
            <div className="border-b border-border px-5 py-3">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-muted" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="pl-8" aria-label="Search records" />
              </div>
            </div>
            {records.isLoading ? (
              <Spinner />
            ) : records.data?.length === 0 ? (
              <EmptyState title={`No ${(entity.plural_label ?? entity.label).toLowerCase()} yet`} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-fg-muted">
                    <tr>
                      {columns.map((c) => <th key={c.name} className="px-5 py-2 font-medium">{c.label}</th>)}
                      <th className="px-5 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-10">
                    {records.data?.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/50">
                        {columns.map((c) => <td key={c.name} className="max-w-xs truncate px-5 py-2.5 text-fg">{cell(c, r.data[c.name])}</td>)}
                        <td className="px-5 py-2.5 text-fg-muted">{timeAgo(r.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ErrorNote error={records.error} className="m-5" />
          </>
        )}
      </Card>
    </div>
  );
}
