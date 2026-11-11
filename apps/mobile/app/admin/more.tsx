import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Button, Card, color, Header, Icon, Muted, Screen, T } from '@/lib/ui';

export default function AdminMore() {
  const { tr, locale, setLocale, signOut, rtl, vendorRole } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? '')); }, []);
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}>
        <Header title={tr('mobile.tab.more')} />
        <Card accent>
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={email || 'SA'} size={52} />
            <View style={{ flex: 1 }}><T style={{ fontWeight: '800', fontSize: 18 }}>{tr('ma.admin.role')}</T><Muted ltr>{email}</Muted><Muted>{vendorRole}</Muted></View>
            <Icon name="shield-checkmark" tint={color.ok} />
          </View>
        </Card>
        <Button icon="globe-outline" label={locale === 'ur' ? 'مکمل کنسول (تمام آپشنز)' : 'Full console (all options)'} onPress={() => router.push('/portal' as never)} />
        <Button secondary icon="language-outline" label={tr('nav.language')} onPress={() => void setLocale(locale === 'ur' ? 'en' : 'ur')} />
        <Button secondary danger icon="log-out-outline" label={tr('nav.signOut')} onPress={() => void signOut()} />
        <Muted>{tr('ma.admin.web')}</Muted>
      </ScrollView>
    </Screen>
  );
}
