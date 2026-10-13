import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Alert, Pressable, RefreshControl } from 'react-native';
import type { ApprovalRequest } from '@onehuman/schemas';
import { Badge, Button, Card, Empty, H, RiskBar, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useMyApprovals } from '@/lib/approvals';
import { confirmWithBiometrics, signDecision } from '@/lib/device-key';
import { queuedDecisions, submitDecision } from '@/lib/offline';

const LOW_RISK = 60;

function ApprovalRow({ approval: a }: { approval: ApprovalRequest }) {
  const gate = a.kind === 'case_gate';
  return (
    <Link href={{ pathname: '/approval/[id]', params: { id: a.id } }} asChild>
      <Pressable accessibilityRole="button" testID={`approval-${a.id}`}>
        <Card tone={gate ? 'warm' : 'glass'}>
          <T tone={gate ? 'warning' : 'muted'} size="xs" weight="semibold">
            {gate ? (a.stage === 'close' ? 'Sign-off' : 'Approval') : a.agentName}
          </T>
          <T weight="semibold" numberOfLines={3}>
            {a.summary}
          </T>
          {!gate && <RiskBar score={a.riskScore} />}
          <T tone="lead" size="sm" numberOfLines={2}>
            {a.reasons.join(' · ')}
          </T>
        </Card>
      </Pressable>
    </Link>
  );
}

/** Approvals first: the reason the app exists. Works offline from the saved copy. */
export default function ApprovalsScreen() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const approvals = useMyApprovals();
  const queued = useQuery({ queryKey: ['approvals', 'queued'], queryFn: queuedDecisions });
  useEffect(() => {
    void queued.refetch();
  }, [approvals.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const offline = approvals.data?.offline ?? false;
  const queuedIds = new Set(queued.data?.map((q) => q.approvalId));
  const visible = (approvals.data?.list ?? []).filter((a) => !queuedIds.has(a.id));
  // Case steps first; each is read and decided on its own. Only agent steps can be approved in a batch.
  const sorted = [...visible].sort((a, b) => Number(b.kind === 'case_gate') - Number(a.kind === 'case_gate'));
  const lowRisk = visible.filter((a) => a.kind === 'action' && a.riskScore < LOW_RISK);

  // One biometric check approves the whole low-risk batch; each decision is still signed separately.
  const approveBatch = async () => {
    if (!(await confirmWithBiometrics(`Approve ${lowRisk.length} low-risk agent steps`))) return;
    setBusy(true);
    try {
      for (const a of lowRisk) await submitDecision(await signDecision(a.id, 'approved'));
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      Alert.alert('Could not approve', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={approvals.isRefetching} onRefresh={() => approvals.refetch()} />}>
      <H lead="Decisions" title="waiting for you." />
      {offline && <Badge tone="warning" label="No signal. Showing your saved list; decisions will sync." />}
      {(queued.data?.length ?? 0) > 0 && <Badge tone="accent" label={`${queued.data!.length} signed decision(s) waiting for signal`} />}
      {approvals.error && <T tone="danger">{errorMessage(approvals.error)}</T>}
      {lowRisk.length > 1 && <Button title={`Approve ${lowRisk.length} low-risk`} variant="secondary" onPress={approveBatch} loading={busy} />}
      {sorted.length === 0 && !approvals.isLoading ? (
        <Empty title="Nothing needs you">Approvals and sign-offs for your role, and agent steps your rules stop, land here.</Empty>
      ) : (
        sorted.map((a) => <ApprovalRow key={a.id} approval={a} />)
      )}
    </Screen>
  );
}
