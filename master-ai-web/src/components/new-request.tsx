import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useNewRequest } from '@/lib/new-request';

/** "New request": what's needed, in the person's own words. The case engine does the rest. */
export function NewRequestDialog() {
  const { open, preset, hide } = useNewRequest();
  const navigate = useNavigate();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list, enabled: open });
  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const label = lifecycle?.case.label ?? 'Request';
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [onBehalf, setOnBehalf] = useState('');

  useEffect(() => {
    if (!open) return;
    setText(preset?.text ?? '');
    setCategory(preset?.category ?? '');
    setAmount('');
    setOnBehalf('');
  }, [open, preset]);

  const create = useMutation({
    mutationFn: () =>
      api.cases.create({
        text,
        ...(category && { category }),
        ...(amount.trim() && { amountInr: Number(amount.replace(/[,₹\s]/g, '')) }),
        ...(onBehalf.trim() && { requester: { name: onBehalf.trim() } }),
      }),
    onSuccess: (c) => {
      hide();
      navigate(`/cases/${c.id}`);
    },
  });

  return (
    <Dialog open={open} onClose={hide} lead="New" title={label.toLowerCase()}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3) create.mutate();
        }}
      >
        <Field label="What's needed?" htmlFor="request-text" hint="In your own words. The system checks, sorts and routes it.">
          <Textarea id="request-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} required minLength={3} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type (optional)" htmlFor="request-type">
            <Select id="request-type" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Let the system decide</option>
              {(lifecycle?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount in ₹ (optional)" htmlFor="request-amount">
            <Input id="request-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 45,000" />
          </Field>
        </div>
        <Field label="On behalf of (optional)" htmlFor="request-for" hint="A walk-in customer or a caller, if it isn't you.">
          <Input id="request-for" value={onBehalf} onChange={(e) => setOnBehalf(e.target.value)} />
        </Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={hide}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Raise {label.toLowerCase()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
