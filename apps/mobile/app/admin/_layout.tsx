import { Tabs } from 'expo-router';
import { useApp } from '@/lib/session';
import { color, Icon, type IconName } from '@/lib/ui';

/** Super-admin area of the app (platform staff only; the root layout sends everyone else away). Same night-sky look as the rest. */
export default function AdminLayout() {
  const { tr } = useApp();
  const icon = (on: IconName, off: IconName) => ({ focused, color: c }: { focused: boolean; color: string }) => <Icon name={focused ? on : off} size={23} tint={c} />;
  return (
    <Tabs screenOptions={{
      headerShown: false, lazy: true, sceneStyle: { backgroundColor: 'transparent' },
      tabBarStyle: { backgroundColor: '#101821', borderTopColor: color.line, height: 64, paddingBottom: 8, paddingTop: 6 },
      tabBarActiveTintColor: color.accent, tabBarInactiveTintColor: color.ink3, tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: tr('vx.nav.dashboard'), tabBarIcon: icon('speedometer', 'speedometer-outline') }} />
      <Tabs.Screen name="visitors" options={{ title: tr('vx.nav.visitors'), tabBarIcon: icon('stats-chart', 'stats-chart-outline') }} />
      <Tabs.Screen name="leads" options={{ title: tr('vendor.leads'), tabBarIcon: icon('chatbubbles', 'chatbubbles-outline') }} />
      <Tabs.Screen name="people" options={{ title: tr('ma.tab.people'), tabBarIcon: icon('person-add', 'person-add-outline') }} />
      <Tabs.Screen name="more" options={{ title: tr('mobile.tab.more'), tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
    </Tabs>
  );
}
