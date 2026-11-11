import { Redirect, Slot, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { startSync } from '@/lib/queue';
import { AppProvider, useApp } from '@/lib/session';
import { color, Loading } from '@/lib/ui';

function Gate() {
  const { ready, session, access } = useApp();
  const segments = useSegments();
  useEffect(() => (session ? startSync() : undefined), [session]);

  if (!ready) return <Loading />;
  const first = segments[0] as string | undefined;
  if (!session && first !== 'login') return <Redirect href={'/login' as never} />;
  if (session && !access && first !== 'schools') return <Redirect href={'/schools' as never} />;
  if (session && access && first === 'login') return <Redirect href={'/' as never} />; // /schools stays reachable so a person can switch school
  return <Slot />;
}

export default function Root() {
  return (
    <AppProvider>
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <StatusBar style="light" />
        <Gate />
      </View>
    </AppProvider>
  );
}
