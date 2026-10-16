import { useEffect } from 'react';
import { RedHatDisplay_300Light, RedHatDisplay_400Regular } from '@expo-google-fonts/red-hat-display';
import { RedHatText_400Regular, RedHatText_500Medium, RedHatText_600SemiBold, useFonts } from '@expo-google-fonts/red-hat-text';
import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { queryClient } from '@/lib/api';
import { startQueueSync } from '@/lib/offline';
import { openPushTaps, registerForPush } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { refreshListsOnForeground } from '@/lib/use-lists';

void SplashScreen.preventAutoHideAsync();
// The live stage handles reduced motion itself (a still ring), so Reanimated's development notice
// about the setting only covers the tab bar.
LogBox.ignoreLogs(['[Reanimated] Reduced motion setting is enabled']);

function SignedInEffects() {
  useRealtime();
  // A cold-start tap is read on mount, before the Stack's screens are registered, so listen only once the navigator is ready.
  const navReady = !!useRootNavigationState()?.key;
  useEffect(() => {
    void registerForPush();
    const stopSync = startQueueSync();
    const stopRefresh = refreshListsOnForeground();
    return () => {
      stopSync();
      stopRefresh();
    };
  }, []);
  useEffect(() => {
    if (!navReady) return;
    return openPushTaps((href) => router.push(href));
  }, [navReady]);
  return null;
}

function RootStack() {
  const { ready, token, restore } = useSession();
  const { c } = useTheme();
  const [fontsLoaded, fontError] = useFonts({ RedHatDisplay_300Light, RedHatDisplay_400Regular, RedHatText_400Regular, RedHatText_500Medium, RedHatText_600SemiBold });
  // A font that fails to load falls back to the system font rather than blocking the app.
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    void restore();
  }, [restore]);
  useEffect(() => {
    if (ready && fontsReady) void SplashScreen.hideAsync();
  }, [ready, fontsReady]);

  if (!ready || !fontsReady) return null;
  const signedIn = !!token;
  const header = {
    headerShown: true,
    headerTintColor: c.accent,
    headerStyle: { backgroundColor: c.background },
    headerTitleStyle: { fontFamily: font.medium, color: c.text },
    headerShadowVisible: false,
  } as const;

  return (
    <>
      <StatusBar style="light" />
      {signedIn && <SignedInEffects />}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="case/[id]" options={{ ...header, title: '' }} />
          <Stack.Screen name="case/new" options={{ ...header, title: 'New request', presentation: 'modal' }} />
          <Stack.Screen name="approval/[id]" options={{ ...header, title: 'Decision', presentation: 'modal' }} />
          <Stack.Screen name="list/[id]/index" options={{ ...header, title: '' }} />
          <Stack.Screen name="list/[id]/[itemId]" options={{ ...header, title: '' }} />
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
