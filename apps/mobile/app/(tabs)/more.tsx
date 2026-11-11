import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Button, Card, color, Header, Icon, Muted, Screen, T } from '@/lib/ui';

export default function More() {
  const { tr, access, locale, setLocale, signOut, rtl } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? '')); }, []);
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}>
        <Header title={tr('mobile.tab.more')} />
        <Card accent>
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={access?.tenant.name ?? '?'} size={52} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '800', fontSize: 18 }}>{access?.tenant.name}</T>
              <Muted ltr>{email}</Muted>
            </View>
            <Icon name="shield-checkmark" tint={color.ok} />
          </View>
          <Muted>{tr('mobile.more.signedIn')}</Muted>
        </Card>
        <Button secondary icon="language-outline" label={tr('nav.language')} onPress={() => void setLocale(locale === 'ur' ? 'en' : 'ur')} />
        <Button secondary icon="swap-horizontal-outline" label={tr('nav.switchSchool')} onPress={() => router.push('/schools' as never)} />
        <Button secondary danger icon="log-out-outline" label={tr('nav.signOut')} onPress={() => void signOut()} />
        <Card>
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="lock-closed-outline" size={18} tint={color.ink3} />
            <Muted style={{ flex: 1 }}>{tr('mobile.more.privacy')}</Muted>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
