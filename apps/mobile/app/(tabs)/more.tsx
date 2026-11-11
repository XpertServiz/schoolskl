import { useRouter } from 'expo-router';
import { SafeAreaView, ScrollView } from 'react-native';
import { useApp } from '@/lib/session';
import { Button, Card, Muted, s, T } from '@/lib/ui';

export default function More() {
  const { tr, access, locale, setLocale, signOut } = useApp();
  const router = useRouter();
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        <Card><T style={{ fontWeight: '700' }}>{access?.tenant.name}</T><Muted>{tr('mobile.more.signedIn')}</Muted></Card>
        <Button label={tr('nav.language')} onPress={() => void setLocale(locale === 'ur' ? 'en' : 'ur')} secondary />
        <Button label={tr('nav.switchSchool')} secondary onPress={() => router.push('/schools' as never)} />
        <Button label={tr('nav.signOut')} onPress={() => void signOut()} secondary />
        <Muted>{tr('mobile.more.privacy')}</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}
