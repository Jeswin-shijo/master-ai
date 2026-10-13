import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useMyApprovals } from '@/lib/approvals';
import { font, fontSize, useTheme } from '@/lib/theme';

/** Cases, Approvals, Calls, Pulse, Settings. The app opens on Approvals (the index route). */
export default function TabsLayout() {
  const { c } = useTheme();
  const count = useMyApprovals().data?.list.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.background, borderTopColor: c.line10 },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: fontSize.xs },
        tabBarBadgeStyle: { backgroundColor: c.glow, color: c.onAction, fontFamily: font.semibold },
      }}
    >
      <Tabs.Screen
        name="cases"
        options={{ title: 'Cases', tabBarButtonTestID: 'tab-cases', tabBarIcon: ({ color, size }) => <Ionicons name="folder-open-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Approvals',
          tabBarButtonTestID: 'tab-approvals',
          tabBarBadge: count > 0 ? count : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done-circle-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="calls" options={{ title: 'Calls', tabBarIcon: ({ color, size }) => <Ionicons name="call-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="pulse" options={{ title: 'Pulse', tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" size={size} color={color} /> }} />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarButtonTestID: 'tab-settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} /> }}
      />
      {/* Agent jobs: opened from Pulse, not a tab (Deviation 2). */}
      <Tabs.Screen name="goals" options={{ href: null }} />
    </Tabs>
  );
}
