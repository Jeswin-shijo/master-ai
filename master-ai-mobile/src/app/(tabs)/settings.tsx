import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Switch, View } from 'react-native';
import { Badge, Button, Card, H, Screen, T } from '@/components/ui';
import { api, endSession, errorMessage, startSession } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { ensureDeviceKey, getDeviceKey } from '@/lib/device-key';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { c } = useTheme();
  const queryClient = useQueryClient();
  const { user, companies, setTenant, setUser } = useSession();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  // Role changes made by the owner apply here without signing in again.
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me });
  useEffect(() => {
    if (me.data) setUser(me.data.user, me.data.companies);
  }, [me.data, setUser]);
  const switchCompany = useMutation({
    mutationFn: (tenantId: string) => api.auth.switchCompany(tenantId),
    onSuccess: async (auth) => {
      await startSession(auth);
    },
    onError: (err) => Alert.alert('Could not switch company', errorMessage(err)),
  });
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
    Alert.alert('Pause every agent?', 'Running work stops at its next step and no action can run until you resume.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pause all', style: 'destructive', onPress: () => killSwitch.mutate() },
    ]);
  };

  const roles = workspaces.data?.[0]?.pack.lifecycle?.roles ?? [];
  const myRoles = (user?.approverRoles ?? []).map((r) => roles.find((x) => x.id === r)?.name).filter((n): n is string => !!n);

  return (
    <Screen>
      <H lead={user?.name ? `${user.name},` : undefined} title="your settings." />
      <T tone="lead">
        {tenant.data?.name} · {tenant.data?.industry}
      </T>

      <Card>
        <T tone="muted" size="sm">
          You approve
        </T>
        {user?.role === 'owner' ? (
          <T>Anything that needs approval, as the owner.</T>
        ) : myRoles.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {myRoles.map((r) => (
              <Badge key={r} tone="warning" label={r} />
            ))}
          </View>
        ) : (
          <T tone="lead">Nothing yet. The owner gives approval roles from Team on the web.</T>
        )}
      </Card>

      {companies.length > 1 && (
        <Card>
          <T tone="muted" size="sm">
            Your companies
          </T>
          {companies.map((co) => (
            <Button
              key={co.id}
              title={co.id === user?.tenantId ? `${co.name} (open)` : co.name}
              variant="secondary"
              disabled={co.id === user?.tenantId || switchCompany.isPending}
              onPress={() => switchCompany.mutate(co.id)}
            />
          ))}
        </Card>
      )}

      {user?.role !== 'member' && (
        <Card tone={paused ? 'warm' : 'glass'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T weight="semibold">Kill switch</T>
              <T tone="lead" size="sm">
                {paused ? 'Every agent is paused.' : 'Agents are working.'}
              </T>
            </View>
            <Switch
              value={paused}
              onValueChange={confirmPause}
              disabled={killSwitch.isPending}
              trackColor={{ true: c.warning, false: c.line20 }}
              accessibilityLabel="Pause all agents"
            />
          </View>
        </Card>
      )}

      <Card>
        <T weight="semibold">Approval key</T>
        <T tone="lead" size="sm">
          {key.data ? 'This phone signs your decisions. Face ID or fingerprint is asked every time.' : 'Not set up yet on this phone.'}
        </T>
        {!key.data && <Button title="Set up this phone" onPress={() => setupKey.mutate()} loading={setupKey.isPending} />}
      </Card>

      <Button testID="sign-out" title="Sign out" variant="secondary" onPress={() => void endSession()} />
      <T tone="muted" size="xs">
        Server: {API_URL}
      </T>
    </Screen>
  );
}
