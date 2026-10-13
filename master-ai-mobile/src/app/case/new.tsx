import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, H, Input, Pill, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { space } from '@/lib/theme';

/** "New request": what's needed in the person's own words; the case engine checks, sorts and routes it. */
export default function NewRequestScreen() {
  const queryClient = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const noun = (lifecycle?.case.label ?? 'Request').toLowerCase();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.cases.create({ text: text.trim(), ...(category && { category }) }),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      router.replace({ pathname: '/case/[id]', params: { id: c.id } });
    },
  });

  return (
    <Screen underHeader keyboardShouldPersistTaps="handled">
      <H lead="New" title={`${noun}.`} />
      <T tone="lead">What's needed, in your own words. The system checks, sorts and routes it.</T>
      <Input
        testID="request-text"
        multiline
        value={text}
        onChangeText={setText}
        maxLength={4000}
        placeholder="For example: Boiler feed pump B is vibrating since the morning shift"
        accessibilityLabel="What's needed"
        style={{ minHeight: 120, textAlignVertical: 'top' }}
      />
      <T tone="lead" size="sm">
        Type (optional)
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        <Pill label="Let the system decide" active={!category} onPress={() => setCategory(null)} />
        {(lifecycle?.categories ?? []).map((c) => (
          <Pill key={c.id} label={c.name} active={category === c.id} onPress={() => setCategory(c.id)} />
        ))}
      </View>
      {create.error && <T tone="danger">{errorMessage(create.error)}</T>}
      <Button testID="raise-request" title={`Raise ${noun}`} onPress={() => create.mutate()} loading={create.isPending} disabled={text.trim().length < 3} />
    </Screen>
  );
}
