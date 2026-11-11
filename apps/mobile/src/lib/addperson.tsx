import { useState } from 'react';
import { Text, View } from 'react-native';
import { supabase } from './supabase';
import { useApp } from './session';
import { Button, Card, color, ErrorText, Field, H2, Notice, Press } from './ui';
import { WEB } from './web';

const ERR: Record<string, string> = { self: 'people.err.self', owner: 'people.err.owner', escalation: 'people.err.escalation', guardian_linked: 'people.err.linked', staff_linked: 'people.err.linked', role: 'people.err.role', mfa: 'people.err.mfa', fields: 'people.err.fields', login_failed: 'people.err.login' };

/**
 * Add a person by email and role. The phone cannot create a login itself (that needs the server's secret key), so it asks the website's
 * /api/people with the signed-in person's own token; the server first asks the DATABASE whether they may, then the database applies its rules.
 */
export function AddPerson({ roles, tenant, onAdded }: { roles: readonly string[]; tenant?: string; onAdded?: () => void }) {
  const { tr, rtl } = useApp();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(roles[0] ?? 'teacher');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setMsg(null); setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || name.trim().length < 2) return setErr(tr('people.err.fields'));
    if (tenant === '') return setErr(tr('ma.admin.school'));
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`${WEB}/api/people`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ email: email.trim().toLowerCase(), name: name.trim(), role, ...(tenant ? { tenant } : {}) }),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      if (j?.ok) { setMsg(tr('ma.admin.added')); setEmail(''); setName(''); onAdded?.(); }
      else setErr(ERR[j?.code ?? ''] ? tr(ERR[j!.code!]!) : tr('ma.admin.failed'));
    } catch { setErr(tr('ma.admin.failed')); }
    setBusy(false);
  }

  return (
    <Card>
      <H2>{tr('people.invite')}</H2>
      <Field label={tr('people.email')} icon="mail-outline" ltr value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="name@example.com" />
      <Field label={tr('people.name')} icon="person-outline" value={name} onChangeText={setName} />
      <View style={{ gap: 6 }}>
        <Text style={{ color: color.ink2, fontWeight: '700' }}>{tr('people.role')}</Text>
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
          {roles.map((r) => (
            <Press key={r} label={tr(`people.roles.${r}`)} onPress={() => setRole(r)}
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: role === r ? color.accent : color.line, backgroundColor: role === r ? 'rgba(245,165,36,0.16)' : color.bg2 }}>
              <Text style={{ color: role === r ? color.accent : color.ink2, fontWeight: '800' }}>{tr(`people.roles.${r}`)}</Text>
            </Press>
          ))}
        </View>
      </View>
      <Button icon="person-add-outline" label={tr('people.inviteBtn')} onPress={() => void submit()} disabled={busy} />
      {msg ? <Notice>{msg}</Notice> : null}
      {err ? <ErrorText>{err}</ErrorText> : null}
    </Card>
  );
}
