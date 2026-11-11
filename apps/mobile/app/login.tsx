import { useState } from 'react';
import { Image, SafeAreaView, ScrollView, TextInput, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, ErrorText, Muted, s, T } from '@/lib/ui';

/** Email sign-in with a one-time code (or email + password). Accounts are created by the school; this app never registers anyone. */
export default function Login() {
  const { tr, locale, setLocale } = useApp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');

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
    if (!sentTo || !/^\d{6}$/.test(code.trim())) return setErr(tr('auth.err.badCode'));
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setErr(tr('auth.err.wrongCode'));
  }

  async function signInEmail() {
    if (!email.includes('@') || !password) return setErr(tr('auth.err.fields'));
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(tr('auth.err.wrong')); // one message for every failure: no account enumeration
  }

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 8 }}>
          <Image source={require('../assets/splash-icon.png')} style={{ width: 120, height: 120 }} accessibilityIgnoresInvertColors />
          <T style={{ fontSize: 22, fontWeight: '700', textAlign: 'center' }}>{tr('mobile.login.welcome')}</T>
          <Muted style={{ textAlign: 'center' }}>{tr('mobile.login.tagline')}</Muted>
        </View>
        <T style={{ fontSize: 24, fontWeight: '700' }}>{tr('auth.signIn')}</T>
        {sentTo ? (
          <>
            <Muted>{tr('auth.emailCodeSent')}</Muted>
            <TextInput style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" accessibilityLabel={tr('auth.code')} placeholder={tr('auth.code')} placeholderTextColor="#667" />
            <Button label={tr('auth.verify')} onPress={verify} disabled={busy} />
            <Button label={tr('common.cancel')} onPress={() => { setSentTo(null); setCode(''); setErr(null); }} secondary />
          </>
        ) : (
          <>
            <TextInput style={[s.input, { writingDirection: 'ltr', textAlign: 'left' }]} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" accessibilityLabel={tr('auth.email')} placeholder={tr('auth.email')} placeholderTextColor="#667" />
            <Button label={tr('auth.sendOtp')} onPress={send} disabled={busy} />
          </>
        )}
        {err ? <ErrorText>{err}</ErrorText> : null}
        <View style={{ marginTop: 16, gap: 12 }}>
          {showPassword ? (
            <>
              <T style={{ fontWeight: '700' }}>{tr('auth.withEmail')}</T>
              <TextInput style={[s.input, { writingDirection: 'ltr', textAlign: 'left' }]} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" accessibilityLabel={tr('auth.password')} placeholder={tr('auth.password')} placeholderTextColor="#667" />
              <Button label={tr('auth.signIn')} onPress={signInEmail} disabled={busy} />
            </>
          ) : (
            <Button label={tr('auth.withEmail')} onPress={() => setShowPassword(true)} secondary />
          )}
        </View>
        <View style={{ marginTop: 24 }}>
          <Button label={tr('nav.language')} onPress={() => void setLocale(locale === 'ur' ? 'en' : 'ur')} secondary />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
