import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Speech from 'expo-speech';
import { RefreshControl, View } from 'react-native';
import { formatInr } from '@onehuman/ui';
import { Button, Card, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { space } from '@/lib/theme';

/** Daily pulse: a short brief, readable or spoken. */
export default function PulseScreen() {
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

  return (
    <Screen refreshControl={<RefreshControl refreshing={pulse.isRefetching} onRefresh={() => pulse.refetch()} />}>
      <T size="xxl" weight="700">Pulse</T>
      {pulse.error && <T tone="danger">{errorMessage(pulse.error)}</T>}
      {p && (
        <>
          <Card>
            <T size="lg" weight="600">{p.headline}</T>
            {p.lines.map((l) => (
              <T key={l} tone="muted">{l}</T>
            ))}
          </Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {[
              ['Waiting for you', p.pendingApprovals],
              ['Running', p.runningTasks],
              ['Done today', p.completedToday],
              ['Blocked today', p.blockedToday],
            ].map(([label, value]) => (
              <Card key={label as string} style={{ flexBasis: '46%', flexGrow: 1 }}>
                <T size="xxl" weight="700">{String(value)}</T>
                <T tone="muted" size="sm">{label}</T>
              </Card>
            ))}
          </View>
          <T tone="muted" size="sm">AI spend today: {formatInr(p.spendTodayInr)}</T>
          <Button title={speaking ? 'Stop' : 'Read it to me'} variant="secondary" onPress={speak} />
        </>
      )}
    </Screen>
  );
}
