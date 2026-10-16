import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import type { ListItem, ListMeta, ListRange, ListShow } from '@onehuman/schemas';
import { initialView, listParams, RANGE_LABELS, SHOW_LABELS, type ListView } from '@onehuman/sdk';
import { Badge, Button, Card, Empty, Input, Pill, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { checkedLine, NEEDS_CONNECTION, noSignalLine, pageTotals, rowSummary, undatedLine } from '@/lib/lists';
import { space, useTheme } from '@/lib/theme';
import { useListsOverview, useOffline } from '@/lib/use-lists';

const SHOWS: (ListShow | 'all')[] = ['all', 'problems', 'not_checked', 'checked', 'new_notes'];
const RANGES: ListRange[] = ['today', 'this_week', 'this_month', 'last_month', 'all'];

function Row({ list, item, selecting, selected, onPress }: { list: ListMeta; item: ListItem; selecting: boolean; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const open = item.problems.filter((p) => !p.acknowledged).length;
  const summary = rowSummary(list, item);
  return (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      onPress={onPress}
      testID={`item-${item.title}`}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        {selecting && <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? c.accent : c.textMuted} />}
        <View style={{ flex: 1, gap: space.xs }}>
          <T weight="semibold" numberOfLines={2}>
            {item.title}
          </T>
          {summary ? (
            <T tone="lead" size="sm" numberOfLines={1}>
              {summary}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {open > 0 && <Badge tone="warning" label={`⚠ ${open} ${open === 1 ? 'problem' : 'problems'}`} />}
            {item.checked && <Badge tone="success" label="✓ Checked" />}
            {item.newNotes > 0 && <Badge tone="accent" label="New from a call" />}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/** One list: search, Show and range pills, the matching total, and rows to open or select and mark checked. */
export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const overview = useListsOverview();
  const meta = overview.data?.lists.find((l) => l.id === id);
  const [view, setView] = useState<ListView | null>(null);
  const v = view ?? initialView(!!meta?.dateField);
  const change = (patch: Partial<ListView>) => setView((cur) => ({ ...(cur ?? initialView(!!meta?.dateField)), ...patch, page: 1 }));
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const listRef = useRef<FlatList<ListItem>>(null);

  // The search is sent once typing pauses.
  useEffect(() => {
    if (q.trim() === v.q.trim()) return;
    const t = setTimeout(() => change({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const key = JSON.stringify(listParams(v));
  const pages = useInfiniteQuery({
    queryKey: ['list', id, key],
    queryFn: ({ pageParam }) => api.lists.page(id, listParams({ ...v, page: pageParam })),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: !!meta,
    placeholderData: keepPreviousData,
  });
  // A selection belongs to what was on screen: a new view starts with none.
  useEffect(() => {
    setSelected(new Set());
    setSelecting(false);
    setResult(null);
  }, [key]);

  const check = useMutation({
    mutationFn: () => api.lists.checkMany(id, [...selected]),
    onSuccess: (r) => {
      setResult(checkedLine(r));
      setSelected(new Set());
      setSelecting(false);
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      for (const k of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [k] });
    },
  });
  const offline = useOffline(pages.error, overview.error);

  if (!meta) {
    return (
      <Screen underHeader>
        {overview.isLoading ? (
          <T tone="muted">Loading…</T>
        ) : overview.error ? (
          <T tone="danger">{offline ? noSignalLine(true, overview.dataUpdatedAt) : errorMessage(overview.error)}</T>
        ) : (
          <Empty title="This list isn't here">It may belong to another kind of organization.</Empty>
        )}
      </Screen>
    );
  }

  const first = pages.data?.pages[0];
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const signal = noSignalLine(offline, pages.dataUpdatedAt);
  const undated = first ? undatedLine(first) : null;
  const toggle = (itemId: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      {first && <T tone="lead">{pageTotals(first)}</T>}
      {signal && <Badge tone="warning" label={signal} />}
      <Input testID="list-search" value={q} onChangeText={setQ} placeholder={`Search ${meta.label.toLowerCase()}`} accessibilityLabel={`Search ${meta.label.toLowerCase()}`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {SHOWS.map((s) => (
          <Pill key={s} testID={`show-${s}`} label={SHOW_LABELS[s]} active={v.show === s} onPress={() => change({ show: s })} />
        ))}
      </View>
      {meta.dateField && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {RANGES.map((r) => (
            <Pill key={r} testID={`range-${r}`} label={RANGE_LABELS[r]} active={v.range === r} onPress={() => change({ range: r })} />
          ))}
        </View>
      )}
      {undated && (
        <Pressable accessibilityRole="button" onPress={() => change({ range: 'all' })}>
          <T tone="accent" size="sm">
            {undated} Show all time
          </T>
        </Pressable>
      )}
      {result && (
        <T tone="success" size="sm">
          {result}
        </T>
      )}
      {pages.error && !offline && <T tone="danger">{errorMessage(pages.error)}</T>}
      {(items.length > 0 || selecting) && (
        <Button
          testID="select"
          variant="secondary"
          title={selecting ? 'Cancel' : 'Select'}
          disabled={!selecting && offline}
          onPress={() => {
            setSelecting((s) => !s);
            setSelected(new Set());
          }}
        />
      )}
      {offline && (
        <T tone="muted" size="sm">
          {NEEDS_CONNECTION}
        </T>
      )}
    </View>
  );

  return (
    <Screen underHeader scroll={false}>
      <Stack.Screen options={{ title: meta.label }} />
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Row
            list={first?.list ?? meta}
            item={item}
            selecting={selecting}
            selected={selected.has(item.id)}
            onPress={() => (selecting ? toggle(item.id) : router.push({ pathname: '/list/[id]/[itemId]', params: { id, itemId: item.id } }))}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        onEndReached={() => {
          if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={pages.isRefetching && !pages.isFetchingNextPage} onRefresh={() => pages.refetch()} />}
        ListEmptyComponent={
          pages.isLoading ? (
            <T tone="muted">Loading…</T>
          ) : pages.error ? null : (
            <Empty title={v.q ? `Nothing matches “${v.q}”` : 'Nothing here'}>Try another Show or range.</Empty>
          )
        }
        ListFooterComponent={pages.isFetchingNextPage ? <T tone="muted">Loading more…</T> : null}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: selecting ? 140 : space.xxl }}
      />
      {selecting && (
        <View style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, gap: space.xs }}>
          <Button
            testID="mark-checked"
            variant="success"
            title={`Mark ${selected.size} checked`}
            disabled={selected.size === 0 || offline}
            loading={check.isPending}
            onPress={() => check.mutate()}
          />
          {check.error && (
            <T tone="danger" size="sm">
              {errorMessage(check.error)}
            </T>
          )}
        </View>
      )}
    </Screen>
  );
}
