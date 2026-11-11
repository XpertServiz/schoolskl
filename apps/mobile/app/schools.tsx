import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorText, Loading, Muted, s, T } from '@/lib/ui';

interface School { tenant_id: string; name: string }

/** One login, several schools: the chosen school becomes the session's tenant claim; data is never merged across schools. */
export default function Schools() {
  const { tr, refreshAccess, signOut } = useApp();
  const router = useRouter();
  const [schools, setSchools] = useState<School[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('my_tenants').then(({ data, error }) => { if (error) setErr(error.message); else setSchools((data ?? []) as School[]); });
  }, []);

  async function choose(id: string) {
    setErr(null);
    const { error } = await supabase.rpc('set_active_tenant', { p_tenant: id }); // refused by the database for non-members
    if (error) return setErr(error.message);
    await supabase.auth.refreshSession(); // re-mint the token so the access hook stamps the new school
    await refreshAccess();
    router.replace('/' as never);
  }

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        <T style={{ fontSize: 26, fontWeight: '700' }}>{tr('auth.chooseSchool')}</T>
        {schools === null && !err ? <Loading /> : null}
        {(schools ?? []).map((x) => <Card key={x.tenant_id}><Button label={x.name} onPress={() => void choose(x.tenant_id)} /></Card>)}
        {schools?.length === 0 ? <Muted>{tr('tenant.notFound')}</Muted> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        <Button label={tr('nav.signOut')} onPress={() => void signOut()} secondary />
      </ScrollView>
    </SafeAreaView>
  );
}
