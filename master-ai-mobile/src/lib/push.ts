import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Register this phone for approval pushes. Remote push needs a development or
 * production build with an EAS project id; Expo Go and simulators are skipped.
 * expo-notifications is required lazily because evaluating it in Expo Go on
 * Android throws.
 */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

  // A conditional require is only evaluated when reached (Metro evaluates import() eagerly).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('approvals', {
      name: 'Approvals',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.auth.registerPushToken({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    return token;
  } catch {
    return null; // Offline or not configured; retried on next launch.
  }
}
