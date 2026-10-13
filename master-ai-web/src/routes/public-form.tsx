import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { AuthLayout } from '@/routes/auth';

const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

/** The public request form: a customer raises a request without an account. */
export function PublicFormPage() {
  const { tenantId = '', key = '' } = useParams();
  const form = useQuery({ queryKey: ['public-form', tenantId, key], queryFn: () => api.intake.form(tenantId, key), retry: false });
  const [fields, setFields] = useState({ name: '', phone: '', email: '', text: '' });
  const set = (k: keyof typeof fields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const send = useMutation({
    mutationFn: () =>
      api.intake.submitForm(tenantId, key, {
        name: fields.name,
        text: fields.text,
        ...(fields.phone.trim() && { phone: fields.phone.trim() }),
        ...(fields.email.trim() && { email: fields.email.trim() }),
      }),
  });

  if (form.isPending) return <Spinner label="Opening the form…" />;
  if (form.error || !form.data) {
    return (
      <AuthLayout lead="This link" title="doesn't work any more." subtitle="Ask the organization for a new one.">
        <ErrorNote error={form.error} />
      </AuthLayout>
    );
  }
  const { companyName, caseLabel } = form.data;
  const noun = caseLabel.toLowerCase();

  if (send.data) {
    return (
      <AuthLayout lead="Thank you." title="We have your request." subtitle={`${companyName} will contact you. Keep this reference.`}>
        <div className="glass flex items-center gap-4 rounded-lg p-5" role="status">
          <CheckCircle2 className="size-7 shrink-0 text-success" aria-hidden />
          <div>
            <p className="text-sm text-fg-lead">Your reference</p>
            <p className="font-display text-2xl text-fg tabular-nums">{send.data.code}</p>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const reachable = !!fields.phone.trim() || !!fields.email.trim();
  return (
    <AuthLayout lead={companyName} title={`Raise ${withArticle(noun)}.`} subtitle="Tell us what you need. We reply on the phone number or email you give.">
      <form
        className="glass space-y-4 rounded-lg p-6"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field label="Your name" htmlFor="pf-name">
          <Input id="pf-name" autoComplete="name" value={fields.name} onChange={set('name')} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="pf-phone">
            <Input id="pf-phone" type="tel" autoComplete="tel" value={fields.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email" htmlFor="pf-email">
            <Input id="pf-email" type="email" autoComplete="email" value={fields.email} onChange={set('email')} />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-fg-muted">A phone number or an email, so we can reach you.</p>
        <Field label="What do you need?" htmlFor="pf-text">
          <Textarea id="pf-text" rows={5} value={fields.text} onChange={set('text')} required minLength={3} maxLength={4000} />
        </Field>
        <ErrorNote error={send.error} />
        <Button type="submit" className="w-full" loading={send.isPending} disabled={!reachable}>
          Send {noun}
        </Button>
      </form>
    </AuthLayout>
  );
}
