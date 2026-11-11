import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AddPerson } from '@/lib/addperson';
import { ROLE_ORDER } from '@/lib/roles';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { color, Empty, Header, Loading, Muted, Press, Screen } from '@/lib/ui';
import type { School } from './index';

/** Super admin: pick a school, then add its owner, teachers, accountants, drivers … (the first owner of a new school is created here). */
export default function AdminPeople() {
  const { tr, rtl, vendorRole } = useApp();
  const [schools, setSchools] = useState<School[] | null>(null);
  const [pick, setPick] = useState<string>('');
  useEffect(() => { supabase.rpc('vendor_overview').then(({ data }) => setSchools((data ?? []) as School[])); }, []);
  const roles = [...ROLE_ORDER].reverse(); // school_owner first: the usual reason to come here

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Header title={tr('vendor.people.title')} subtitle={tr('vendor.people.intro')} />
        {schools === null ? <Loading /> : null}
        {schools?.length === 0 ? <Empty icon="school-outline" text={tr('vx.dash.none')} /> : null}
        {vendorRole !== 'vendor_super_admin' ? <Muted>{tr('vendor.people.onlySuper')}</Muted> : (
          <>
            <Text style={{ color: color.ink2, fontWeight: '700' }}>{tr('vendor.people.school')}</Text>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
              {(schools ?? []).map((s) => (
                <Press key={s.tenant_id} label={s.name} onPress={() => setPick(s.tenant_id)}
                  style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: pick === s.tenant_id ? color.accent : color.line, backgroundColor: pick === s.tenant_id ? 'rgba(245,165,36,0.16)' : color.bg2 }}>
                  <Text style={{ color: pick === s.tenant_id ? color.accent : color.ink, fontWeight: '800' }}>{s.name}</Text>
                </Press>
              ))}
            </View>
            {pick ? <AddPerson key={pick} tenant={pick} roles={roles} /> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
