import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import type { PackDraft } from '@onehuman/schemas';
import { PackSummary } from '@/components/pack-summary';
import { StagesPreview } from '@/components/stages-preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { GENERIC_STAGE_NAMES, stageNames } from '@/lib/cases';
import { useSession } from '@/lib/session';
import { usePageTitle } from '@/lib/title';

/**
 * The platform adapts to the organization: it picks a ready-made setup or
 * composes one, shows exactly what it will set up (the 8 stages in the
 * organization's own words first), and installs it on approval.
 */
export function OnboardingPage() {
  const tenant = useSession((s) => s.tenant);
  const setTenant = useSession((s) => s.setTenant);
  usePageTitle('Set up');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [industry, setIndustry] = useState(tenant?.industry ?? '');
  const [sampleData, setSampleData] = useState(true);
  const [draft, setDraft] = useState<PackDraft | null>(null);

  const preview = useMutation({
    mutationFn: (opts: { industry?: string; forceGenerate?: boolean }) => api.onboarding.preview(opts),
    onSuccess: setDraft,
  });
  const install = useMutation({
    mutationFn: () => api.onboarding.install({ draftId: draft!.id, sampleData }),
    onSuccess: async () => {
      setTenant(await api.tenant.get());
      await queryClient.invalidateQueries();
      navigate('/');
    },
  });

  // Draft once on arrival, from the organization type chosen at signup.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    preview.mutate({});
  }, [preview]);

  const lc = draft?.pack.lifecycle;
  const names = Object.values(stageNames(lc));
  const caseLabel = lc?.case.label ?? 'Case';
  const approvers = (lc?.roles ?? []).filter((r) => r.id !== 'owner');

  return (
    <div className="page-glow min-h-full">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
          <p className="text-sm font-medium text-warning">Last step</p>
          <h1 className="mt-2 font-display text-4xl leading-[1.05] font-light text-fg sm:text-5xl">
            <span className="block text-fg-lead">Your organization,</span>
            <span className="block">ready to run.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base font-light text-fg-body">
            This is set up for <span className="text-fg">{draft?.industry ?? tenant?.industry}</span>. Nothing runs until you install it, and every risky step still needs the right person's approval.
          </p>
        </motion.div>

        <form
          className="mt-6 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            preview.mutate({ industry });
          }}
        >
          <Input value={industry} onChange={(e) => setIndustry(e.target.value)} className="max-w-md" aria-label="Describe your organization" />
          <Button type="submit" variant="secondary" loading={preview.isPending && !preview.variables?.forceGenerate}>
            <RefreshCw /> Adapt to this
          </Button>
        </form>

        <ErrorNote error={preview.error} className="mt-4" />
        {preview.isPending && <Spinner label="Setting up your organization…" />}

        {draft && !preview.isPending && (
          <div className="mt-10 space-y-10">
            <section>
              <h2 className="font-display text-2xl font-light text-fg">
                <span className="text-fg-lead">Every request becomes a</span> {caseLabel.toLowerCase()}.
              </h2>
              <p className="mt-2 text-sm text-fg-lead">It runs these 8 stages, named the way you work.</p>
              <div className="mt-5">
                <StagesPreview names={names.length === 8 ? names : Object.values(GENERIC_STAGE_NAMES)} caseLabel={caseLabel} />
              </div>
            </section>

            {lc && (
              <section className="grid gap-4 md:grid-cols-2">
                <div className="glass rounded-lg p-5">
                  <h3 className="text-base font-medium">Kinds of {lc.case.plural.toLowerCase()}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lc.categories.map((c) => (
                      <Chip key={c.id} tone={c.priority === 'P1' ? 'danger' : 'neutral'}>
                        {c.name}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="glass rounded-lg p-5">
                  <h3 className="text-base font-medium">Who approves</h3>
                  <ul className="mt-3 space-y-2 text-sm">
                    {approvers.length === 0 && <li className="text-fg-lead">You approve everything that needs approval.</li>}
                    {approvers.map((r) => (
                      <li key={r.id}>
                        <span className="text-fg">{r.name}</span> <span className="text-fg-lead">· {r.approves}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-fg-muted">Invite these people from Team. Until then, their approvals come to you.</p>
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-light text-fg">{draft.pack.name}</h2>
              <Badge tone={draft.source === 'registry' ? 'success' : 'cool'}>
                {draft.generator === 'registry' ? 'Ready-made' : draft.generator === 'llm' ? 'Designed by AI' : 'Built from your sector'}
              </Badge>
              {draft.source === 'registry' && (
                <Button variant="ghost" size="sm" onClick={() => preview.mutate({ industry: draft.industry, forceGenerate: true })}>
                  <Sparkles /> Design a custom setup instead
                </Button>
              )}
            </div>
            <p className="-mt-6 text-sm text-fg-lead">{draft.rationale}</p>
            <PackSummary pack={draft.pack} />

            <div className="flex flex-wrap items-center gap-4 border-t border-line-10 pt-6">
              <label className="flex items-center gap-2 text-sm text-fg-body">
                <input type="checkbox" checked={sampleData} onChange={(e) => setSampleData(e.target.checked)} className="size-4 accent-[var(--oh-glow)]" />
                Add a few sample records and people so I can try it
              </label>
              <Button size="lg" className="ml-auto" onClick={() => install.mutate()} loading={install.isPending}>
                Install and open Home
              </Button>
            </div>
            <ErrorNote error={install.error} />
          </div>
        )}
      </div>
    </div>
  );
}
