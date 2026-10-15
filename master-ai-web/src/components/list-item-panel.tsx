import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Pencil, Trash2, X } from 'lucide-react';
import type { EntityDef, ListMeta } from '@onehuman/schemas';
import { ItemNotes } from '@/components/item-notes';
import { RecordForm } from '@/components/record-form';
import { Button } from '@/components/ui/button';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { referenceText } from '@/lib/lists';
import { recordCell } from '@/lib/record-cell';
import { timeAgo } from '@/lib/utils';

type Mode = 'view' | 'edit' | 'check' | 'remove';

/** One item: how it came in, its problems, its details and history. Correct it, check it or remove it. */
export function ListItemPanel({
  list,
  itemId,
  entities,
  onClose,
  onOpen,
}: {
  list: ListMeta;
  itemId: string;
  entities: EntityDef[];
  onClose: () => void;
  onOpen: (itemId: string) => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['list-item', list.id, itemId], queryFn: () => api.lists.item(list.id, itemId) });
  const [mode, setMode] = useState<Mode>('view');
  const [text, setText] = useState('');
  useEffect(() => {
    setMode('view');
    setText('');
  }, [itemId]);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>('[aria-label="Close"]')?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const all = [...panel.current.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1',
      );
      const first = all[0];
      const last = all[all.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!panel.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = () => {
    setMode('view');
    setText('');
    for (const key of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const update = useMutation({
    mutationFn: (v: { data: Record<string, unknown>; note: string }) => api.lists.update(list.id, itemId, { data: v.data, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: done,
  });
  const check = useMutation({ mutationFn: () => api.lists.check(list.id, itemId, text.trim() ? { note: text.trim() } : {}), onSuccess: done });
  const remove = useMutation({
    mutationFn: () => api.lists.remove(list.id, itemId, text.trim()),
    onSuccess: () => {
      done();
      onClose();
    },
  });

  const d = detail.data;
  const open = d?.item.problems.filter((p) => !p.acknowledged) ?? [];
  const seen = d?.item.problems.filter((p) => p.acknowledged) ?? [];

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-background/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby="item-title" className="glass h-full w-full overflow-y-auto p-6 sm:max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">{list.entity.label}</p>
            <h2 id="item-title" className="font-display text-2xl text-fg">
              {d?.item.title ?? '…'}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {detail.isLoading && <Spinner />}
        {d && (
          <div className="mt-4 space-y-6">
            <p className="text-sm text-fg-body">
              Came in: <span className="text-fg">{d.item.source.label}</span>
              {' · '}
              {d.item.checked ? (
                <span className="text-success">
                  Checked by {d.item.checked.by}, {timeAgo(d.item.checked.at)}
                  {d.item.checked.note && <span className="text-fg-body"> — “{d.item.checked.note}”</span>}
                </span>
              ) : (
                <span className="text-fg-muted">Not checked</span>
              )}
              {d.item.updated.via === 'call' && d.item.updated.by && <span className="text-fg-muted"> · Updated on a call with {d.item.updated.by}</span>}
            </p>

            {(open.length > 0 || seen.length > 0) && (
              <section aria-label="Problems" className="space-y-2">
                {open.map((p) => (
                  <p key={p.key} className="flex gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {p.message}
                      {p.relatedId && (
                        <>
                          {' · '}
                          <button type="button" className="underline" onClick={() => onOpen(p.relatedId!)}>
                            open the other one
                          </button>
                        </>
                      )}
                    </span>
                  </p>
                ))}
                {seen.map((p) => (
                  <p key={p.key} className="flex gap-2 px-3 text-sm text-fg-muted">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{p.message} (seen)</span>
                  </p>
                ))}
              </section>
            )}

            <ItemNotes notes={d.notes} onDone={done} />

            {mode === 'view' && (
              <div className="flex flex-wrap gap-2">
                <Button variant="success" size="sm" loading={check.isPending} onClick={() => (open.length ? setMode('check') : check.mutate())}>
                  <CheckCircle2 /> Mark as checked
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>
                  <Pencil /> Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => setMode('remove')}>
                  <Trash2 /> Remove
                </Button>
              </div>
            )}
            {mode === 'check' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  check.mutate();
                }}
              >
                <Field label="Why is it right as it is?" htmlFor="check-note">
                  <Textarea id="check-note" rows={2} value={text} onChange={(e) => setText(e.target.value)} required />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="success" loading={check.isPending}>
                    Mark as checked
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMode('view')}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {mode === 'remove' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  remove.mutate();
                }}
              >
                <Field label="Why remove it?" htmlFor="remove-reason" hint="The audit trail keeps a full copy.">
                  <Textarea id="remove-reason" rows={2} value={text} onChange={(e) => setText(e.target.value)} required minLength={3} />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" loading={remove.isPending}>
                    Remove
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMode('view')}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {mode === 'edit' ? (
              <RecordForm
                entity={list.entity}
                entities={entities}
                initial={d.item.data}
                titles={d.item.titles}
                withNote
                submitLabel="Save changes"
                pending={update.isPending}
                error={update.error}
                onSubmit={(data, note) => update.mutate({ data, note })}
                onCancel={() => setMode('view')}
              />
            ) : (
              <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
                {list.entity.fields.map((f) => (
                  <div key={f.name} className="contents">
                    <dt className="text-fg-muted">{f.label}</dt>
                    <dd className="break-words text-fg">
                      {f.type === 'reference' ? (d.item.titles[f.name] ?? referenceText(d.item.data[f.name])) : recordCell(f, d.item.data[f.name])}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <section aria-label="History">
              <h3 className="text-sm font-medium text-fg">History</h3>
              <ol className="mt-2 space-y-2 text-sm">
                {d.history.map((e, i) => (
                  <li key={i} className="text-fg-body">
                    <span className="text-fg">{e.who}</span> {e.kind === 'created' ? 'added it' : e.kind === 'checked' ? 'checked it' : 'changed it'}
                    {' · '}
                    <span className="text-fg-muted">{timeAgo(e.at)}</span>
                    {e.changes.length > 0 && (
                      <ul className="ml-4 list-disc text-fg-muted">
                        {e.changes.map((c) => (
                          <li key={c.field}>
                            {c.label}: {c.from} → {c.to}
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.note && <p className="text-fg-muted">“{e.note}”</p>}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
        <ErrorNote error={detail.error ?? update.error ?? check.error ?? remove.error} className="mt-4" />
      </aside>
    </div>
  );
}
