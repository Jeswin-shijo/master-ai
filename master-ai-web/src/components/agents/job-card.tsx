import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { AgentJobCardView, AgentView, ResolvedPack } from '@onehuman/schemas';
import { toolLabel } from '@onehuman/sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Input, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { alertWords, cardEdit, draftOf, draftProblem, isPackWord, newSet, withoutWord, withWord, type CardDraft, type SetDraft } from '@/lib/job-card';
import { cn } from '@/lib/utils';

const heading = 'text-xs font-medium text-fg-muted';
const chip = 'rounded-md bg-muted px-2 py-0.5 text-xs text-fg';

/** One part of the card, named by its heading. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <h3 id={id} className={heading}>
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * An agent's job card: what it is for, what it may do, what it never handles,
 * when it stops and hands over to a person, and what it is never allowed to do.
 * Managers edit the mission, the never list and the word sets; the sets that came
 * with the pack can't be removed and keep their words.
 */
export function JobCard({ agent, pack, canEdit }: { agent: AgentView; pack?: ResolvedPack; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const save = useMutation({
    mutationFn: (d: CardDraft) => api.agents.update(agent.id, { job: cardEdit(d) }),
    onSuccess: (updated) => {
      queryClient.setQueryData<AgentView[]>(['agents'], (all) => all?.map((a) => (a.id === updated.id ? updated : a)));
      setDraft(null);
      return queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
  const card = agent.job;
  if (!card) return null;

  if (draft) {
    const problem = draftProblem(draft);
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (!problem) save.mutate(draft);
    };
    return (
      <form onSubmit={submit} className="space-y-4 rounded-md border border-border p-3" aria-label={`Edit the job card of ${agent.name}`}>
        <JobCardEditor draft={draft} onChange={setDraft} pack={pack} />
        {problem && <p className="text-xs text-warning">{problem}</p>}
        <ErrorNote error={save.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={save.isPending} disabled={!!problem}>
            Save job card
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              save.reset();
              setDraft(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <JobCardRead card={card} pack={pack} trusted={agent.overrides.map((o) => o.tool)} />
      {canEdit && (
        <Button size="sm" variant="secondary" onClick={() => setDraft(draftOf(card))}>
          <Pencil /> Edit job card
        </Button>
      )}
    </div>
  );
}

function JobCardRead({ card, pack, trusted }: { card: AgentJobCardView; pack?: ResolvedPack; trusted: string[] }) {
  const label = (tool: string) => toolLabel(tool, pack);
  return (
    <>
      <Part title="Mission">
        <p className="text-sm text-fg">{card.mission}</p>
      </Part>

      <Part title="May do">
        <ul className="flex flex-wrap gap-1" aria-label="May do">
          {card.may.map((t) => (
            <li
              key={t}
              className={trusted.includes(t) ? 'rounded-md bg-success-soft px-2 py-0.5 text-xs text-success' : chip}
              title={trusted.includes(t) ? 'You trusted it to do this without asking' : undefined}
            >
              {label(t)}
            </li>
          ))}
        </ul>
      </Part>

      <Part title="Never handles">
        {card.never.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing listed yet.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg" aria-label="Never handles">
            {card.never.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </Part>

      <Part title="Escalates to a person when">
        {card.escalations.length === 0 ? (
          <p className="text-sm text-fg-muted">No word sets yet. It still hands over to a person whenever it is unsure.</p>
        ) : (
          <ul className="space-y-1.5">
            {card.escalations.map((s) => (
              <li key={s.id}>
                <details aria-label={s.label} className="group rounded-md border border-border px-3 py-2">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-90" aria-hidden />
                    <span className="font-medium text-fg">{s.label}</span>
                    {s.inherited && <Badge tone="cool">Inherited</Badge>}
                    <span className="text-xs text-fg-muted">
                      {s.words.length} {s.words.length === 1 ? 'word' : 'words'} · alerts {alertWords(s.alert, pack)}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    <Words set={s} />
                    {s.reply && <p className="text-xs text-fg-muted">Replies “{s.reply}”</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Part>

      {card.forbidden.length > 0 && (
        <Part title="Never allowed">
          <ul className="flex flex-wrap gap-1" aria-label="Never allowed">
            {card.forbidden.map((t) => (
              <li key={t} className="rounded-md bg-danger-soft px-2 py-0.5 text-xs text-danger">
                {label(t)}
              </li>
            ))}
          </ul>
        </Part>
      )}
    </>
  );
}

/** A set's words as chips. While editing, each word the owner added has a remove control; the pack's words have none. */
function Words({ set, onTakeOut }: { set: Pick<SetDraft, 'label' | 'words' | 'packWords'>; onTakeOut?: (word: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label={`Words for ${set.label}`}>
      {set.words.map((w, i) => (
        <li key={`${w}-${i}`} className={cn(chip, 'inline-flex max-w-full items-center gap-1 break-words')}>
          <span className="min-w-0">{w}</span>
          {onTakeOut && !isPackWord(set, w) && (
            <button type="button" className="text-fg-muted hover:text-fg" aria-label={`Take out ${w}`} onClick={() => onTakeOut(w)}>
              <X className="size-3" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function SetFacts({ set, pack }: { set: Pick<SetDraft, 'alert' | 'reply'>; pack?: ResolvedPack }) {
  return (
    <div className="space-y-0.5 text-xs text-fg-muted">
      <p>Alerts {alertWords(set.alert, pack)}</p>
      {set.reply && <p>Replies “{set.reply}”</p>}
    </div>
  );
}

/** A text box with an Add button; Enter adds too, without sending the form. */
function AddLine({ label, placeholder = label, button = 'Add', onAdd }: { label: string; placeholder?: string; button?: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <div className="flex gap-2">
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
      <Button type="button" size="sm" variant="secondary" onClick={add} disabled={!text.trim()}>
        <Plus /> {button}
      </Button>
    </div>
  );
}

function SetEditor({ set, pack, onChange, onRemove }: { set: SetDraft; pack?: ResolvedPack; onChange: (s: SetDraft) => void; onRemove?: () => void }) {
  return (
    <fieldset aria-label={set.label || 'New word set'} className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        {set.fromPack ? (
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            {set.label} {set.inherited && <Badge tone="cool">Inherited</Badge>}
          </p>
        ) : (
          <Input aria-label={`Name of the word set ${set.label}`} value={set.label} maxLength={100} onChange={(e) => onChange({ ...set, label: e.target.value })} />
        )}
        {onRemove && (
          <Button type="button" size="icon" variant="ghost" aria-label={`Remove the word set ${set.label}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
      <Words set={set} onTakeOut={(w) => onChange(withoutWord(set, w))} />
      <AddLine label={`Add a word to ${set.label}`} placeholder="Add a word" onAdd={(w) => onChange(withWord(set, w))} />
      <SetFacts set={set} pack={pack} />
    </fieldset>
  );
}

/** The card's edit form: the mission and never list inline, words added to any set, the owner's own sets added, renamed or removed. */
export function JobCardEditor({ draft, pack, onChange }: { draft: CardDraft; pack?: ResolvedPack; onChange: (d: CardDraft) => void }) {
  const missionId = useId();
  const setSet = (i: number, s: SetDraft) => onChange({ ...draft, sets: draft.sets.map((x, j) => (j === i ? s : x)) });
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={missionId} className={heading}>
          Mission
        </label>
        <Textarea id={missionId} value={draft.mission} maxLength={300} onChange={(e) => onChange({ ...draft, mission: e.target.value })} />
      </div>

      <Part title="Never handles">
        <ul className="space-y-2">
          {draft.never.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Never handles, item ${i + 1}`}
                value={item}
                maxLength={200}
                onChange={(e) => onChange({ ...draft, never: draft.never.map((n, j) => (j === i ? e.target.value : n)) })}
              />
              <Button type="button" size="icon" variant="ghost" aria-label={`Take out “${item}”`} onClick={() => onChange({ ...draft, never: draft.never.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        {draft.never.length < 20 && <AddLine label="Something it never handles" onAdd={(text) => onChange({ ...draft, never: [...draft.never, text] })} />}
      </Part>

      <Part title="Escalates to a person when">
        <p className="text-xs text-fg-muted">Any of these words in a message makes it stop and hand over to a person. The words that came with your setup stay; words you added can be taken out.</p>
        {draft.sets.map((s, i) => (
          <SetEditor
            key={s.id}
            set={s}
            pack={pack}
            onChange={(next) => setSet(i, next)}
            onRemove={s.fromPack ? undefined : () => onChange({ ...draft, sets: draft.sets.filter((_, j) => j !== i) })}
          />
        ))}
        {draft.sets.length < 30 && (
          <AddLine
            label="Name of a new word set"
            button="Add word set"
            onAdd={(label) => onChange({ ...draft, sets: [...draft.sets, newSet(label, draft.sets.map((s) => s.id))] })}
          />
        )}
      </Part>
    </div>
  );
}
