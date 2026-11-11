import { Redirect, Slot, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { startSync } from '@/lib/queue';
import { AppProvider, useApp } from '@/lib/session';
import { StarSky } from '@/lib/sky';
import { AnimatedSplash } from '@/lib/splash';
import { color, Loading } from '@/lib/ui';

function Gate() {
  const { ready, session, access, vendorRole } = useApp();
  const segments = useSegments();
  useEffect(() => (session ? startSync() : undefined), [session]);

  if (!ready) return <Loading />;
  const first = segments[0] as string | undefined;
  if (!session && first !== 'login') return <Redirect href={'/login' as never} />;
  // platform staff (super admin) have no school: they get their own admin area instead of the school picker
  if (session && !access && vendorRole) return first === 'admin' ? <Slot /> : <Redirect href={'/admin' as never} />;
  if (session && first === 'admin' && !vendorRole) return <Redirect href={'/' as never} />;
  if (session && !access && first !== 'schools') return <Redirect href={'/schools' as never} />;
  if (session && access && first === 'login') return <Redirect href={'/' as never} />; // /schools stays reachable so a person can switch school
  return <Slot />;
}

function Splash() {
  const { tr } = useApp();
  return <AnimatedSplash name={tr('app.name')} />;
}

export default function Root() {
  return (
    <AppProvider>
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <StatusBar style="light" />
        <StarSky />
        <Gate />
        <Splash />
      </View>
    </AppProvider>
  );
}
