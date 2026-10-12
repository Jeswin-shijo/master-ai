import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Badge, Button, Card, RiskBar, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { confirmWithBiometrics, signDecision } from '@/lib/device-key';
import { cachedApprovals, submitDecision } from '@/lib/offline';
import { radius, space, useTheme } from '@/lib/theme';

export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
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

  const decide = async (decision: 'approved' | 'rejected') => {
    const a = approval.data;
    if (!a) return;
    const ok = await confirmWithBiometrics(decision === 'approved' ? `Approve: ${a.summary}` : `Reject: ${a.summary}`);
    if (!ok) return;
    setBusy(decision);
    try {
      const result = await submitDecision(await signDecision(a.id, decision, notes || undefined));
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      if (result === 'queued') Alert.alert('Saved offline', 'Your signed decision will be sent as soon as you are back online.');
      router.back();
    } catch (err) {
      Alert.alert('Could not send decision', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (approval.isLoading) return <Screen underHeader><T tone="muted">Loading…</T></Screen>;
  if (!approval.data) return <Screen underHeader><T tone="danger">{errorMessage(approval.error)}</T></Screen>;
  const a = approval.data;
  const pending = a.status === 'pending';

  return (
    <Screen underHeader>
      <T tone="muted" size="sm">{a.agentName} · {a.tool}</T>
      <T size="xl" weight="700">{a.summary}</T>
      {!pending && <Badge tone={a.status === 'rejected' ? 'danger' : 'success'} label={a.status} />}

      <Card>
        <T weight="600">Why this needs you</T>
        <RiskBar score={a.riskScore} />
        {a.reasons.map((r) => (
          <T key={r} size="sm">• {r}</T>
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {a.factors.map((f) => (
            <Badge key={f.factor} label={`${f.factor} +${f.points}`} />
          ))}
        </View>
      </Card>

      {a.rationale ? (
        <Card>
          <T weight="600">The agent says</T>
          <T tone="muted">“{a.rationale}”</T>
        </Card>
      ) : null}

      <Card>
        <T weight="600">Evidence</T>
        {a.evidence.map((e, i) => (
          <View key={i}>
            <T tone="muted" size="xs">{e.label}</T>
            <T size="sm">{e.value}</T>
          </View>
        ))}
        <T tone="muted" size="xs">Exact action</T>
        <T size="xs" style={{ fontFamily: 'Menlo' }}>{JSON.stringify(a.args, null, 2)}</T>
      </Card>

      {pending && (
        <>
          <TextInput
            style={[styles.notes, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]}
            placeholder="Note for the agent (optional, sent back on reject)"
            placeholderTextColor={c.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <Button title={Platform.OS === 'ios' ? 'Approve with Face ID' : 'Approve with fingerprint'} variant="success" onPress={() => decide('approved')} loading={busy === 'approved'} disabled={!!busy} />
          <Button title="Reject" variant="danger" onPress={() => decide('rejected')} loading={busy === 'rejected'} disabled={!!busy} />
          <T tone="muted" size="xs" style={{ textAlign: 'center' }}>
            Your decision is signed with this phone's key and recorded in the audit log.
          </T>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notes: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.md, minHeight: 72, fontSize: 15, textAlignVertical: 'top' },
});
