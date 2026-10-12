import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Switch, View } from 'react-native';
import { Button, Card, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { ensureDeviceKey, getDeviceKey } from '@/lib/device-key';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { c } = useTheme();
  const queryClient = useQueryClient();
  const { user, signOut, setTenant } = useSession();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  const key = useQuery({ queryKey: ['device-key'], queryFn: getDeviceKey });

  const paused = tenant.data?.status === 'paused';
  const killSwitch = useMutation({
    mutationFn: () => (paused ? api.tenant.resume() : api.tenant.pause()),
    onSuccess: (t) => {
      setTenant(t);
      queryClient.setQueryData(['tenant'], t);
    },
    onError: (err) => Alert.alert('Kill switch failed', errorMessage(err)),
  });
  const setupKey = useMutation({
    mutationFn: ensureDeviceKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device-key'] }),
    onError: (err) => Alert.alert('Could not set up key', errorMessage(err)),
  });

  const confirmPause = () => {
    if (paused) return killSwitch.mutate();
    Alert.alert('Pause every agent?', 'Running tasks stop at their next step and no action can run until you resume.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pause all', style: 'destructive', onPress: () => killSwitch.mutate() },
    ]);
  };

  return (
    <Screen>
      <T size="xxl" weight="700">{user?.name}</T>
      <T tone="muted">{tenant.data?.name} · {tenant.data?.industry}</T>

      <Card style={paused ? { borderColor: c.warning } : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <T weight="600">Kill switch</T>
            <T tone="muted" size="sm">{paused ? 'All agents are paused.' : 'Agents are working.'}</T>
          </View>
          <Switch value={paused} onValueChange={confirmPause} disabled={killSwitch.isPending} trackColor={{ true: c.warning }} accessibilityLabel="Pause all agents" />
        </View>
      </Card>

      <Card>
        <T weight="600">Approval key</T>
        <T tone="muted" size="sm">
          {key.data ? 'This phone signs your approvals. Face ID / fingerprint is asked every time.' : 'Not set up yet on this phone.'}
        </T>
        {!key.data && <Button title="Set up this phone" onPress={() => setupKey.mutate()} loading={setupKey.isPending} />}
      </Card>

      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      <T tone="muted" size="xs">Server: {API_URL}</T>
    </Screen>
  );
}
