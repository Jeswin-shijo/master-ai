import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Moon, Monitor, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { ensureDeviceKey } from '@/lib/device-key';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { cn, formatDateTime } from '@/lib/utils';

/** How the AI reaches the team: the in-app simulator or real calls through Twilio. */
function PhoneCallSettings() {
  const queryClient = useQueryClient();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  const voice = useQuery({ queryKey: ['voice-status'], queryFn: api.voice.status });
  const save = useMutation({
    mutationFn: (calls: NonNullable<Parameters<typeof api.tenant.updateSettings>[0]['calls']>) => api.tenant.updateSettings({ calls }),
    onSuccess: (t) => queryClient.setQueryData(['tenant'], t),
  });
  const calls = tenant.data?.settings.calls;
  const twilio = voice.data?.twilio;
  const real = calls?.provider === 'twilio';

  const radio = 'mt-1 accent-[var(--oh-primary)]';
  return (
    <Card>
      <CardHeader title="Phone calls to the team" description="How the AI reaches the people in charge to assign work, follow up and confirm." />
      <CardBody className="space-y-5 text-sm">
        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium text-fg">How calls are made</legend>
          <label className="flex items-start gap-3">
            <input type="radio" name="provider" checked={!real} onChange={() => save.mutate({ provider: 'simulator' })} className={radio} />
            <span>
              <span className="font-medium text-fg">Simulated, in this app</span>
              <span className="block text-fg-muted">No real phone rings. Good for trying things out.</span>
            </span>
          </label>
          <label className={cn('flex items-start gap-3', !twilio?.configured && !real && 'opacity-60')}>
            <input
              type="radio"
              name="provider"
              checked={real}
              disabled={!twilio?.configured && !real}
              onChange={() => save.mutate({ provider: 'twilio' })}
              className={radio}
            />
            <span>
              <span className="font-medium text-fg">Real phone calls (Twilio)</span>
              {twilio?.configured ? (
                <span className="block text-fg-muted">
                  Calls come from <span className="font-mono">{twilio.from}</span>. Your team hears an AI voice and answers by speaking.
                  Calls only go out in each person's working hours, between 9 am and 9 pm IST.
                </span>
              ) : (
                <span className="block text-fg-muted">
                  Not set up on the server yet. Add <span className="font-mono">{twilio?.missing.join(', ') ?? '…'}</span> to{' '}
                  <span className="font-mono">master-ai-backend/.env</span> and restart <span className="font-mono">pnpm dev</span>.
                </span>
              )}
            </span>
          </label>
        </fieldset>

        {!real && (
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium text-fg">Who answers simulated calls</legend>
            {([
              ['interactive', 'You do, in this app', 'Calls ring at the bottom right. Answer as the staff member, by typing or speaking, and hear the AI.'],
              ['auto', 'A simulated staff member', 'Calls are answered automatically and cooperatively. Good for demos and tests.'],
            ] as const).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-3">
                <input type="radio" name="sim-mode" checked={calls?.simulatorMode === value} onChange={() => save.mutate({ simulatorMode: value })} className={radio} />
                <span>
                  <span className="font-medium text-fg">{label}</span>
                  <span className="block text-fg-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={calls?.fastSchedule ?? true}
            onChange={(e) => save.mutate({ fastSchedule: e.target.checked })}
            className="mt-0.5 size-4 accent-[var(--oh-primary)]"
          />
          <span>
            <span className="font-medium text-fg">Fast schedule (testing)</span>
            <span className="block text-fg-muted">
              {real
                ? 'Follow-up and confirm calls come about 30 seconds apart instead of halfway to the deadline and at the deadline. Turn this off when calling your real team.'
                : 'Follow-up and confirm calls come seconds apart instead of halfway to the deadline and at the deadline.'}
            </span>
          </span>
        </label>
        <p className="text-fg-muted">
          Up to {calls?.maxAttempts} attempts per call, {calls?.retryMinutes} minutes apart; after that the job comes back to you.
        </p>
        <ErrorNote error={save.error} />
      </CardBody>
    </Card>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  const keys = useQuery({ queryKey: ['device-keys'], queryFn: api.auth.deviceKeys });
  const [brand, setBrand] = useState<string | null>(null);
  const brandColor = brand ?? tenant.data?.settings.brandColor ?? '#ea4b71';

  const [theme, setTheme] = useTheme();
  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.tenant.updateSettings>[0]) => api.tenant.updateSettings(input),
    onSuccess: (t) => queryClient.setQueryData(['tenant'], t),
  });
  const register = useMutation({
    mutationFn: ensureDeviceKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device-keys'] }),
  });

  if (tenant.isLoading) return <Spinner />;
  const settings = tenant.data?.settings;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <Card>
        <CardHeader title="Appearance" description="Dark is the default, n8n style." />
        <CardBody className="flex flex-wrap gap-2">
          {([['dark', 'Dark', Moon], ['light', 'Light', Sun], ['system', 'System', Monitor]] as [ThemeChoice, string, typeof Moon][]).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={cn('inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm', theme === value ? 'border-primary bg-primary-soft text-fg' : 'border-border text-fg-muted hover:text-fg')}
              aria-pressed={theme === value}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </button>
          ))}
        </CardBody>
      </Card>

      <PhoneCallSettings />

      <Card>
        <CardHeader title="Brand" description="White-label the command center and mobile app with your colour." />
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Primary colour" htmlFor="brand">
            <div className="flex items-center gap-2">
              <input id="brand" type="color" value={brandColor} onChange={(e) => setBrand(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-surface" />
              <Input value={brandColor} onChange={(e) => setBrand(e.target.value)} className="w-28 font-mono" aria-label="Hex colour" />
            </div>
          </Field>
          <Button onClick={() => save.mutate({ brandColor })} loading={save.isPending && !!save.variables?.brandColor}>Save colour</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Data protection" description="India DPDP Act 2023 baseline." />
        <CardBody className="space-y-3 text-sm">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={settings?.redactPii ?? true}
              onChange={(e) => save.mutate({ redactPii: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--oh-primary)]"
            />
            <span>
              <span className="font-medium text-fg">Redact personal data before it reaches AI models</span>
              <span className="block text-fg-muted">Emails, phone numbers, PAN, Aadhaar and card numbers are replaced with placeholders and restored only inside the action itself.</span>
            </span>
          </label>
          <p className="text-fg-muted">
            Approvals expire after {settings?.approvalTtlHours} hours. Risk bands: Level 1 below {settings?.riskBands.level1Below}, Level 2 below {settings?.riskBands.level2Below}, Level 3 below {settings?.riskBands.level3Below}, approval above.
          </p>
          <ErrorNote error={save.error} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Approval signing keys"
          description="Each device that approves actions has its own key. Signatures are stored in the audit log as proof of who approved what."
          action={
            <Button size="sm" variant="secondary" onClick={() => register.mutate()} loading={register.isPending}>
              <KeyRound /> Set up this browser
            </Button>
          }
        />
        <ul className="divide-y divide-border">
          {keys.data?.map((k) => (
            <li key={k.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="text-fg">{k.label}</span>
              <span className="text-fg-muted">{k.platform} · {formatDateTime(k.createdAt)}</span>
            </li>
          ))}
        </ul>
        <ErrorNote error={register.error} className="m-5" />
      </Card>
    </div>
  );
}
