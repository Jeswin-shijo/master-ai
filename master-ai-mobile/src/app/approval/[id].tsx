import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Platform, View } from 'react-native';
import { approvalHeading, readableFields, stageNames } from '@onehuman/sdk';
import { Badge, Button, Card, H, Input, RiskBar, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { confirmWithBiometrics, signDecision } from '@/lib/device-key';
import { cachedApprovals, submitDecision } from '@/lib/offline';
import { space, useTheme } from '@/lib/theme';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One decision, read before it is signed: the question, the risk, the evidence, then approve or reject with a note. */
export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);

  const approval = useQuery({
    queryKey: ['approval', id],
    queryFn: async () => {
      try {
        return await api.approvals.get(id);
      } catch {
        const cached = (await cachedApprovals()).find((a) => a.id === id);
        if (cached) return cached;
        throw new Error('This approval is not available offline');
      }
    },
  });
  const caseId = approval.data?.caseId ?? null;
  // The case gives the question its words. With no signal it can't load, and the approval's own words stand in.
  const caseDetail = useQuery({ queryKey: ['case', caseId], queryFn: () => api.cases.get(caseId!), enabled: !!caseId, retry: false });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list, retry: false });

  const decide = async (decision: 'approved' | 'rejected') => {
    const a = approval.data;
    if (!a) return;
    const ok = await confirmWithBiometrics(decision === 'approved' ? `Approve: ${a.summary}` : `Reject: ${a.summary}`);
    if (!ok) return;
    setBusy(decision);
    try {
      const result = await submitDecision(await signDecision(a.id, decision, notes.trim() || undefined));
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['case'] });
      if (result === 'queued') Alert.alert('Saved offline', 'Your signed decision will be sent as soon as you are back online.');
      router.back();
    } catch (err) {
      Alert.alert('Could not send decision', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (approval.isLoading) {
    return (
      <Screen underHeader>
        <T tone="muted">Loading…</T>
      </Screen>
    );
  }
  if (!approval.data) {
    return (
      <Screen underHeader>
        <T tone="danger">{errorMessage(approval.error)}</T>
      </Screen>
    );
  }

  const a = approval.data;
  const pending = a.status === 'pending';
  const gate = a.kind === 'case_gate';
  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const kase = caseDetail.data?.case ?? null;
  const heading = approvalHeading(a, { case: kase, stageName: a.stage ? stageNames(lifecycle)[a.stage] : undefined });
  const asked = new Date(a.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const priorityName = kase?.priority ? lifecycle?.priorities.find((p) => p.id === kase.priority)?.name : undefined;

  return (
    <Screen underHeader keyboardShouldPersistTaps="handled">
      {heading.kicker ? (
        <T tone="muted" size="sm" numberOfLines={2}>
          {heading.kicker}
        </T>
      ) : null}
      <H lead={heading.lead || undefined} title={heading.question} size="xl" />
      {heading.from && (
        <T tone="lead" size="sm">
          {heading.from} · {asked}
        </T>
      )}
      {!pending && <Badge tone={a.status === 'rejected' ? 'danger' : 'success'} label={a.status === 'rejected' ? 'Rejected' : a.status === 'approved' ? 'Approved' : 'Closed'} />}

      <Card>
        <T tone="muted" size="sm">
          Risk
        </T>
        {gate && kase ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
            <T size="lg" weight="semibold">
              {kase.risk ? cap(kase.risk) : 'Not set'}
            </T>
            {kase.priority && (
              <Badge tone={kase.priority === 'P1' ? 'danger' : kase.priority === 'P2' ? 'warning' : 'muted'} label={priorityName ? `${kase.priority} ${priorityName}` : kase.priority} />
            )}
          </View>
        ) : (
          <RiskBar score={a.riskScore} />
        )}
        {a.reasons.map((r) => (
          <T key={r} size="sm" tone="body">
            • {r}
          </T>
        ))}
      </Card>

      {a.evidence.length > 0 && (
        <Card>
          <T tone="muted" size="sm">
            Evidence
          </T>
          {a.evidence.map((e, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
              <Ionicons name="checkmark-circle" size={18} color={c.success} />
              <View style={{ flex: 1 }}>
                <T tone="muted" size="xs">
                  {e.label}
                </T>
                <T size="sm">{e.value}</T>
              </View>
            </View>
          ))}
        </Card>
      )}

      {!gate && (
        <Card>
          {a.rationale ? (
            <>
              <T tone="muted" size="sm">
                The agent says
              </T>
              <T tone="body">“{a.rationale}”</T>
            </>
          ) : null}
          <T tone="muted" size="sm">
            Details
          </T>
          {readableFields(a.args).map((f) => (
            <View key={f.label}>
              <T tone="muted" size="xs">
                {f.label}
              </T>
              <T size="sm">{f.value}</T>
            </View>
          ))}
        </Card>
      )}

      {pending && (
        <>
          <Button
            testID="approve"
            title={Platform.OS === 'ios' ? 'Approve with Face ID' : 'Approve with fingerprint'}
            icon={<Ionicons name="finger-print" size={20} color={c.onAction} />}
            onPress={() => decide('approved')}
            loading={busy === 'approved'}
            disabled={!!busy}
          />
          {rejecting ? (
            <>
              <Input
                multiline
                autoFocus
                value={notes}
                onChangeText={setNotes}
                maxLength={2000}
                placeholder="What should happen instead? This goes back with the rejection."
                accessibilityLabel="Note with the rejection"
                style={{ minHeight: 88, textAlignVertical: 'top' }}
              />
              <Button testID="send-rejection" title="Send rejection" variant="danger" onPress={() => decide('rejected')} loading={busy === 'rejected'} disabled={!!busy} />
            </>
          ) : (
            <Button testID="reject-with-note" title="Reject with a note" variant="secondary" onPress={() => setRejecting(true)} disabled={!!busy} />
          )}
          <T tone="muted" size="xs" style={{ textAlign: 'center' }}>
            Your decision is signed with this phone's key and recorded in the audit log.
          </T>
        </>
      )}
    </Screen>
  );
}
