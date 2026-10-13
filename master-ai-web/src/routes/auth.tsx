import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { ORG_TYPES, SECTORS, type SectorId } from '@onehuman/schemas';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <p className="text-lg font-semibold text-fg">ONEHUMAN OS</p>
            <p className="text-sm text-fg-muted">Run your company with AI agents you supervise.</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold text-fg">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-fg-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.auth.login({ email, password }),
    onSuccess: (auth) => {
      signIn(auth);
      navigate(auth.tenant.onboarded ? '/' : '/onboarding');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Your agents kept working.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote error={login.error} />
        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        New here?{' '}
        <Link to="/signup" className="font-medium text-primary hover:underline">
          Set up your company
        </Link>
      </p>
    </AuthLayout>
  );
}

const OTHER = 'other';

export function SignupPage() {
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [form, setForm] = useState({ companyName: '', ownerName: '', email: '', password: '' });
  const [sector, setSector] = useState<SectorId>(SECTORS[0]!.id);
  const [orgType, setOrgType] = useState<string>(ORG_TYPES.find((t) => t.sector === SECTORS[0]!.id)!.id);
  const [ownWords, setOwnWords] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const signup = useMutation({
    mutationFn: () =>
      api.auth.signup({ ...form, sector, orgType: orgType === OTHER ? ownWords : orgType, ...(orgType === OTHER && { industry: ownWords }) }),
    onSuccess: (auth) => {
      signIn(auth);
      navigate('/onboarding');
    },
  });

  return (
    <AuthLayout title="Set up your company" subtitle="Tell us what your business does. The platform adapts its agents, records and rules to it.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Sector" htmlFor="sector">
          <Select
            id="sector"
            value={sector}
            onChange={(e) => {
              const next = e.target.value as SectorId;
              setSector(next);
              setOrgType(ORG_TYPES.find((t) => t.sector === next)!.id);
            }}
          >
            {SECTORS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type of organization" htmlFor="org-type">
          <Select id="org-type" value={orgType} onChange={(e) => setOrgType(e.target.value)}>
            {ORG_TYPES.filter((t) => t.sector === sector).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={OTHER}>Something else</option>
          </Select>
        </Field>
        {orgType === OTHER && (
          <Field label="What does your organization do?" htmlFor="industry" hint="In your own words. For example: “Insurance broker in Pune”.">
            <Input id="industry" value={ownWords} onChange={(e) => setOwnWords(e.target.value)} required minLength={2} />
          </Field>
        )}
        <Field label="Company name" htmlFor="company">
          <Input id="company" value={form.companyName} onChange={set('companyName')} required minLength={2} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="owner">
            <Input id="owner" autoComplete="name" value={form.ownerName} onChange={set('ownerName')} required />
          </Field>
          <Field label="Email" htmlFor="signup-email">
            <Input id="signup-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
          </Field>
        </div>
        <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
          <Input id="signup-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} />
        </Field>
        <ErrorNote error={signup.error} />
        <Button type="submit" className="w-full" loading={signup.isPending}>
          Continue
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        Already set up?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
