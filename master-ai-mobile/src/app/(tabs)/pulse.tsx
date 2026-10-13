import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { RefreshControl, View } from 'react-native';
import { formatInr } from '@onehuman/ui';
import { TodaysCheckins } from '@/components/checkins';
import { Button, Card, H, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { space } from '@/lib/theme';

/** Daily pulse: a short brief, readable or spoken. */
export default function PulseScreen() {
  const firstName = useSession((s) => s.user?.name.split(' ')[0]);
  const pulse = useQuery({ queryKey: ['pulse'], queryFn: api.ops.pulse });
  const [speaking, setSpeaking] = useState(false);
  const p = pulse.data;

  const speak = () => {
    if (!p) return;
    if (speaking) {
      void Speech.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    Speech.speak([p.headline, ...p.lines].join('. '), {
      language: 'en-IN',
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
    });
  };

  const tiles: { label: string; value: number; tone: 'default' | 'warning' | 'success' | 'danger' }[] = p
    ? [
        { label: 'Waiting for you', value: p.pendingApprovals, tone: p.pendingApprovals ? 'warning' : 'default' },
        { label: 'Running', value: p.runningTasks, tone: 'default' },
        { label: 'Done today', value: p.completedToday, tone: 'success' },
        { label: 'Stuck today', value: p.blockedToday, tone: p.blockedToday ? 'danger' : 'default' },
      ]
    : [];

  return (
    <Screen refreshControl={<RefreshControl refreshing={pulse.isRefetching} onRefresh={() => pulse.refetch()} />}>
      <H lead={firstName ? `Good to see you, ${firstName}.` : 'Good to see you.'} title={p?.headline ?? 'Here is where things stand.'} />
      {pulse.error && <T tone="danger">{errorMessage(pulse.error)}</T>}
      {p && (
        <>
          {p.lines.length > 0 && <T tone="body">{p.lines.join(' ')}</T>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {tiles.map((t) => (
              <Card key={t.label} style={{ flexBasis: '46%', flexGrow: 1 }}>
                <T size="xxl" tone={t.tone}>
                  {String(t.value)}
                </T>
                <T tone="lead" size="sm">
                  {t.label}
                </T>
              </Card>
            ))}
          </View>
          <TodaysCheckins />
          <T tone="muted" size="sm">
            AI spend today: {formatInr(p.spendTodayInr)}
          </T>
          <Button title={speaking ? 'Stop' : 'Read it to me'} variant="secondary" onPress={speak} />
          <Button title="Agent jobs" variant="ghost" onPress={() => router.push('/goals')} />
        </>
      )}
    </Screen>
  );
}
