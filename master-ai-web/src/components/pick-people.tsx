import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';

/** Who the AI calls for a routine that collects items: the people who keep that list. */
export function PickPeople({ open, who, pending, error, onClose, onPick }: { open: boolean; who: string | null; pending: boolean; error: unknown; onClose: () => void; onPick: (ids: string[]) => void }) {
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list, enabled: open });
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (open) setIds([]);
  }, [open]);
  const active = (team.data ?? []).filter((p) => p.status === 'active');
  return (
    <Dialog open={open} onClose={onClose} title="Who does the AI call?" lead={who ? `Pick ${who}. The AI calls them at the routine's time and adds what they read out.` : 'Pick who the AI calls.'}>
      {team.isLoading && <Spinner />}
      <fieldset className="space-y-2">
        <legend className="sr-only">People</legend>
        {active.map((p) => (
          <label key={p.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))}
              className="size-4 accent-[var(--oh-primary)]"
            />
            <span className="text-fg">{p.name}</span>
            <span className="text-fg-muted">{p.title}</span>
          </label>
        ))}
      </fieldset>
      <ErrorNote error={error} className="mt-3" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ids.length} loading={pending} onClick={() => onPick(ids)}>
          <Play /> Switch it on
        </Button>
      </div>
    </Dialog>
  );
}
