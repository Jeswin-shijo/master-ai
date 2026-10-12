import Constants from 'expo-constants';

/**
 * API base URL. In development a phone can't reach "localhost" on your laptop,
 * so we reuse the host the Expo dev server is running on (same LAN IP).
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();
