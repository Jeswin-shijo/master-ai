import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, KeyRound, Plus } from 'lucide-react';
import type { CreatedIntakeKey } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { api, API_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';

/** Requests from outside: a public form for customers, keys for systems and partners. Each becomes a case. */
export function RequestKeysCard() {
  const queryClient = useQueryClient();
  const tenantId = useSession((s) => s.user?.tenantId);
  const keys = useQuery({ queryKey: ['intake-keys'], queryFn: api.intakeKeys.list });
  const [kind, setKind] = useState<'form' | 'api'>('form');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<'system' | 'partner'>('system');
  const [made, setMade] = useState<CreatedIntakeKey | null>(null);
  const create = useMutation({
    mutationFn: () => api.intakeKeys.create({ kind, label, ...(kind === 'api' && { source }) }),
    onSuccess: (k) => {
      setMade(k);
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['intake-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.intakeKeys.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intake-keys'] }),
  });
  const live = (keys.data ?? []).filter((k) => !k.revokedAt);

  return (
    <Card>
      <CardHeader title="Requests from outside" description="A form for your customers, and keys for the systems and partners that raise requests. Each request becomes a case." />
      <CardBody className="space-y-5">
        {made && (
          <div className="glass-warm space-y-3 rounded-md p-4" role="status">
            <p className="text-sm font-medium text-fg">{made.kind === 'form' ? 'Your request form is ready. Share this link.' : 'Copy this key now. It is shown only once.'}</p>
            {made.kind === 'form' && made.formPath ? (
              <CopyField label="Form link" value={`${window.location.origin}${made.formPath}`} />
            ) : (
              <CopyField label="Key" value={made.key} />
            )}
            {made.kind === 'api' && (
              <details className="text-sm text-fg-lead">
                <summary className="cursor-pointer hover:text-fg">For the person connecting your system</summary>
                <p className="mt-2">
                  Send requests to <span className="break-all text-fg">{`${API_URL}/intake/${tenantId}/cases`}</span> with this key as a bearer token.
                </p>
              </details>
            )}
            <Button variant="ghost" size="sm" onClick={() => setMade(null)}>
              Done
            </Button>
          </div>
        )}

        {keys.isLoading ? (
          <Spinner />
        ) : live.length === 0 ? (
          <p className="text-sm text-fg-lead">No form or key yet.</p>
        ) : (
          <ul className="divide-y divide-line-10">
            {live.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                {k.kind === 'form' ? <Globe className="size-4 text-accent" aria-hidden /> : <KeyRound className="size-4 text-accent" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{k.label}</span>
                  <span className="block text-xs text-fg-muted">
                    {k.kind === 'form' ? 'Customer form' : k.source === 'partner' ? 'Partner key' : 'System key'} · {k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt)}` : 'not used yet'}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revoke.isPending && revoke.variables === k.id}
                  onClick={() => {
                    if (window.confirm(`Stop “${k.label}”? Requests sent with it will be refused.`)) revoke.mutate(k.id);
                  }}
                >
                  Stop
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-fg-muted">Links and keys are shown once. Lost one? Stop it and make a new one.</p>

        <form
          className="grid gap-3 border-t border-line-10 pt-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Kind" htmlFor="key-kind">
            <Select id="key-kind" value={kind} onChange={(e) => setKind(e.target.value as 'form' | 'api')}>
              <option value="form">Customer form</option>
              <option value="api">System or partner key</option>
            </Select>
          </Field>
          <Field label="Name" htmlFor="key-label" hint={kind === 'form' ? 'For example: Website contact page' : 'For example: SCADA alarms'}>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} />
          </Field>
          {kind === 'api' && (
            <Field label="Who sends" htmlFor="key-source">
              <Select id="key-source" value={source} onChange={(e) => setSource(e.target.value as 'system' | 'partner')}>
                <option value="system">One of our systems</option>
                <option value="partner">A partner</option>
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" loading={create.isPending}>
              <Plus /> {kind === 'form' ? 'Make a form link' : 'Make a key'}
            </Button>
          </div>
        </form>
        <ErrorNote error={create.error ?? revoke.error} />
      </CardBody>
    </Card>
  );
}
