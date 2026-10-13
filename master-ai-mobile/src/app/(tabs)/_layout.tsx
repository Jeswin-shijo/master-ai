import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { c } = useTheme();
  const pending = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => api.approvals.list('pending', { mine: true }) });
  const count = pending.data?.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Approvals',
          tabBarBadge: count > 0 ? count : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done-circle-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="calls" options={{ title: 'Calls', tabBarIcon: ({ color, size }) => <Ionicons name="call-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="pulse" options={{ title: 'Pulse', tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="goals" options={{ title: 'Goals', tabBarIcon: ({ color, size }) => <Ionicons name="flag-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'You', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
