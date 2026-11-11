import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/lib/session';
import { Button, Header, Loading, Muted, Screen } from '@/lib/ui';
import { WEB } from '@/lib/web';

/**
 * The FULL website portal inside the app, already signed in: every screen the website has (accounting, reports, access control, payroll …)
 * is available on the phone exactly as on the web, with the same permissions (the database decides, not the app). The session is handed
 * over with a POST (never in the address) to /api/mobile-session, which sets the web cookies and redirects to the portal.
 */
export default function PortalWebView() {
  const { locale, vendorRole, access } = useApp();
  const router = useRouter();
  const [tokens, setTokens] = useState<{ a: string; r: string } | null>(null);
  const ur = locale === 'ur';
  useEffect(() => { supabase.auth.getSession().then(({ data }) => { const s = data.session; if (s) setTokens({ a: s.access_token, r: s.refresh_token }); }); }, []);
  const next = vendorRole && !access ? '/vendor' : '/portal';
  if (Platform.OS === 'web') {
    return (
      <Screen><View style={{ padding: 18, gap: 12 }}>
        <Header title={ur ? 'مکمل پورٹل' : 'Full portal'} />
        <Muted>{ur ? 'ویب ورژن میں پورٹل نئے ٹیب میں کھلتا ہے۔' : 'In the web build the portal opens in a new tab.'}</Muted>
        <Button label={ur ? 'پورٹل کھولیں' : 'Open the portal'} onPress={() => void Linking.openURL(WEB + next)} />
        <Button secondary label={ur ? 'واپس' : 'Back'} onPress={() => router.back()} />
      </View></Screen>
    );
  }
  if (!tokens) return <Screen><Loading /></Screen>;
  const body = `access_token=${encodeURIComponent(tokens.a)}&refresh_token=${encodeURIComponent(tokens.r)}&next=${encodeURIComponent(next)}`;
  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: 36 }}>
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}><Button secondary label={ur ? '← ایپ پر واپس' : '← Back to the app'} onPress={() => router.back()} /></View>
        <WebView
          source={{ uri: `${WEB}/api/mobile-session`, method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }}
          style={{ flex: 1, backgroundColor: '#0F1419' }} javaScriptEnabled domStorageEnabled sharedCookiesEnabled thirdPartyCookiesEnabled
          originWhitelist={[WEB + '*']} setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => { if (req.url.startsWith(WEB)) return true; void Linking.openURL(req.url); return false; }}
        />
      </View>
    </Screen>
  );
}
