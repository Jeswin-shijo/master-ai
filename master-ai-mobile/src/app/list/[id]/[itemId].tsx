import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import { dayLabel, itemCell, NOTE_LABELS } from '@onehuman/sdk';
import { timeAgo } from '@onehuman/ui';
import { Badge, Button, Card, H, Input, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { checkButton, historyWords, NEEDS_CONNECTION, NOTE_ACTION_LABELS, noteActions, noteState, noSignalLine, type NoteAction } from '@/lib/lists';
import { space } from '@/lib/theme';
import { useOffline, usePullRefresh } from '@/lib/use-lists';

/** One item: how it came in, its problems, the check, what calls said about it, its fields and its history. */
export default function ItemScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['list-item', id, itemId], queryFn: () => api.lists.item(id, itemId) });
  const offline = useOffline(detail.error);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const refresh = () => {
    for (const k of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [k] });
  };
  const check = useMutation({
    mutationFn: () => api.lists.check(id, itemId, note.trim() ? { note: note.trim() } : {}),
    // Only a successful check clears a half-typed note.
    onSuccess: () => {
      setNoting(false);
      setNote('');
      refresh();
    },
  });
  const act = useMutation({
    mutationFn: async ({ noteId, action }: { noteId: string; action: NoteAction }): Promise<void> => {
      if (action === 'apply') await api.notes.apply(noteId);
      else if (action === 'call-again') await api.notes.callAgain(noteId);
      else await api.notes.dismiss(noteId);
    },
    onSuccess: refresh,
  });

  const busy = act.isPending || check.isPending;
  const pull = usePullRefresh(detail.refetch);
  if (detail.isLoading) {
    return (
      <Screen underHeader>
        <T tone="muted">Loading…</T>
      </Screen>
    );
  }
  if (!detail.data) {
    return (
      <Screen underHeader refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
        <T tone="danger" accessibilityLiveRegion="polite">{offline ? noSignalLine(true, 0) : errorMessage(detail.error)}</T>
      </Screen>
    );
  }

  const { list, item, notes, history } = detail.data;
  const open = item.problems.filter((p) => !p.acknowledged);
  const seen = item.problems.filter((p) => p.acknowledged);
  const button = checkButton(item);
  const signal = noSignalLine(offline, detail.dataUpdatedAt);

  return (
    <Screen underHeader keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      <Stack.Screen options={{ title: list.entity.label }} />
      <H title={item.title} size="xl" />
      {signal && <Badge tone="warning" label={signal} accessibilityLiveRegion="polite" />}
      <T tone="body" size="sm">
        Came in: {item.source.label}
      </T>
      {item.updated.via === 'call' && item.updated.by && (
        <T tone="muted" size="sm">
          Updated on a call with {item.updated.by}
        </T>
      )}
      {item.checked ? (
        <T tone="success" size="sm">
          Checked by {item.checked.by}, {timeAgo(item.checked.at)}
          {item.checked.note ? ` — “${item.checked.note}”` : ''}
        </T>
      ) : (
        <T tone="muted" size="sm">
          Not checked
        </T>
      )}

      {(open.length > 0 || seen.length > 0) && (
        <Card tone={open.length ? 'warm' : 'glass'}>
          {open.map((p) => (
            <View key={p.key} style={{ gap: space.xs }}>
              <T tone="warning">⚠ {p.message}</T>
              {p.relatedId && (
                <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/list/[id]/[itemId]', params: { id, itemId: p.relatedId! } })}>
                  <T tone="accent" size="sm">
                    Open the other one
                  </T>
                </Pressable>
              )}
            </View>
          ))}
          {seen.map((p) => (
            <T key={p.key} tone="muted" size="sm">
              {p.message} (seen)
            </T>
          ))}
        </Card>
      )}

      {button &&
        (noting ? (
          <Card>
            <T tone="lead" size="sm">
              Why is it right as it is?
            </T>
            <Input
              testID="check-note"
              multiline
              value={note}
              onChangeText={setNote}
              maxLength={500}
              accessibilityLabel="Why it is right as it is"
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
            <Button testID="check-confirm" variant="success" title={button.label} disabled={!note.trim() || offline || (busy && !check.isPending)} loading={check.isPending} onPress={() => check.mutate()} />
            <Button
              variant="ghost"
              title="Cancel"
              onPress={() => {
                setNoting(false);
                setNote('');
                check.reset();
              }}
            />
          </Card>
        ) : (
          <Button testID="check" variant="success" title={button.label} disabled={offline || (busy && !check.isPending)} loading={check.isPending} onPress={() => (button.needsNote ? setNoting(true) : check.mutate())} />
        ))}
      {offline && (
        <T tone="muted" size="sm" accessibilityLiveRegion="polite">
          {NEEDS_CONNECTION}
        </T>
      )}
      {check.error && (
        <T tone="danger" size="sm" accessibilityLiveRegion="polite">
          {errorMessage(check.error)}
        </T>
      )}

      {notes.length > 0 && (
        <View style={{ gap: space.sm }}>
          <T weight="semibold" accessibilityRole="header">
            From calls
          </T>
          {notes.map((n) => {
            const actions = noteActions(n);
            return (
              <Card key={n.id} tone={n.status === 'new' ? 'warm' : 'glass'}>
                <T tone="muted" size="xs">
                  {NOTE_LABELS[n.kind]} · {n.speaker} · {timeAgo(n.at)}
                </T>
                <T>“{n.said}”</T>
                {n.promiseOn && (
                  <T tone="body" size="sm">
                    Promised for {dayLabel(n.promiseOn)}
                  </T>
                )}
                {n.proposed.map((p) => (
                  <T key={p.field} tone="body" size="sm">
                    {p.label}: {p.value}
                  </T>
                ))}
                <T tone={n.status === 'new' ? 'warning' : 'muted'} size="sm">
                  {noteState(n)}
                </T>
                {actions.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {actions.map((a) => {
                      const loadingThis = act.isPending && act.variables?.noteId === n.id && act.variables.action === a;
                      return (
                        <Button
                          key={a}
                          testID={`note-${a}`}
                          title={NOTE_ACTION_LABELS[a]}
                          variant={a === 'apply' ? 'success' : 'secondary'}
                          disabled={offline || (busy && !loadingThis)}
                          loading={loadingThis}
                          onPress={() => act.mutate({ noteId: n.id, action: a })}
                        />
                      );
                    })}
                  </View>
                )}
              </Card>
            );
          })}
          {act.error && (
            <T tone="danger" size="sm" accessibilityLiveRegion="polite">
              {errorMessage(act.error)}
            </T>
          )}
        </View>
      )}

      <Card>
        {list.entity.fields.map((f) => (
          <View key={f.name} style={{ flexDirection: 'row', gap: space.md }}>
            <T tone="muted" size="sm" style={{ flex: 2 }}>
              {f.label}
            </T>
            <T size="sm" style={{ flex: 3 }}>
              {itemCell(f, item)}
            </T>
          </View>
        ))}
      </Card>

      {history.length > 0 && (
        <View style={{ gap: space.sm }}>
          <T weight="semibold" accessibilityRole="header">
            History
          </T>
          {history
            .slice(-10)
            .reverse()
            .map((e, i) => (
              <View key={`${e.at}-${i}`} style={{ gap: 2 }}>
                <T size="sm">
                  {historyWords(e)} <T tone="muted" size="sm">· {timeAgo(e.at)}</T>
                </T>
                {e.changes.map((ch) => (
                  <T key={ch.field} tone="muted" size="sm">
                    {ch.label}: {ch.from} → {ch.to}
                  </T>
                ))}
                {e.note && (
                  <T tone="muted" size="sm">
                    “{e.note}”
                  </T>
                )}
              </View>
            ))}
        </View>
      )}
    </Screen>
  );
}
