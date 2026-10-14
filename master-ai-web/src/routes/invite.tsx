import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { usePageTitle } from '@/lib/title';

/** Opened from an invite link: shows the company and the roles, then joins. */
export function InvitePage() {
  const { tenantId = '', token = '' } = useParams();
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const invite = useQuery({ queryKey: ['invite', tenantId, token], queryFn: () => api.invites.view(tenantId, token), retry: false });
  usePageTitle(invite.data ? `Join ${invite.data.companyName}` : 'Join');
  const accept = useMutation({
    mutationFn: () => api.invites.accept(tenantId, token, { password, ...(name && { name }) }),
    onSuccess: (auth) => {
      signIn(auth);
      navigate('/');
    },
  });

  if (invite.isPending) return <p className="p-8 text-sm text-fg-muted">Opening your invite…</p>;
  if (invite.error || !invite.data) {
    return (
      <div className="mx-auto max-w-md p-8">
        <h1 className="text-lg font-semibold text-fg">This invite can't be used</h1>
        <ErrorNote error={invite.error} className="mt-3" />
      </div>
    );
  }
  const v = invite.data;
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <form
        className="w-full max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate();
        }}
      >
        <h1 className="text-xl font-semibold text-fg">Join {v.companyName}</h1>
        <p className="text-sm text-fg-muted">
          You're invited as {v.role === 'admin' ? 'an admin' : 'a member'}
          {v.approverRoles.length > 0 && <> who approves for: {v.approverRoles.map((r) => r.name).join(', ')}</>}.
        </p>
        <p className="text-sm text-fg">{v.email}</p>
        {!v.hasAccount && (
          <Field label="Your name" htmlFor="invite-name">
            <Input id="invite-name" value={name} placeholder={v.name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field
          label={v.hasAccount ? 'Your password' : 'Choose a password'}
          htmlFor="invite-password"
          hint={v.hasAccount ? 'This email already has a login. Use its password.' : 'At least 8 characters.'}
        >
          <Input id="invite-password" type="password" autoComplete={v.hasAccount ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <ErrorNote error={accept.error} />
        <Button type="submit" className="w-full" loading={accept.isPending}>
          Join {v.companyName}
        </Button>
      </form>
    </div>
  );
}
