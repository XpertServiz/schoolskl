import { Tabs } from 'expo-router';
import { useApp } from '@/lib/session';
import { color } from '@/lib/ui';

/**
 * Tabs follow what the database says the person may do (my_access): a parent sees Home / Fees / Results, a teacher also gets Attendance.
 * Hiding a tab is only a convenience — every query and RPC is checked again by the database.
 */
export default function TabsLayout() {
  const { tr, can, access } = useApp();
  const guardian = !!access?.is_guardian;
  const teacher = can('attendance.mark');
  const saferoute = (access?.flags ?? []).includes('saferoute');
  const crew = !!access?.is_crew || can('transport.manage');
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: color.surface }, headerTintColor: color.ink, tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.line }, tabBarActiveTintColor: color.accent, tabBarInactiveTintColor: color.ink2 }}>
      <Tabs.Screen name="index" options={{ title: tr('mobile.tab.home') }} />
      <Tabs.Screen name="attendance" options={{ title: tr('nav.attendance'), href: teacher ? undefined : null }} />
      <Tabs.Screen name="fees" options={{ title: tr('nav.fees'), href: guardian ? undefined : null }} />
      <Tabs.Screen name="results" options={{ title: tr('family.results'), href: guardian ? undefined : null }} />
      <Tabs.Screen name="bus" options={{ title: tr('transport.family.bus'), href: guardian && saferoute ? undefined : null }} />
      <Tabs.Screen name="drive" options={{ title: tr('transport.drive.title'), href: crew && saferoute ? undefined : null }} />
      <Tabs.Screen name="more" options={{ title: tr('mobile.tab.more') }} />
    </Tabs>
  );
}
