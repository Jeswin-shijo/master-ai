import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, Share, View } from 'react-native';
import { STAGE_KEYS, type CaseSource } from '@onehuman/schemas';
import { caseFileLines, dotsFromStages, dueWords, FINAL_STATUSES, priorityTone, stageNames, statusWords } from '@onehuman/sdk';
import { ReportView } from '@/components/report-view';
import { StageList } from '@/components/stage-list';
import { Badge, Button, Card, H, Input, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useMyApprovals } from '@/lib/approvals';
import { space } from '@/lib/theme';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FROM: Record<CaseSource, string> = {
  owner: 'Raised by the owner',
  staff: 'Raised by the team',
  customer: 'From a customer',
  system: 'From a system',
  partner: 'From a partner',
};
const PRIORITY_BADGE = { danger: 'danger', waiting: 'warning', neutral: 'muted' } as const;

function AddDetails({ caseId, missing }: { caseId: string; missing: { label: string }[] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => api.cases.addInfo(caseId, { text: text.trim() }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
    },
  });
  return (
    <Card tone="warm">
      <T tone="warning" weight="semibold">
        Needs details
      </T>
      <T>{missing.length > 0 ? `Missing: ${missing.map((m) => m.label).join(', ')}.` : 'Review asked for more details.'}</T>
      <Input
        multiline
        value={text}
        onChangeText={setText}
        maxLength={2000}
        placeholder="Add what's missing. Review runs again."
        accessibilityLabel="The missing details"
        style={{ minHeight: 88, textAlignVertical: 'top' }}
      />
      {add.error && (
        <T tone="danger" size="sm">
          {errorMessage(add.error)}
        </T>
      )}
      <Button title="Send details" onPress={() => add.mutate()} loading={add.isPending} disabled={!text.trim()} />
    </Card>
  );
}

/** One case: what it waits on, then the 8 stages with what each one found. */
export default function CaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.cases.get(id),
    // Live updates come over the realtime stream; a slow poll covers a dropped connection.
    refetchInterval: (q) => (q.state.data && !FINAL_STATUSES.includes(q.state.data.case.status) ? 5000 : false),
  });
  const mine = useMyApprovals();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });

  if (detail.isLoading) {
    return (
      <Screen underHeader>
        <T tone="muted">Loading…</T>
      </Screen>
    );
  }
  if (!detail.data) {
    return (
      <Screen underHeader>
        <T tone="danger">{errorMessage(detail.error)}</T>
      </Screen>
    );
  }

  const { case: c, label, file, approvals, report } = detail.data;
  const lifecycle = (workspaces.data?.find((w) => w.id === c.workspaceId) ?? workspaces.data?.[0])?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const roleName = (rid: string) => (rid === 'owner' ? 'the owner' : (lifecycle?.roles.find((r) => r.id === rid)?.name ?? 'the right person'));
  const rows = STAGE_KEYS.map((k) => report.stages.find((s) => s.stage === k) ?? { stage: k, name: names[k], status: 'pending' as const, minutes: null, summary: null });
  const states = dotsFromStages(rows, { approveDecision: file.approve?.decision });
  const lines = caseFileLines(file, { roleName, priorityName: (p) => lifecycle?.priorities.find((x) => x.id === p)?.name });
  const gate = approvals.find((a) => a.kind === 'case_gate' && a.status === 'pending');
  const canDecide = !!gate && (mine.data?.list ?? []).some((a) => a.id === gate.id);
  const ended = FINAL_STATUSES.includes(c.status);
  const due = ended ? null : dueWords(c.resolveBy, new Date());

  return (
    <Screen underHeader refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} />}>
      <Stack.Screen options={{ title: c.code }} />
      <T tone="muted" size="sm">
        {c.code} · {c.requester.name} · {statusWords(c.status)}
      </T>
      <H title={c.title} size="xl" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {c.categoryName && <Badge tone="accent" label={c.categoryName} />}
        {c.priority && <Badge tone={PRIORITY_BADGE[priorityTone(c.priority)]} label={c.priority} />}
        {c.risk && <Badge label={`${cap(c.risk)} risk`} />}
        {c.department && <Badge label={c.department} />}
        {due && <Badge tone={due.late ? 'danger' : 'muted'} label={due.text} />}
        <Badge label={FROM[c.source]} />
      </View>
      {c.outcome && <T tone="body">{c.outcome}</T>}

      {c.status === 'needs_info' && <AddDetails caseId={c.id} missing={file.review?.missing ?? []} />}
      {gate && (
        <Card tone="warm" testID="gate">
          <T tone="warning" weight="semibold">
            {gate.stage === 'close' ? 'Waiting for sign-off' : 'Waiting for approval'}
          </T>
          <T>{gate.summary}</T>
          {canDecide ? (
            <Button
              testID="open-gate"
              title={gate.stage === 'close' ? 'Read and sign off' : 'Read and decide'}
              onPress={() => router.push({ pathname: '/approval/[id]', params: { id: gate.id } })}
            />
          ) : (
            <T tone="lead">{cap(roleName(gate.approver))} decides this.</T>
          )}
        </Card>
      )}

      <H lead={`The ${label.label.toLowerCase()},`} title="stage by stage." size="xl" />
      <StageList rows={rows} states={states} lines={lines} requestText={file.request?.text} />

      {report.work && (
        <Card>
          <T weight="semibold">The work</T>
          <ReportView report={report.work} />
        </Card>
      )}
      {rows[7]!.status === 'done' && (
        <Card>
          <T weight="semibold">Report</T>
          {report.slaMet !== null && <Badge tone={report.slaMet ? 'success' : 'danger'} label={report.slaMet ? 'On time' : 'Late'} />}
          <Button
            title="Share report"
            variant="secondary"
            onPress={() => void Share.share({ message: [`${report.code}: ${report.title}`, report.text, report.outcome].filter(Boolean).join('\n\n') })}
          />
        </Card>
      )}
    </Screen>
  );
}
