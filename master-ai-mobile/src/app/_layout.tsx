import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { queryClient } from '@/lib/api';
import { startQueueSync } from '@/lib/offline';
import { registerForPush } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();

function SignedInEffects() {
  useRealtime();
  useEffect(() => {
    void registerForPush();
    return startQueueSync();
  }, []);
  return null;
}

function RootStack() {
  const { ready, token, restore } = useSession();
  const { c, dark } = useTheme();

  useEffect(() => {
    void restore().finally(() => SplashScreen.hideAsync());
  }, [restore]);

  if (!ready) return null;
  const signedIn = !!token;

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {signedIn && <SignedInEffects />}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="approval/[id]"
            options={{ headerShown: true, title: 'Approval', presentation: 'modal', headerTintColor: c.primary, headerStyle: { backgroundColor: c.surface } }}
          />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <RootStack />
    </QueryClientProvider>
  );
}
