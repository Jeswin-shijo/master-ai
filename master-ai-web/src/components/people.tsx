import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import type { CreatedInvite, HumanRole, Invite, LifecycleRole, Member, StaffMember } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { CopyField } from '@/components/ui/copy-field';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { canEditMember, canRemoveMember, roleHolders } from '@/lib/people';
import { formatDateTime } from '@/lib/utils';

const ACCESS: Record<HumanRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function RolePicker({ roles, value, onChange, idPrefix }: { roles: LifecycleRole[]; value: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  if (roles.length === 0) return <p className="text-sm text-fg-lead">Your setup has no approval roles yet.</p>;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-fg">Approves as</legend>
      {roles.map((r) => (
        <label key={r.id} htmlFor={`${idPrefix}-${r.id}`} className="flex min-h-11 items-start gap-2 text-sm sm:min-h-0">
          <input
            id={`${idPrefix}-${r.id}`}
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--oh-glow)]"
            checked={value.includes(r.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))}
          />
          <span>
            <span className="text-fg">{r.name}</span> <span className="text-fg-lead">· {r.approves}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A person with a login: access, approval roles, and the person in charge they answer calls as. */
export function MemberCard({ member, roles, staff, me }: { member: Member; roles: LifecycleRole[]; staff: StaffMember[]; me: { role: HumanRole; principalId: string } }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [access, setAccess] = useState<'admin' | 'member'>(member.role === 'admin' ? 'admin' : 'member');
  const [approverRoles, setApproverRoles] = useState(member.approverRoles);
  const [staffId, setStaffId] = useState(member.staffId ?? '');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['members'] });
  const save = useMutation({
    mutationFn: () => api.members.update(member.id, { role: access, approverRoles, staffId: staffId || null }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api.members.remove(member.id), onSuccess: refresh });
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'A role no longer in your setup';
  const linked = staff.find((s) => s.id === member.staffId);

  return (
    <article className="glass rounded-lg p-5" aria-label={member.name}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{initials(member.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{member.name}</p>
          <p className="truncate text-sm text-fg-lead">{member.email}</p>
        </div>
        <Chip tone={member.role === 'member' ? 'neutral' : 'cool'}>{ACCESS[member.role]}</Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {member.role === 'owner' && <Chip tone="waiting">Approves anything</Chip>}
        {member.approverRoles.map((r) => (
          <Chip key={r} tone="waiting">
            {roleName(r)}
          </Chip>
        ))}
        {member.status === 'paused' && <Chip>Paused</Chip>}
      </div>
      {linked && <p className="mt-2 text-xs text-fg-muted">Answers calls as {linked.name}</p>}

      {editing ? (
        <form
          className="mt-4 space-y-4 border-t border-line-10 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Access" htmlFor={`access-${member.id}`}>
            <Select id={`access-${member.id}`} value={access} onChange={(e) => setAccess(e.target.value as 'admin' | 'member')}>
              <option value="member">Member: does the work, decides for their roles</option>
              <option value="admin">Admin: also manages people and settings</option>
            </Select>
          </Field>
          <RolePicker roles={roles} value={approverRoles} onChange={setApproverRoles} idPrefix={`roles-${member.id}`} />
          <Field label="Answers calls as" htmlFor={`staff-${member.id}`} hint="The person in charge the AI phones, if this is them.">
            <Select id={`staff-${member.id}`} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Nobody</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        canEditMember(me, member) && (
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
            {canRemoveMember(me, member) && (
              <Button
                variant="ghost"
                size="sm"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Remove ${member.name}? They lose access at once.`)) remove.mutate();
                }}
              >
                Remove
              </Button>
            )}
          </div>
        )
      )}
      <ErrorNote error={save.error ?? remove.error} className="mt-3" />
    </article>
  );
}

/** Invite by email; the link is shown once, to send however the owner likes. */
export function InviteForm({ roles, onDone }: { roles: LifecycleRole[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{ name: string; email: string; role: 'admin' | 'member' }>({ name: '', email: '', role: 'member' });
  const [approverRoles, setApproverRoles] = useState<string[]>([]);
  const [made, setMade] = useState<CreatedInvite | null>(null);
  const invite = useMutation({
    mutationFn: () => api.invites.create({ ...form, approverRoles }),
    onSuccess: (inv) => {
      setMade(inv);
      void queryClient.invalidateQueries({ queryKey: ['invites'] });
    },
  });

  if (made) {
    return (
      <Card className="glass-warm">
        <CardHeader title={`Send this link to ${made.name}`} description="It works once and lasts 7 days. Send it on WhatsApp, SMS or email." />
        <CardBody className="space-y-3">
          <CopyField label="Invite link" value={made.link} />
          <Button variant="ghost" size="sm" onClick={onDone}>
            Done
          </Button>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Invite a person" description="They get their own login, see the work, and decide what their roles approve." />
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Field label="Name" htmlFor="inv-name">
            <Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email" htmlFor="inv-email">
            <Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Access" htmlFor="inv-role">
            <Select id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'member' })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <RolePicker roles={roles} value={approverRoles} onChange={setApproverRoles} idPrefix="inv-roles" />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={invite.isPending}>
              <UserPlus /> Create invite link
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
        <ErrorNote error={invite.error} className="mt-3" />
      </CardBody>
    </Card>
  );
}

/** Open invites, each withdrawable. */
export function InviteList({ invites, roles }: { invites: Invite[]; roles: LifecycleRole[] }) {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: string) => api.invites.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  return (
    <Card>
      <CardHeader title="Invites not yet used" />
      <ul className="divide-y divide-line-10">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">
                {i.name} <span className="font-normal text-fg-lead">· {i.email}</span>
              </span>
              <span className="block text-xs text-fg-muted">
                {ACCESS[i.role]}
                {i.approverRoles.length > 0 && ` · approves as ${i.approverRoles.map((r) => roles.find((x) => x.id === r)?.name ?? 'a role').join(', ')}`} · expires{' '}
                {formatDateTime(i.expiresAt)}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)} loading={revoke.isPending && revoke.variables === i.id}>
              Withdraw
            </Button>
          </li>
        ))}
      </ul>
      <ErrorNote error={revoke.error} className="mx-5 mb-4" />
    </Card>
  );
}

/** Each approval role and who holds it. Unheld roles send their approvals to the owner. */
export function WhoApproves({ roles, members }: { roles: LifecycleRole[]; members: Member[] }) {
  return (
    <Card>
      <CardHeader title="Who approves what" description="Set by your organization type. A role with nobody in it sends its approvals to the owner." />
      <ul className="divide-y divide-line-10">
        {roleHolders(roles, members).map(({ role, holders }) => (
          <li key={role.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm">
            <span className="font-medium text-fg">{role.name}</span>
            <span className="min-w-0 flex-1 text-fg-lead">{role.approves}</span>
            <span className={holders.length > 0 ? 'text-fg' : 'text-warning'}>{holders.length > 0 ? holders.join(', ') : 'Nobody yet, so it comes to the owner'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
