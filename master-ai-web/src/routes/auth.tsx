import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

const INDUSTRY_EXAMPLES = ['Travel agency', 'Dental clinic', 'Coaching institute', 'Cloud kitchen', 'CA firm', 'Interior design studio'];

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

export function SignupPage() {
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [form, setForm] = useState({ companyName: '', ownerName: '', email: '', password: '', industry: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const signup = useMutation({
    mutationFn: () => api.auth.signup(form),
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
        <Field label="What does your business do?" htmlFor="industry" hint="In your own words. For example: “Dental clinic with two branches in Kochi”.">
          <Input id="industry" value={form.industry} onChange={set('industry')} placeholder="Travel agency, dental clinic, coaching institute…" required minLength={2} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {INDUSTRY_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setForm((f) => ({ ...f, industry: ex }))}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-fg-muted hover:border-primary hover:text-primary"
            >
              {ex}
            </button>
          ))}
        </div>
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
