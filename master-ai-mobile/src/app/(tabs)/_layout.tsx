import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useMyApprovals } from '@/lib/approvals';
import { canSeeLists, newNotesTotal } from '@/lib/lists';
import { useSession } from '@/lib/session';
import { font, fontSize, tabBadge, useTheme } from '@/lib/theme';
import { useListsOverview } from '@/lib/use-lists';

/** Cases, Approvals, Lists (owner and admins), Calls, Pulse, Settings. The app opens on the first tab; Approvals and Lists carry badges. */
export default function TabsLayout() {
  const { c } = useTheme();
  const count = useMyApprovals().data?.list.length ?? 0;
  const role = useSession((s) => s.user?.role);
  const newNotes = newNotesTotal(useListsOverview().data);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.background, borderTopColor: c.line10 },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: fontSize.xs },
        tabBarBadgeStyle: { ...tabBadge(c), fontFamily: font.semibold },
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
      <Tabs.Screen
        name="lists"
        options={{
          title: 'Lists',
          href: canSeeLists(role) ? undefined : null,
          tabBarButtonTestID: 'tab-lists',
          tabBarBadge: newNotes > 0 ? newNotes : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
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
