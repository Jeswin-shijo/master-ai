import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import { STAGE_KEYS, type Case, type StageKey } from '@onehuman/schemas';
import { caseMatches, dotsFromCase, dueWords, FINAL_STATUSES, listScope, stageNames, statusWords, WAITING_ON_PEOPLE, type CaseFilters } from '@onehuman/sdk';
import { Button, Card, Empty, H, Input, Pill, Screen, StageDots, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { space } from '@/lib/theme';

const TABS: [NonNullable<CaseFilters['status']>, string][] = [
  ['open', 'Open'],
  ['waiting', 'Waiting'],
  ['closed', 'Finished'],
  ['', 'All'],
];

function CaseRow({ c, names, dotNames, now }: { c: Case; names: Record<StageKey, string>; dotNames: string[]; now: Date }) {
  const ended = FINAL_STATUSES.includes(c.status);
  const due = ended ? null : dueWords(c.resolveBy, now);
  return (
    <Link href={{ pathname: '/case/[id]', params: { id: c.id } }} asChild>
      <Pressable accessibilityRole="button" testID={`case-${c.code}`}>
        <Card>
          <T tone="muted" size="xs" numberOfLines={1}>
            {c.code} · {c.requester.name}
            {c.categoryName ? ` · ${c.categoryName}` : ''}
          </T>
          <T weight="semibold" numberOfLines={2}>
            {c.title}
          </T>
          <StageDots states={dotsFromCase(c)} names={dotNames} />
          <T size="sm" tone={WAITING_ON_PEOPLE.includes(c.status) ? 'warning' : 'lead'}>
            {statusWords(c.status)}
            {ended ? '' : ` · ${names[c.stage]}`}
            {due ? ` · ${due.text}` : ''}
          </T>
        </Card>
      </Pressable>
    </Link>
  );
}

/** Every case: search, filter, and New request. Open and waiting tabs load every open case. */
export default function CasesScreen() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<NonNullable<CaseFilters['status']>>('open');
  const scope = listScope(status);
  const cases = useQuery({ queryKey: ['cases', scope], queryFn: () => api.cases.list(scope) });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const dotNames = STAGE_KEYS.map((k) => names[k]);
  const plural = lifecycle?.case.plural ?? 'Cases';
  const shown = (cases.data ?? []).filter((c) => caseMatches(c, { q, status }));
  const now = new Date();

  return (
    <Screen keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={cases.isRefetching} onRefresh={() => cases.refetch()} />}>
      <H lead={`${plural},`} title="from request to report." />
      <Button testID="new-request" title="New request" onPress={() => router.push('/case/new')} />
      <Input testID="case-search" value={q} onChangeText={setQ} placeholder="Number, title or who asked" accessibilityLabel={`Search ${plural.toLowerCase()}`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {TABS.map(([value, label]) => (
          <Pill key={label} label={label} active={status === value} onPress={() => setStatus(value)} />
        ))}
      </View>
      {cases.error && <T tone="danger">{errorMessage(cases.error)}</T>}
      {!cases.isLoading && shown.length === 0 ? (
        <Empty title={q ? `Nothing matches “${q}”` : `No ${plural.toLowerCase()} here`}>Requests from your team, your customers' form and your systems land here.</Empty>
      ) : (
        shown.map((c) => <CaseRow key={c.id} c={c} names={names} dotNames={dotNames} now={now} />)
      )}
      {scope === 'all' && (cases.data?.length ?? 0) >= 200 && (
        <T tone="muted" size="sm">
          Showing the newest 200. Every open one is under Open.
        </T>
      )}
    </Screen>
  );
}
