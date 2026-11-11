import { createElement, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { campusHtml } from './campus-html';
import { Logo3D } from './logo3d';

/**
 * The landing page's moving school (Pop-Up Campus) on the sign-in screen. Native: a WebView; web build: an iframe. Both run the same
 * self-contained three.js page. Until it reports "ready" — or if it cannot load (offline, no WebGL) — the app's own 3D logo is shown, so
 * the sign-in screen is never empty. Nothing is read from or sent to the page except the ready/fail signal.
 */
export function Campus3D({ height = 250, name }: { height?: number; name?: string }) {
  const html = useMemo(() => campusHtml(name), [name]);
  const [state, setState] = useState<'loading' | 'ready' | 'fail'>('loading');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const on = (e: MessageEvent) => { if (e.data === 'ready') setState('ready'); else if (e.data === 'fail') setState('fail'); };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  // never leave the logo up forever if the page is slow to load (e.g. weak signal): the scene fades in whenever it reports ready
  const scene = state === 'fail' ? null : Platform.OS === 'web'
    ? createElement('iframe', { srcDoc: html, title: 'campus', style: { border: 0, width: '100%', height: '100%', background: 'transparent' }, allow: 'accelerometer' })
    : <WebView source={{ html: html }} originWhitelist={['*']} javaScriptEnabled domStorageEnabled={false} geolocationEnabled={false} setSupportMultipleWindows={false}
        onMessage={(e) => { const m = e.nativeEvent.data; if (m === 'ready') setState('ready'); else if (m === 'fail') setState('fail'); }}
        onError={() => setState('fail')} onHttpError={() => setState('fail')}
        style={{ backgroundColor: 'transparent' }} containerStyle={{ backgroundColor: 'transparent' }} androidLayerType="hardware" scrollEnabled={false} bounces={false} overScrollMode="never" />;
  return (
    <View style={{ height, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
      {state !== 'ready' ? <View style={{ position: 'absolute' }}><Logo3D size={112} /></View> : null}
      {scene ? <View style={{ height, width: '100%', opacity: state === 'ready' ? 1 : 0 }}>{scene}</View> : null}
    </View>
  );
}
