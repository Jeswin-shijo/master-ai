import { useDeferredValue, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Plus, Search } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import type { EntityDef, EntityField, ItemSourceKind, ListItem, ListQueryParams, ListRange, ListShow } from '@onehuman/schemas';
import { FollowUpsPanel } from '@/components/follow-ups-panel';
import { ListItemPanel } from '@/components/list-item-panel';
import { RecordForm, ReferenceSelect } from '@/components/record-form';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import {
  csvFileName,
  initialView,
  listParams,
  nextSort,
  RANGE_LABELS,
  referenceText,
  saveText,
  SHOW_LABELS,
  sortMark,
  SOURCE_LABELS,
  type ListView,
} from '@/lib/lists';
import { recordCell } from '@/lib/record-cell';
import { usePageTitle } from '@/lib/title';
import { cn, formatInr } from '@/lib/utils';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const chip = (on: boolean) => cn('rounded-full border px-3 py-1 text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-fg-muted hover:text-fg');

function FilterControl({ field, entities, value, onChange }: { field: EntityField; entities: EntityDef[]; value: string; onChange: (v: string) => void }) {
  if (field.type === 'enum' && (field.options?.length ?? 0) <= 6) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={field.label}>
        <span className="mr-1 text-xs text-fg-muted">{field.label}</span>
        {['', ...(field.options ?? [])].map((o) => (
          <button key={o || 'all'} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={chip(value === o)}>
            {o ? capitalize(o) : 'All'}
          </button>
        ))}
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs text-fg-muted">{field.label}</span>
      {field.type === 'reference' ? (
        <ReferenceSelect field={field} entities={entities} anyLabel="Any" value={value} onChange={(e) => onChange(e.target.value)} className="w-auto" />
      ) : (
        <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto">
          <option value="">Any</option>
          {field.type === 'boolean' ? (
            <>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </>
          ) : (
            field.options?.map((o) => (
              <option key={o} value={o}>
                {capitalize(o)}
              </option>
            ))
          )}
        </Select>
      )}
    </label>
  );
}

