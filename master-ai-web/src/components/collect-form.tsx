import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Routine } from '@onehuman/schemas';
import { RecordForm } from '@/components/record-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { collectDefaults } from '@/lib/collect';

/** Adding today's items by hand: the list's own form, only the routine's fields, its defaults filled in. Done records how many were added. */
export function CollectForm({ routine, staffId, open, onClose }: { routine: Routine; staffId: string | null; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const collect = routine.collect!;
  const overview = useQuery({ queryKey: ['lists'], queryFn: api.lists.overview, enabled: open });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list, enabled: open });
  const [added, setAdded] = useState(0);
  const [round, setRound] = useState(0);
  const person = staffId ?? routine.people[0]?.id ?? null;
  const list = overview.data?.lists.find((l) => l.id === collect.list);
  const form = list && { ...list.entity, fields: list.entity.fields.filter((f) => collect.ask.includes(f.name) && !(f.name in collect.defaults)) };
  const add = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.records.create(collect.entity, { ...collectDefaults(collect.defaults, list!.entity), ...data }),
    onSuccess: () => {
      setAdded((n) => n + 1);
      setRound((n) => n + 1);
    },
  });
  const finish = useMutation({
    mutationFn: () => api.routines.submit(routine.id, { staffId: person!, values: { items: added } }),
    onSuccess: () => {
      for (const key of ['routine', 'routines', 'lists', 'list']) void queryClient.invalidateQueries({ queryKey: [key] });
      setAdded(0);
      onClose();
    },
  });
  /** Closing any way records what was added, like Done; a close with nothing added just closes. */
  const close = () => (added > 0 && person ? finish.mutate() : onClose());
  return (
    <Dialog open={open} onClose={close} title={`Add today's ${collect.listLabel.toLowerCase()}`} lead={added ? `${added} added so far.` : `Each one goes to ${collect.listLabel}.`}>
      {!person && <p className="text-sm text-fg-muted">Nobody is on this routine yet. Add someone to it first.</p>}
      {person && !form && <Spinner />}
      {person && form && (
        <RecordForm
          key={round}
          entity={form}
          entities={workspaces.data?.[0]?.pack.entities ?? []}
          submitLabel={`Add ${collect.itemLabel}`}
          pending={add.isPending}
          error={add.error}
          onSubmit={(data) => add.mutate(data)}
          onCancel={close}
        />
      )}
      {person && (
        <div className="mt-4 flex justify-end">
          <Button variant="success" loading={finish.isPending} onClick={() => finish.mutate()}>
            Done, {added} added
          </Button>
        </div>
      )}
      <ErrorNote error={finish.error} />
    </Dialog>
  );
}
