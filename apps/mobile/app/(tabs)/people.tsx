import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { AddPerson } from '@/lib/addperson';
import { ADMIN_ROLES, ROLE_ORDER } from '@/lib/roles';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Button, Card, Chip, color, Empty, ErrorText, H2, Header, Loading, Muted, Screen, T } from '@/lib/ui';

interface Member { user_id: string; full_name: string | null; email: string; status: string; roles: string[]; staff_no: string | null }

/** The school owner adds teachers, drivers, accountants … and can pause or restore anyone's access. The database decides what is allowed. */
export default function People() {
  const { tr, rtl } = useApp();
  const [pa, setPa] = useState<{ can: boolean; admin_roles: boolean } | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const a = await supabase.rpc('people_access');
    const access = (a.data as { can: boolean; admin_roles: boolean } | null) ?? { can: false, admin_roles: false };
    setPa(access);
    if (!access.can) { setMembers([]); return; }
    const m = await supabase.rpc('school_members');
    if (m.error) setErr(m.error.message); else { setErr(null); setMembers((m.data ?? []) as Member[]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function setStatus(u: string, status: 'active' | 'suspended') {
    const { error } = await supabase.rpc('set_member_status', { p_user: u, p_status: status });
    if (error) setErr(error.message); else await load();
  }
  const roles = ROLE_ORDER.filter((r) => pa?.admin_roles || !ADMIN_ROLES.has(r));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <Header title={tr('people.title')} subtitle={tr('people.intro')} />
        {pa === null ? <Loading /> : null}
        {pa && !pa.can ? <Empty icon="lock-closed-outline" text={tr('ui.noAccess')} /> : null}
        {pa?.can ? <AddPerson roles={roles} onAdded={() => void load()} /> : null}
        {pa?.can && !pa.admin_roles ? <Muted>{tr('people.adminNeeds2fa')}</Muted> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {pa?.can ? <H2>{tr('people.members')} {members ? `(${members.length})` : ''}</H2> : null}
        {(members ?? []).map((m) => (
          <Card key={m.user_id}>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={m.full_name ?? m.email} size={42} />
              <View style={{ flex: 1 }}><T style={{ fontWeight: '800' }}>{m.full_name ?? '—'}</T><Muted ltr>{m.email}</Muted></View>
              <Chip label={tr(`people.status.${m.status}`)} tint={m.status === 'active' ? color.ok : color.ink2} />
            </View>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 6 }}>
              {m.roles.map((r) => <Chip key={r} label={tr(`people.roles.${r}`)} tint={color.info} />)}
            </View>
            {m.status === 'active' && !m.roles.includes('school_owner') ? <Button secondary icon="pause-circle-outline" label={tr('people.suspend')} onPress={() => void setStatus(m.user_id, 'suspended')} /> : null}
            {m.status === 'suspended' ? <Button secondary icon="play-circle-outline" label={tr('people.reactivate')} onPress={() => void setStatus(m.user_id, 'active')} /> : null}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
