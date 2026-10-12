import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Minus, Plus, X } from 'lucide-react';
import type { CheckinValue, Routine, RoutineQuestion } from '@onehuman/schemas';
import { spring } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Fill in a check-in by hand: the manual side of a routine. The same
 * questions the AI asks on the phone, as a quick form.
 */
export function CheckinForm({
  routine,
  staffId,
  initial,
  open,
  onClose,
}: {
  routine: Routine;
  staffId: string | null;
  initial?: Record<string, CheckinValue>;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [who, setWho] = useState(staffId ?? routine.people[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, CheckinValue>>(initial ?? {});
  useEffect(() => {
    if (open) {
      setWho(staffId ?? routine.people[0]?.id ?? '');
      setValues(initial ?? {});
    }
  }, [open, staffId, initial, routine.people]);

  const save = useMutation({
    mutationFn: () => api.routines.submit(routine.id, { staffId: who, values }),
    onSuccess: (day) => {
      queryClient.setQueryData(['routine', routine.id, day.date], day);
      void queryClient.invalidateQueries({ queryKey: ['routines'] });
      void queryClient.invalidateQueries({ queryKey: ['routine', routine.id] });
      onClose();
    },
  });
  const set = (key: string, v: CheckinValue) => setValues((s) => ({ ...s, [key]: v }));
  const person = routine.people.find((p) => p.id === who);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${routine.name}: fill in by hand`}
            className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl shadow-black/50"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hero-glow flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Fill in by hand</p>
                <h2 className="mt-0.5 text-lg font-semibold text-fg">{routine.name}</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X />
              </Button>
            </div>
            <form
              className="space-y-5 px-5 py-5"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-fg">Who is reporting</span>
                <Select value={who} onChange={(e) => setWho(e.target.value)} disabled={!!staffId}>
                  {routine.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.title}
                    </option>
                  ))}
                </Select>
              </label>
              {routine.questions.map((q, i) => (
                <motion.div key={q.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.05 * i }}>
                  <QuestionField q={q} value={values[q.key]} onChange={(v) => set(q.key, v)} />
                </motion.div>
              ))}
              <ErrorNote error={save.error} />
              <div className="flex gap-2 pt-1">
                <Button type="submit" className="flex-1" loading={save.isPending} disabled={!who}>
                  Save {person ? `${person.name.split(' ')[0]}'s` : 'the'} update
                </Button>
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QuestionField({ q, value, onChange }: { q: RoutineQuestion; value: CheckinValue | undefined; onChange: (v: CheckinValue) => void }) {
  const id = `q-${q.key}`;
  const label = (
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
      {q.ask}
      {!q.required && <span className="ml-1 font-normal text-fg-muted">(optional)</span>}
    </label>
  );
  switch (q.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : 0;
      return (
        <div>
          {label}
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="icon" onClick={() => onChange(Math.max(0, n - 1))} aria-label="One less">
              <Minus />
            </Button>
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              value={typeof value === 'number' ? value : ''}
              onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
              className="h-9 w-24 rounded-md border border-border bg-background text-center text-base font-semibold text-fg tabular-nums focus:border-primary focus:outline-none"
            />
            <Button type="button" variant="secondary" size="icon" onClick={() => onChange(n + 1)} aria-label="One more">
              <Plus />
            </Button>
            {q.unit && <span className="text-sm text-fg-muted">{q.unit}</span>}
          </div>
        </div>
      );
    }
    case 'percent': {
      const n = typeof value === 'number' ? value : 0;
      return (
        <div>
          {label}
          <div className="flex items-center gap-3">
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={5}
              value={n}
              onChange={(e) => onChange(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-[var(--oh-primary)]"
            />
            <motion.span key={n} initial={{ scale: 1.25 }} animate={{ scale: 1 }} transition={spring} className="w-12 text-right text-base font-semibold text-fg tabular-nums">
              {n}%
            </motion.span>
          </div>
        </div>
      );
    }
    case 'yes_no':
      return (
        <div>
          {label}
          <div className="flex gap-2" role="radiogroup" aria-labelledby={id}>
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={value === v}
                onClick={() => onChange(v)}
                className={cn('flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors', value === v ? 'border-primary bg-primary-soft text-fg' : 'border-border text-fg-muted hover:text-fg')}
              >
                {v ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        </div>
      );
    case 'choice':
      return (
        <div>
          {label}
          <Select id={id} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose…</option>
            {q.options?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </div>
      );
    default:
      return (
        <div>
          {label}
          <Textarea
            id={id}
            rows={2}
            value={typeof value === 'string' && value !== 'none' ? value : ''}
            placeholder={q.flag ? 'Leave empty if nothing' : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}
