import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Cpu, HeartPulse, Landmark, Sparkles, Truck, Zap, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { ORG_TYPES, SECTORS } from '@onehuman/schemas/plain';
import type { SectorId } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export function AuthLayout({ title, lead, subtitle, wide, children }: { title: string; lead?: string; subtitle: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="page-glow relative flex min-h-full justify-center overflow-hidden px-4 py-10 sm:py-14">
      <div className="dots-floor pointer-events-none absolute inset-x-0 bottom-0 h-64" aria-hidden />
      <div className={cn('relative w-full', wide ? 'max-w-5xl' : 'max-w-md')}>
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <p className="font-display text-sm font-medium tracking-[0.09em] text-fg">ONEHUMAN OS</p>
        </div>
        <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }} className={cn('mt-10', wide && 'text-center')}>
          <h1 className="font-display text-4xl leading-[1.05] font-light tracking-tight text-fg sm:text-5xl">
            {lead && <span className="block text-fg-lead">{lead}</span>}
            <span className="block">{title}</span>
          </h1>
          <p className={cn('mt-4 text-base font-light text-fg-body', wide && 'mx-auto max-w-xl')}>{subtitle}</p>
        </motion.div>
        <div className="mt-10">{children}</div>
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
    <AuthLayout lead="Welcome back." title="Your agents kept working." subtitle="Sign in to see what needs you.">
      <form onSubmit={submit} className="glass space-y-4 rounded-lg p-6">
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
      <p className="mt-6 text-center text-sm text-fg-lead">
        New here?{' '}
        <Link to="/signup" className="font-medium text-fg underline decoration-line-20 underline-offset-4 hover:decoration-fg">
          Set up your organization
        </Link>
      </p>
    </AuthLayout>
  );
}

const SECTOR_ICONS: Record<SectorId, LucideIcon> = {
  'energy-heavy-industry': Zap,
  'trade-logistics-tourism': Truck,
  'finance-development': Landmark,
  'technology-innovation': Cpu,
  'public-services': HeartPulse,
};
const STEPS = ['Organization type', 'Your organization', 'Account'] as const;
const OTHER = 'other';
const step = { initial: { opacity: 0, y: 25 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } } as const;

function StepIndicator({ at }: { at: number }) {
  return (
    <ol className="mb-10 flex flex-wrap items-center justify-center gap-y-3" aria-label="Signup steps">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center" aria-current={i === at ? 'step' : undefined}>
          {i > 0 && <span className={cn('mx-3 h-px w-8 sm:w-20', i <= at ? 'bg-glow' : 'border-t border-dashed border-line-20')} aria-hidden />}
          <span
            className={cn(
              'grid size-7 place-items-center rounded-sm text-xs font-semibold tabular-nums',
              i === at ? 'btn-action' : i < at ? 'bg-success-soft text-success' : 'text-fg-lead outline-1 outline-line-20 outline-dashed',
            )}
          >
            {i < at ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn('ml-2 text-sm max-sm:sr-only', i === at ? 'text-fg' : 'text-fg-muted')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function SignupPage() {
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [at, setAt] = useState(0);
  const [sector, setSector] = useState<SectorId | null>(null);
  const [orgType, setOrgType] = useState<string | null>(null);
  const [ownWords, setOwnWords] = useState('');
  const [form, setForm] = useState({ companyName: '', ownerName: '', email: '', password: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const signup = useMutation({
    mutationFn: () =>
      api.auth.signup({ ...form, sector: sector!, orgType: orgType === OTHER ? ownWords.trim() : orgType!, ...(orgType === OTHER && { industry: ownWords.trim() }) }),
    onSuccess: (auth) => {
      signIn(auth);
      navigate('/onboarding');
    },
  });
  const typeReady = !!orgType && (orgType !== OTHER || ownWords.trim().length >= 2);

  return (
    <AuthLayout wide lead="Tell us what you run." title="Every stage gets your words." subtitle="Pick your kind of organization. Your requests, approvals and reports are set up the way your sector works.">
      <StepIndicator at={at} />
      <AnimatePresence mode="wait">
        {at === 0 && (
          <motion.div key="sector" {...step}>
            <div role="radiogroup" aria-label="Sector" className="grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-5">
              {SECTORS.map((s) => {
                const Icon = SECTOR_ICONS[s.id];
                return (
                  <button key={s.id} type="button" role="radio" aria-checked={sector === s.id} onClick={() => setSector(s.id)} className="select-card flex min-h-48 flex-col items-start rounded-lg p-5 text-left">
                    <span className="grid size-11 place-items-center rounded-md bg-node text-accent">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="mt-8 font-display text-lg leading-tight text-fg">{s.name}</span>
                    <span className="mt-2 text-sm text-fg-lead">{s.examples}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-10 flex justify-center">
              <Button size="lg" disabled={!sector} onClick={() => (setOrgType(null), setAt(1))}>
                Continue
              </Button>
            </div>
          </motion.div>
        )}
        {at === 1 && sector && (
          <motion.div key="type" {...step}>
            <div role="radiogroup" aria-label="Type of organization" className="mx-auto grid max-w-4xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
              {ORG_TYPES.filter((t) => t.sector === sector).map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={orgType === t.id} onClick={() => setOrgType(t.id)} className="select-card min-h-28 rounded-lg p-5 text-left">
                  <span className="font-display text-lg leading-tight text-fg">{t.name}</span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={orgType === OTHER} onClick={() => setOrgType(OTHER)} className="select-card min-h-28 rounded-lg p-5 text-left">
                <span className="flex items-center gap-2 font-display text-lg leading-tight text-fg">
                  <Sparkles className="size-4 text-accent" aria-hidden /> Something else
                </span>
                <span className="mt-2 block text-sm text-fg-lead">Describe it in your own words</span>
              </button>
            </div>
            {orgType === OTHER && (
              <div className="mx-auto mt-6 max-w-md text-left">
                <Field label="What does your organization do?" htmlFor="own-words" hint="For example: “Insurance broker in Pune”.">
                  <Input id="own-words" value={ownWords} onChange={(e) => setOwnWords(e.target.value)} autoFocus />
                </Field>
              </div>
            )}
            <div className="mt-10 flex justify-center gap-3">
              <Button variant="ghost" size="lg" onClick={() => setAt(0)}>
                Back
              </Button>
              <Button size="lg" disabled={!typeReady} onClick={() => setAt(2)}>
                Continue
              </Button>
            </div>
          </motion.div>
        )}
        {at === 2 && (
          <motion.form
            key="account"
            {...step}
            className="glass mx-auto max-w-md space-y-4 rounded-lg p-6 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              signup.mutate();
            }}
          >
            <Field label="Organization name" htmlFor="company">
              <Input id="company" value={form.companyName} onChange={set('companyName')} required minLength={2} />
            </Field>
            <Field label="Your name" htmlFor="owner">
              <Input id="owner" autoComplete="name" value={form.ownerName} onChange={set('ownerName')} required />
            </Field>
            <Field label="Email" htmlFor="signup-email">
              <Input id="signup-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
              <Input id="signup-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} />
            </Field>
            <ErrorNote error={signup.error} />
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setAt(1)}>
                Back
              </Button>
              <Button type="submit" className="flex-1" loading={signup.isPending}>
                Create my organization
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      <p className="mt-8 text-center text-sm text-fg-lead">
        Already set up?{' '}
        <Link to="/login" className="font-medium text-fg underline decoration-line-20 underline-offset-4 hover:decoration-fg">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
