import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Button, color, Empty, ErrorText, H2, Header, Icon, Loading, Muted, Press, Screen } from '@/lib/ui';

interface School { tenant_id: string; name: string }

/** One login, several schools: the chosen school becomes the session's school; data is never merged across schools. */
export default function Schools() {
  const { tr, refreshAccess, signOut, rtl } = useApp();
  const router = useRouter();
  const [schools, setSchools] = useState<School[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('my_tenants').then(({ data, error }) => { if (error) setErr(error.message); else setSchools((data ?? []) as School[]); });
  }, []);

  async function choose(id: string) {
    setErr(null); setBusy(id);
    const { error } = await supabase.rpc('set_active_tenant', { p_tenant: id }); // refused by the database for non-members
    if (error) { setBusy(null); return setErr(error.message); }
    await supabase.auth.refreshSession(); // re-mint the token so the access hook stamps the new school
    await refreshAccess();
    setBusy(null);
    router.replace('/' as never);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}>
        <Header title={tr('auth.chooseSchool')} />
        {schools === null && !err ? <Loading /> : null}
        {(schools ?? []).map((x) => (
          <Press key={x.tenant_id} onPress={() => void choose(x.tenant_id)} disabled={!!busy} label={x.name}
            style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: color.line, backgroundColor: 'rgba(22,31,41,0.92)' }}>
            <Avatar name={x.name} size={52} />
            <View style={{ flex: 1 }}><H2>{x.name}</H2><Muted>{busy === x.tenant_id ? '…' : tr('mobile.schools.open')}</Muted></View>
            <Icon name={rtl ? 'chevron-back' : 'chevron-forward'} tint={color.ink3} />
          </Press>
        ))}
        {schools?.length === 0 ? <Empty icon="school-outline" text={tr('tenant.notFound')} /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        <Button secondary icon="log-out-outline" label={tr('nav.signOut')} onPress={() => void signOut()} />
      </ScrollView>
    </Screen>
  );
}
