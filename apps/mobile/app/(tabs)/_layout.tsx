import { Tabs } from 'expo-router';
import { useApp } from '@/lib/session';
import { color, Icon, type IconName } from '@/lib/ui';

/**
 * Tabs follow what the database says the person may do (my_access): a parent sees Home / Fees / Results / Bus, a teacher also gets
 * Attendance, a driver gets Drive. Hiding a tab is only a convenience — every query and RPC is checked again by the database.
 */
export default function TabsLayout() {
  const { tr, can, access } = useApp();
  const guardian = !!access?.is_guardian;
  const teacher = can('attendance.mark');
  const saferoute = (access?.flags ?? []).includes('saferoute');
  const crew = !!access?.is_crew || can('transport.manage');
  const icon = (on: IconName, off: IconName) => ({ focused, color: c }: { focused: boolean; color: string }) => <Icon name={focused ? on : off} size={23} tint={c} />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      sceneStyle: { backgroundColor: 'transparent' }, // let the one shared night sky show through every tab
      lazy: true,
      tabBarStyle: { backgroundColor: '#101821', borderTopColor: color.line, height: 64, paddingBottom: 8, paddingTop: 6 },
      tabBarActiveTintColor: color.accent, tabBarInactiveTintColor: color.ink3,
      tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: tr('mobile.tab.home'), tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: tr('nav.attendance'), href: teacher ? undefined : null, tabBarIcon: icon('checkbox', 'checkbox-outline') }} />
      <Tabs.Screen name="fees" options={{ title: tr('nav.fees'), href: guardian ? undefined : null, tabBarIcon: icon('wallet', 'wallet-outline') }} />
      <Tabs.Screen name="results" options={{ title: tr('family.results'), href: guardian ? undefined : null, tabBarIcon: icon('school', 'school-outline') }} />
      <Tabs.Screen name="bus" options={{ title: tr('transport.family.bus'), href: guardian && saferoute ? undefined : null, tabBarIcon: icon('bus', 'bus-outline') }} />
      <Tabs.Screen name="drive" options={{ title: tr('transport.drive.title'), href: crew && saferoute ? undefined : null, tabBarIcon: icon('navigate', 'navigate-outline') }} />
      <Tabs.Screen name="more" options={{ title: tr('mobile.tab.more'), tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
    </Tabs>
  );
}
