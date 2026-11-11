import { Tabs } from 'expo-router';
import { useApp } from '@/lib/session';
import { color, Icon, type IconName } from '@/lib/ui';

/**
 * Tabs follow what the database says the person may do (my_access). A phone tab bar holds ~5, so:
 *   parent  → Home · Fees · Results · School bus · More
 *   staff   → Home · up to three of (driver: Drive; teacher: Attendance; office/owner: Students, Fee dues, Approvals) · More
 * Everything else a person may do is a tile on Home. Hiding a tab is only a convenience — every query and RPC is checked again by the database.
 */
export default function TabsLayout() {
  const { tr, can, access } = useApp();
  const parent = !!access?.is_guardian;
  const saferoute = (access?.flags ?? []).includes('saferoute');
  const crew = (!!access?.is_crew || can('transport.manage')) && saferoute;
  const approver = can('fees.concession.approve') || can('payroll.post') || can('results.publish');
  const office = can('fees.view') || approver;
  const has = { drive: crew, attendance: can('attendance.mark'), students: can('students.view'), dues: can('fees.view') || can('fees.collect'), approvals: approver };
  // office people get the money/people tabs; teachers and drivers get their work tabs first
  const order = (office ? ['students', 'dues', 'approvals'] : ['drive', 'attendance', 'students']) as (keyof typeof has)[];
  const staffTabs = new Set(parent ? [] : order.filter((k) => has[k]).slice(0, 3));
  const vis = (k: keyof typeof has) => (staffTabs.has(k) ? undefined : null);
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
      <Tabs.Screen name="students" options={{ title: tr('nav.students'), href: vis('students'), tabBarIcon: icon('people', 'people-outline') }} />
      <Tabs.Screen name="dues" options={{ title: tr('ma.tab.dues'), href: vis('dues'), tabBarIcon: icon('cash', 'cash-outline') }} />
      <Tabs.Screen name="approvals" options={{ title: tr('nav.approvals'), href: vis('approvals'), tabBarIcon: icon('shield-checkmark', 'shield-checkmark-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: tr('nav.attendance'), href: vis('attendance'), tabBarIcon: icon('checkbox', 'checkbox-outline') }} />
      <Tabs.Screen name="drive" options={{ title: tr('transport.drive.title'), href: vis('drive'), tabBarIcon: icon('navigate', 'navigate-outline') }} />
      <Tabs.Screen name="fees" options={{ title: tr('nav.fees'), href: parent ? undefined : null, tabBarIcon: icon('wallet', 'wallet-outline') }} />
      <Tabs.Screen name="results" options={{ title: tr('family.results'), href: parent ? undefined : null, tabBarIcon: icon('school', 'school-outline') }} />
      <Tabs.Screen name="bus" options={{ title: tr('transport.family.bus'), href: parent && saferoute ? undefined : null, tabBarIcon: icon('bus', 'bus-outline') }} />
      <Tabs.Screen name="people" options={{ title: tr('ma.tab.people'), href: null }} />
      <Tabs.Screen name="more" options={{ title: tr('mobile.tab.more'), tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
    </Tabs>
  );
}
