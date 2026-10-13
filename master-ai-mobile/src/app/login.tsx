import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Button, Card, H, Input, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { ensureDeviceKey } from '@/lib/device-key';
import { useSession } from '@/lib/session';
import { space } from '@/lib/theme';

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.auth.login({ email: email.trim(), password }),
    onSuccess: async (auth) => {
      await signIn(auth);
      // Create and register this phone's approval key straight away.
      await ensureDeviceKey().catch(() => undefined);
    },
  });

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <T tone="muted" size="sm" weight="medium">
            ONEHUMAN OS
          </T>
          <H lead="Welcome back." title="Your agents kept working." size="hero" />
        </View>
        <Card>
          <Input
            testID="email"
            placeholder="Email"
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Input testID="password" placeholder="Password" accessibilityLabel="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
          {login.error && (
            <T tone="danger" size="sm">
              {errorMessage(login.error)}
            </T>
          )}
          <Button testID="sign-in" title="Sign in" onPress={() => login.mutate()} loading={login.isPending} disabled={!email || !password} />
        </Card>
        <T tone="muted" size="xs">
          Set up your organization on the web first. Server: {API_URL}
        </T>
      </KeyboardAvoidingView>
    </Screen>
  );
}
