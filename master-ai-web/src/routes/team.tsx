import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, UserPlus, UserRound } from 'lucide-react';
import type { StaffMember } from '@onehuman/schemas';
import { PackUpdatesBanner } from '@/components/pack-updates';
import { initials, InviteForm, InviteList, MemberCard, WhoApproves } from '@/components/people';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PersonCard({ person, manager }: { person: StaffMember; manager: boolean }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.team.update(person.id, { status: person.status === 'active' ? 'inactive' : 'active' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });
  return (
    <article className="glass rounded-lg p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{initials(person.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{person.name}</p>
          <p className="truncate text-sm text-fg-lead">{person.title}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-muted tabular-nums">
            <Phone className="size-3" aria-hidden /> {person.phone}
          </p>
        </div>
        <Chip tone={person.status === 'active' ? 'success' : 'neutral'}>{person.status === 'active' ? 'Active' : 'Off'}</Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {person.responsibilities.map((r) => (
          <Chip key={r}>{r}</Chip>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Calls', person.stats.calls],
          ['Open jobs', person.stats.openDelegations],
          ['Done', person.stats.done],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md bg-line-5 py-2">
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="font-semibold text-fg tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>
          Calls {person.workingHours.days.map((d) => DAYS[d]).join(' ')} · {person.workingHours.start}–{person.workingHours.end}
        </span>
        {manager && (
          <button className="min-h-11 hover:text-fg sm:min-h-0" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
            {person.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
        )}
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
          <Field label="Name" htmlFor="p-name">
            <Input id="p-name" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Phone" htmlFor="p-phone">
            <Input id="p-phone" value={form.phone} onChange={set('phone')} required />
          </Field>
          <Field label="Job title" htmlFor="p-title">
            <Input id="p-title" value={form.title} onChange={set('title')} placeholder="Operations manager" required />
          </Field>
          <Field label="In charge of" htmlFor="p-resp" hint="Comma separated, e.g. bookings, hotels, inspections">
            <Input id="p-resp" value={form.responsibilities} onChange={set('responsibilities')} />
          </Field>
          <Field label="Calls from" htmlFor="p-start">
            <Input id="p-start" type="time" value={form.start} onChange={set('start')} />
          </Field>
          <Field label="Calls until" htmlFor="p-end">
            <Input id="p-end" type="time" value={form.end} onChange={set('end')} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={add.isPending}>
              Add to team
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
        <ErrorNote error={add.error} className="mt-3" />
      </CardBody>
    </Card>
  );
}

/** People with a login and the roles they approve for, open invites, and the people in charge the AI phones. */
export function TeamPage() {
  const user = useSession((s) => s.user);
  const manager = user?.role === 'owner' || user?.role === 'admin';
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list });
  const members = useQuery({ queryKey: ['members'], queryFn: api.members.list });
  const invites = useQuery({ queryKey: ['invites'], queryFn: api.invites.list, enabled: manager });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const roles = (workspaces.data?.[0]?.pack.lifecycle?.roles ?? []).filter((r) => r.id !== 'owner');
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const people = (members.data ?? []).filter((m) => m.status !== 'retired');
  const pending = (invites.data ?? []).filter((i) => i.status === 'pending');

  return (
    <div className="space-y-10">
      <PageHeader
        lead="Your people,"
        title="and what each one decides."
        description="People with a login see the work and decide what their roles approve. People in charge get the AI's phone calls."
        action={
          manager &&
          !inviting && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus /> Invite a person
            </Button>
          )
        }
      />
      <PackUpdatesBanner />
      {inviting && <InviteForm roles={roles} onDone={() => setInviting(false)} />}

      <section aria-labelledby="logins" className="space-y-4">
        <h2 id="logins" className="font-display text-xl font-light text-fg">
          People with a login
        </h2>
        <ErrorNote error={members.error} />
        {members.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {user &&
              people.map((m) => <MemberCard key={m.id} member={m} roles={roles} staff={team.data ?? []} me={{ role: user.role, principalId: user.principalId }} />)}
          </div>
        )}
      </section>

      {manager && pending.length > 0 && <InviteList invites={pending} roles={roles} />}
      {roles.length > 0 && <WhoApproves roles={roles} members={people} />}

      <section aria-labelledby="in-charge" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="in-charge" className="font-display text-xl font-light text-fg">
              People in charge
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-lead">
              Work is handed to them by phone: the AI assigns it, follows up and confirms it's done. Calls only go out in their working hours (9 am–9 pm at most).
            </p>
          </div>
          {manager && !adding && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus /> Add person
            </Button>
          )}
        </div>
        {adding && <AddPerson onDone={() => setAdding(false)} />}
        {team.isLoading && <Spinner />}
        <ErrorNote error={team.error} />
        {team.data?.length === 0 && !adding && (
          <EmptyState icon={<UserRound />} title="No one in charge yet">
            Add the people in charge so work can be handed to them by phone.
          </EmptyState>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {team.data?.map((p) => <PersonCard key={p.id} person={p} manager={manager} />)}
        </div>
      </section>
    </div>
  );
}
