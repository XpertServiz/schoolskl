import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Logo3D } from '@/lib/logo3d';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, color, ErrorText, Field, H1, Icon, Muted, Notice, Press, Screen, T } from '@/lib/ui';

type Mode = 'code' | 'password';

/**
 * Sign in. Accounts are created by the school (Logins page), so there is no public sign-up: a new parent or teacher "activates" by
 * signing in with an email code the first time — that is the "first time here?" path. Email + password is for staff and testing.
 */
export default function Login() {
  const { tr, locale, setLocale, rtl } = useApp();
  const [mode, setMode] = useState<Mode>('code');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) return setErr(tr('auth.err.badEmail'));
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return setErr(tr('auth.err.sendFailed')); // same message for unknown emails: no account enumeration
    setSentTo(address);
  }
  async function verify() {
    if (!sentTo || !/^\d{6,8}$/.test(code.trim())) return setErr(tr('auth.err.badCode'));
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setErr(tr('auth.err.wrongCode'));
  }
  async function signInPassword() {
    if (!email.includes('@') || !password) return setErr(tr('auth.err.fields'));
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(tr('auth.err.wrong')); // one message for every failure: no account enumeration
  }

  const tab = (m: Mode, label: string, icon: 'mail-outline' | 'key-outline') => (
    <Press onPress={() => { setMode(m); setErr(null); setSentTo(null); }} label={label} outer={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: mode === m ? color.surface2 : 'transparent', borderWidth: mode === m ? 1 : 0, borderColor: color.line }}>
        <Icon name={icon} size={17} tint={mode === m ? color.accent : color.ink3} />
        <Text style={{ color: mode === m ? color.ink : color.ink3, fontWeight: '800' }}>{label}</Text>
      </View>
    </Press>
  );

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 22, gap: 18, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: rtl ? 'row' : 'row-reverse' }}>
            <Press onPress={() => void setLocale(locale === 'ur' ? 'en' : 'ur')} label={tr('nav.language')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface }}>
              <Icon name="language-outline" size={16} tint={color.accent} />
              <Text style={{ color: color.ink, fontWeight: '700' }}>{tr('nav.language')}</Text>
            </Press>
          </View>

          <View style={{ alignItems: 'center', gap: 6 }}>
            <Logo3D size={112} />
            <H1 style={{ textAlign: 'center' }}>{tr('mobile.login.welcome')}</H1>
            <Muted style={{ textAlign: 'center', maxWidth: 320 }}>{tr('mobile.login.tagline')}</Muted>
          </View>

          <Card style={{ padding: 18, gap: 14 }}>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', gap: 6, padding: 4, borderRadius: 14, backgroundColor: color.bg2 }}>
              {tab('code', tr('mobile.login.tabCode'), 'mail-outline')}
              {tab('password', tr('mobile.login.tabPassword'), 'key-outline')}
            </View>

            {mode === 'code' ? (
              sentTo ? (
                <>
                  <Notice icon="mail-open-outline" tint={color.info}>{tr('auth.emailCodeSent')}</Notice>
                  <Muted ltr style={{ textAlign: 'center' }}>{sentTo}</Muted>
                  <Field label={tr('auth.emailCode')} icon="keypad-outline" ltr value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8}
                    autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="••••••••" style={{ letterSpacing: 6, fontSize: 22, fontWeight: '800' }} />
                  <Button icon="checkmark-circle-outline" label={tr('auth.verify')} onPress={() => void verify()} disabled={busy} />
                  <Button secondary icon="arrow-undo-outline" label={tr('common.cancel')} onPress={() => { setSentTo(null); setCode(''); setErr(null); }} />
                </>
              ) : (
                <>
                  <Field label={tr('auth.email')} icon="mail-outline" ltr value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="name@example.com" />
                  <Button icon="paper-plane-outline" label={tr('auth.sendOtp')} onPress={() => void send()} disabled={busy} />
                </>
              )
            ) : (
              <>
                <Field label={tr('auth.email')} icon="mail-outline" ltr value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="name@example.com" />
                <Field label={tr('auth.password')} icon="lock-closed-outline" ltr value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" placeholder="••••••••" />
                <Button icon="log-in-outline" label={tr('auth.signIn')} onPress={() => void signInPassword()} disabled={busy} />
              </>
            )}
            {err ? <ErrorText>{err}</ErrorText> : null}
          </Card>

          <Card>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(95,211,160,0.15)', alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkles" size={22} tint={color.ok} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontWeight: '800' }}>{tr('mobile.login.firstTime')}</T>
                <Muted>{tr('mobile.login.firstTimeBody')}</Muted>
              </View>
            </View>
            {mode !== 'code' || sentTo ? <Button secondary icon="person-add-outline" label={tr('mobile.login.activate')} onPress={() => { setMode('code'); setSentTo(null); setErr(null); }} /> : null}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
