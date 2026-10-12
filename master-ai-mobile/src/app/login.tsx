import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Button, Card, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { ensureDeviceKey } from '@/lib/device-key';
import { useSession } from '@/lib/session';
import { radius, space, useTheme } from '@/lib/theme';

export default function LoginScreen() {
  const { c } = useTheme();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.auth.login({ email, password }),
    onSuccess: async (auth) => {
      await signIn(auth);
      // Create and register this phone's approval key straight away.
      await ensureDeviceKey().catch(() => undefined);
    },
  });
  const input = [styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }];

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <T size="xxl" weight="700">ONEHUMAN OS</T>
          <T tone="muted">Approve your agents' work from anywhere.</T>
        </View>
        <Card>
          <TextInput style={input} placeholder="Email" placeholderTextColor={c.textMuted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextInput style={input} placeholder="Password" placeholderTextColor={c.textMuted} secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
          {login.error && <T tone="danger" size="sm">{errorMessage(login.error)}</T>}
          <Button title="Sign in" onPress={() => login.mutate()} loading={login.isPending} disabled={!email || !password} />
        </Card>
        <T tone="muted" size="xs">Set up your company on the web first. Server: {API_URL}</T>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 48, fontSize: 16 },
});
