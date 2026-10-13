import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Alert, Pressable, RefreshControl, View } from 'react-native';
import type { ApprovalRequest } from '@onehuman/schemas';
import { Badge, Button, Card, Empty, RiskBar, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useMyApprovals } from '@/lib/approvals';
import { confirmWithBiometrics, signDecision } from '@/lib/device-key';
import { queuedDecisions, submitDecision } from '@/lib/offline';
import { space } from '@/lib/theme';

const LOW_RISK = 60;

/** Approvals first: the reason the app exists. Works offline from the SQLite cache. */
export default function ApprovalsScreen() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const approvals = useMyApprovals();
  const offline = approvals.data?.offline ?? false;
  const queued = useQuery({ queryKey: ['approvals', 'queued'], queryFn: queuedDecisions });
  useEffect(() => {
    void queued.refetch();
  }, [approvals.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const queuedIds = new Set(queued.data?.map((q) => q.approvalId));
  const visible = (approvals.data?.list ?? []).filter((a) => !queuedIds.has(a.id));
  // Only agent actions can be approved in a batch; case steps are read and decided one by one.
  const lowRisk = visible.filter((a) => a.kind === 'action' && a.riskScore < LOW_RISK);

  // One biometric check approves the whole low-risk batch; each decision is still signed separately.
  const approveBatch = async () => {
    if (!(await confirmWithBiometrics(`Approve ${lowRisk.length} low-risk actions`))) return;
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
      <T size="xxl" weight="700">Approvals</T>
      {offline && <Badge tone="warning" label="Offline — showing saved list. Decisions will sync." />}
      {(queued.data?.length ?? 0) > 0 && <Badge tone="primary" label={`${queued.data!.length} signed decision(s) waiting for signal`} />}
      {approvals.error && <T tone="danger">{errorMessage(approvals.error)}</T>}

      {lowRisk.length > 1 && <Button title={`Approve ${lowRisk.length} low-risk`} variant="secondary" onPress={approveBatch} loading={busy} />}

      {visible.length === 0 && !approvals.isLoading ? (
        <Empty title="Nothing needs you">Your agents will ask here before doing anything risky, irreversible or above your limits.</Empty>
      ) : (
        visible.map((a) => <ApprovalRow key={a.id} approval={a} />)
      )}
    </Screen>
  );
}

function ApprovalRow({ approval }: { approval: ApprovalRequest }) {
  return (
    <Link href={{ pathname: '/approval/[id]', params: { id: approval.id } }} asChild>
      <Pressable accessibilityRole="button">
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <T tone="muted" size="xs">{approval.agentName}</T>
            <T tone="muted" size="xs">{approval.tool}</T>
          </View>
          <T weight="600">{approval.summary}</T>
          <RiskBar score={approval.riskScore} />
          <T tone="muted" size="sm" numberOfLines={2}>{approval.reasons.join(' · ')}</T>
        </Card>
      </Pressable>
    </Link>
  );
}
