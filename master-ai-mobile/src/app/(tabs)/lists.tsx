import { Link } from 'expo-router';
import { Pressable, RefreshControl } from 'react-native';
import type { ListSummary } from '@onehuman/schemas';
import { Badge, Card, Empty, H, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cardCount, cardMarks, noSignalLine } from '@/lib/lists';
import { useListsOverview, useOffline } from '@/lib/use-lists';

function ListCard({ list }: { list: ListSummary }) {
  const marks = cardMarks(list);
  const needsYou = list.card.problems > 0 || list.card.newNotes > 0;
  return (
    <Link href={{ pathname: '/list/[id]', params: { id: list.id } }} asChild>
      <Pressable accessibilityRole="button" testID={`list-${list.id}`}>
        <Card tone={list.card.newNotes > 0 ? 'warm' : 'glass'}>
          <T weight="semibold">{list.label}</T>
          <T tone="lead" size="sm">
            {cardCount(list)}
          </T>
          {marks && (
            <T size="sm" tone={needsYou ? 'warning' : 'muted'}>
              {marks}
            </T>
          )}
        </Card>
      </Pressable>
    </Link>
  );
}

/** The owner's and admins' lists, main ones first, with what needs checking and what calls brought in. */
export default function ListsScreen() {
  const overview = useListsOverview();
  const offline = useOffline(overview.error);
  const lists = overview.data?.lists ?? [];
  const signal = noSignalLine(offline, overview.dataUpdatedAt);

  return (
    <Screen refreshControl={<RefreshControl refreshing={overview.isRefetching} onRefresh={() => overview.refetch()} />}>
      <H lead="Lists," title="to check what came in." />
      {signal && <Badge tone="warning" label={signal} />}
      {overview.error && !offline && <T tone="danger">{errorMessage(overview.error)}</T>}
      {(overview.data?.samples ?? 0) > 0 && (
        <T tone="muted" size="sm">
          Sample items are still in your lists. Remove them on the web when you're ready.
        </T>
      )}
      {overview.isSuccess && lists.length === 0 && <Empty title="No lists yet">Your organization type's lists appear here once it is set up.</Empty>}
      {lists
        .filter((l) => l.main)
        .map((l) => (
          <ListCard key={l.id} list={l} />
        ))}
      {lists.some((l) => !l.main) && (
        <T tone="muted" size="sm">
          Other lists
        </T>
      )}
      {lists
        .filter((l) => !l.main)
        .map((l) => (
          <ListCard key={l.id} list={l} />
        ))}
    </Screen>
  );
}
