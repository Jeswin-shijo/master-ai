import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, UserRound } from 'lucide-react';
import type { StaffMember } from '@onehuman/schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { PackUpdatesBanner } from '@/components/pack-updates';
import { api } from '@/lib/api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function PersonCard({ person }: { person: StaffMember }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.team.update(person.id, { status: person.status === 'active' ? 'inactive' : 'active' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });
  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{initials(person.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{person.name}</p>
          <p className="text-sm text-fg-muted">{person.title}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-fg-muted">
            <Phone className="size-3" aria-hidden /> {person.phone}
          </p>
        </div>
        <Badge tone={person.status === 'active' ? 'success' : 'neutral'}>{person.status}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {person.responsibilities.map((r) => (
          <span key={r} className="rounded-md bg-muted px-2 py-0.5 text-xs text-fg-muted">{r}</span>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/60 py-2"><dt className="text-[11px] text-fg-muted">Calls</dt><dd className="font-semibold tabular-nums">{person.stats.calls}</dd></div>
        <div className="rounded-lg bg-muted/60 py-2"><dt className="text-[11px] text-fg-muted">Open jobs</dt><dd className="font-semibold tabular-nums">{person.stats.openDelegations}</dd></div>
        <div className="rounded-lg bg-muted/60 py-2"><dt className="text-[11px] text-fg-muted">Done</dt><dd className="font-semibold tabular-nums">{person.stats.done}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between text-xs text-fg-muted">
        <span>
          Calls {person.workingHours.days.map((d) => DAYS[d]).join(' ')} · {person.workingHours.start}–{person.workingHours.end}
        </span>
        <button className="hover:text-fg" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
          {person.status === 'active' ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </article>
  );
}

function AddPerson({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', phone: '+91 ', title: '', responsibilities: '', start: '09:00', end: '19:00' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const add = useMutation({
    mutationFn: () =>
      api.team.add({
        name: form.name,
        phone: form.phone,
        title: form.title,
        responsibilities: form.responsibilities.split(',').map((s) => s.trim()).filter(Boolean),
        workingHours: { days: [1, 2, 3, 4, 5, 6], start: form.start, end: form.end },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team'] });
      onDone();
    },
  });
  return (
    <Card>
      <CardHeader title="Add a person in charge" description="The AI phones them to assign work, follow up and confirm it's done." />
      <CardBody>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Name" htmlFor="p-name"><Input id="p-name" value={form.name} onChange={set('name')} required /></Field>
          <Field label="Phone" htmlFor="p-phone"><Input id="p-phone" value={form.phone} onChange={set('phone')} required /></Field>
          <Field label="Job title" htmlFor="p-title"><Input id="p-title" value={form.title} onChange={set('title')} placeholder="Operations manager" required /></Field>
          <Field label="In charge of" htmlFor="p-resp" hint="Comma separated, e.g. bookings, hotels, inspections">
            <Input id="p-resp" value={form.responsibilities} onChange={set('responsibilities')} />
          </Field>
          <Field label="Calls from" htmlFor="p-start"><Input id="p-start" type="time" value={form.start} onChange={set('start')} /></Field>
          <Field label="Calls until" htmlFor="p-end"><Input id="p-end" type="time" value={form.end} onChange={set('end')} /></Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={add.isPending}>Add to team</Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
        <ErrorNote error={add.error} className="mt-3" />
      </CardBody>
    </Card>
  );
}

export function TeamPage() {
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list });
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="The people in charge. Work is handed to them by phone: the AI assigns it, follows up and confirms it's done. Calls only go out in their working hours (9 am–9 pm at most)."
        action={!adding && <Button onClick={() => setAdding(true)}><Plus /> Add person</Button>}
      />
      <PackUpdatesBanner />
      {adding && <AddPerson onDone={() => setAdding(false)} />}
      {team.isLoading && <Spinner />}
      <ErrorNote error={team.error} />
      {team.data?.length === 0 && !adding && (
        <EmptyState icon={<UserRound />} title="No one in the team yet">Add the people in charge so agents can delegate work to them by phone.</EmptyState>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        {team.data?.map((p) => <PersonCard key={p.id} person={p} />)}
      </div>
    </div>
  );
}