function Status({ item }: { item: ListItem }) {
  const open = item.problems.filter((p) => !p.acknowledged);
  const fromCall = item.newNotes > 0 && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">New from a call</span>;
  if (open.length) {
    return (
      <span className="inline-flex items-center">
        <span className="inline-flex items-center gap-1 text-danger" title={open.map((p) => p.message).join('\n')}>
          <AlertTriangle className="size-4" aria-hidden />
          {open.length}
          <span className="sr-only"> problem{open.length === 1 ? '' : 's'}</span>
        </span>
        {fromCall}
      </span>
    );
  }
  if (item.checked) {
    return (
      <span className="inline-flex items-center">
        <span className="inline-flex text-success" title={`Checked by ${item.checked.by}`}>
          <CheckCircle2 className="size-4" aria-hidden />
          <span className="sr-only">Checked</span>
        </span>
        {fromCall}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center">
      <span className="text-xs text-fg-muted">Not checked</span>
      {fromCall}
    </span>
  );
}

/** One list: filters, totals over every match, problems, bulk check, download, and the item drawer. */
export function ListPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const openItem = params.get('item');
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ['lists'], queryFn: api.lists.overview });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const meta = overview.data?.lists.find((l) => l.id === id);
  const entities = workspaces.data?.[0]?.pack.entities ?? [];
  const [view, setView] = useState<ListView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const v = view ?? initialView(!!meta?.dateField);
  // A bulk selection belongs to the view it was made in.
  const changeView = (next: ListView) => {
    setSelected(new Set());
    setView(next);
  };
  const set = (patch: Partial<ListView>) => changeView({ ...v, page: 1, ...patch });
  // Deferred as a string: a new object every render would make React re-render without end. Typing in search stays smooth.
  const queryKey = useDeferredValue(JSON.stringify(listParams(v)));
  const page = useQuery({
    queryKey: ['list', id, queryKey],
    queryFn: () => api.lists.page(id, JSON.parse(queryKey) as ListQueryParams),
    enabled: !!meta,
    placeholderData: keepPreviousData,
  });
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  usePageTitle(meta?.label ?? 'Lists');

  const refresh = () => {
    for (const key of ['lists', 'list', 'list-item', 'follow-ups']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.lists.create(id, data),
    onSuccess: () => {
      setAdding(false);
      refresh();
    },
  });
  const checkMany = useMutation({
    mutationFn: () => api.lists.checkMany(id, [...selected]),
    onSuccess: (r) => {
      setSelected(new Set());
      setNote(`Checked ${r.checked}${r.skipped ? `, skipped ${r.skipped} with problems` : ''}.`);
      refresh();
    },
  });
  const download = useMutation({ mutationFn: () => api.lists.exportCsv(id, listParams(v)), onSuccess: (r) => saveText(csvFileName(meta!.label), r.csv) });
  const openOne = (itemId: string) =>
    setParams((p) => {
      p.set('item', itemId);
      return p;
    });

  if (overview.isLoading) return <Spinner />;
  if (!meta) return <EmptyState title="This list isn't here">It may belong to another kind of organization.</EmptyState>;

  const field = (name: string) => meta.entity.fields.find((f) => f.name === name)!;
  const columns = meta.columns.map(field);
  const items = page.data?.items ?? [];
  const singular = meta.entity.label.toLowerCase();
  const total = (f: EntityField, n: number) => (f.type === 'money' ? formatInr(n) : n.toLocaleString('en-IN'));

  return (
    <div>
      <PageHeader
        title={meta.label}
        description={meta.entity.description}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>
              <Download /> Download
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus /> New {singular}
            </Button>
          </div>
        }
      />
      {download.data?.truncated && (
        <p role="status" className="mb-4 text-sm text-fg-body">
          The download holds the first {download.data.limit?.toLocaleString('en-IN')} items. Narrow the list to get the rest.
        </p>
      )}
      <FollowUpsPanel listId={id} />

      <Card className="mb-4">
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {meta.dateField && (
              <Select aria-label="Date range" value={v.range} onChange={(e) => set({ range: e.target.value as ListView['range'] })} className="w-auto">
                {(Object.keys(RANGE_LABELS) as ListRange[]).map((r) => (
                  <option key={r} value={r}>
                    {RANGE_LABELS[r]}
                  </option>
                ))}
                <option value="custom">Pick dates…</option>
              </Select>
            )}
            {v.range === 'custom' && (
              <>
                <Input type="date" aria-label="From" value={v.from} onChange={(e) => set({ from: e.target.value })} className="w-auto" />
                <Input type="date" aria-label="To" value={v.to} onChange={(e) => set({ to: e.target.value })} className="w-auto" />
              </>
            )}
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-muted" aria-hidden />
              <Input value={v.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search" aria-label="Search this list" className="pl-8" />
            </div>
            <Select aria-label="Came in" value={v.source} onChange={(e) => set({ source: e.target.value as ItemSourceKind | '' })} className="w-auto">
              <option value="">Came in any way</option>
              {(Object.keys(SOURCE_LABELS) as ItemSourceKind[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {meta.filters.map((name) => (
            <FilterControl key={name} field={field(name)} entities={entities} value={v.filters[name] ?? ''} onChange={(value) => set({ filters: { ...v.filters, [name]: value } })} />
          ))}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
            {(Object.keys(SHOW_LABELS) as (ListShow | 'all')[]).map((s) => (
              <button key={s} type="button" aria-pressed={v.show === s} onClick={() => set({ show: s })} className={chip(v.show === s)}>
                {SHOW_LABELS[s]}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        {adding && (
          <CardBody className="border-b border-line-10">
            <RecordForm
              entity={meta.entity}
              entities={entities}
              submitLabel={`Save ${singular}`}
              pending={create.isPending}
              error={create.error}
              onSubmit={(data) => create.mutate(data)}
              onCancel={() => setAdding(false)}
            />
          </CardBody>
        )}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line-10 px-5 py-2.5 text-sm">
            <span>{selected.size} selected</span>
            <Button size="sm" variant="success" loading={checkMany.isPending} onClick={() => checkMany.mutate()}>
              <CheckCircle2 /> Mark as checked
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
        {note && (
          <p role="status" className="border-b border-line-10 px-5 py-2.5 text-sm text-fg-body">
            {note}
          </p>
        )}
        {page.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title={`No ${meta.label.toLowerCase()} here`}>Try another date range, or clear the filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={items.every((i) => selected.has(i.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                      className="size-4 accent-[var(--oh-primary)]"
                    />
                  </th>
                  {columns.map((c) => (
                    <th key={c.name} className="px-3 py-2 font-medium">
                      <button type="button" className="hover:text-fg" onClick={() => set({ sort: nextSort(v.sort, c.name) })}>
                        {c.label}
                        {sortMark(v.sort, c.name)}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Came in</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">Checks</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-10">
                {items.map((item) => (
                  <tr key={item.id} className="cursor-pointer hover:bg-line-5" onClick={() => openOne(item.id)}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        checked={selected.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                        className="size-4 accent-[var(--oh-primary)]"
                      />
                    </td>
                    {columns.map((c, ci) => {
                      const text = c.type === 'reference' ? (item.titles[c.name] ?? referenceText(item.data[c.name])) : recordCell(c, item.data[c.name]);
                      return (
                        <td key={c.name} className="max-w-xs truncate px-3 py-2.5 text-fg">
                          {ci === 0 ? (
                            <button
                              type="button"
                              className="max-w-full truncate text-left hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                openOne(item.id);
                              }}
                            >
                              {text}
                            </button>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{item.source.label}</td>
                    <td className="px-3 py-2.5">
                      <Status item={item} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-10 px-5 py-3 text-sm">
            <span className="font-medium text-fg">
              {page.data.total} {page.data.total === 1 ? singular : meta.label.toLowerCase()}
            </span>
            {meta.totals.map((name) => (
              <span key={name} className="text-fg-body">
                {field(name).label} {total(field(name), page.data!.totals[name] ?? 0)}
              </span>
            ))}
            {page.data.undated > 0 && meta.dateField && (
              <button type="button" className="text-accent hover:underline" onClick={() => set({ range: 'all' })}>
                {page.data.undated} {page.data.undated === 1 ? 'has' : 'have'} no {field(meta.dateField).label.toLowerCase()}: show all time
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={v.page <= 1} onClick={() => changeView({ ...v, page: v.page - 1 })}>
                Previous
              </Button>
              <span className="text-fg-muted">
                Page {v.page} of {Math.max(1, Math.ceil(page.data.total / page.data.pageSize))}
              </span>
              <Button size="sm" variant="ghost" disabled={v.page * page.data.pageSize >= page.data.total} onClick={() => changeView({ ...v, page: v.page + 1 })}>
                Next
              </Button>
            </div>
          </div>
        )}
        <ErrorNote error={page.error ?? create.error ?? checkMany.error ?? download.error} className="m-5" />
      </Card>

      {openItem && (
        <ListItemPanel
          list={meta}
          itemId={openItem}
          entities={entities}
          onOpen={openOne}
          onClose={() =>
            setParams((p) => {
              p.delete('item');
              return p;
            })
          }
        />
      )}
    </div>
  );
}
