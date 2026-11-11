import { useEffect, useMemo, useRef } from 'react';
import { Linking, Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button } from './ui';

/**
 * The BUS on a map inside the app: Leaflet + OpenStreetMap tiles in a WebView, no API key and no billing.
 * DECISION: OSM until a Google Maps key exists; the "Google Maps" button opens the same point in the phone's map app.
 * The marker moves in place when a new position arrives (no reload). Only ever given the bus position — never a child's.
 */
export function BusMap({ lat, lng, label, height = 260 }: { lat: number; lng: number; label: string; height?: number }) {
  const ref = useRef<WebView>(null);
  // the page is built once; later positions are pushed in with injectJavaScript
  const html = useMemo(() => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0;background:#0F1419}.bus{font-size:28px;line-height:28px;text-align:center}</style></head>
<body><div id="m"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
var map=L.map('m',{zoomControl:true,attributionControl:true}).setView([${lat},${lng}],16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var icon=L.divIcon({className:'bus',html:'🚌',iconSize:[32,32],iconAnchor:[16,16]});
var mk=L.marker([${lat},${lng}],{icon:icon,title:${JSON.stringify(label)}}).addTo(map);
window.setPos=function(a,b){mk.setLatLng([a,b]);map.panTo([a,b]);};
</script></body></html>`, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ref.current?.injectJavaScript(`window.setPos && window.setPos(${lat},${lng}); true;`); }, [lat, lng]);

  const google = () => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  if (Platform.OS === 'web') return <Button secondary label="Google Maps ↗" onPress={google} />;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ height, borderRadius: 12, overflow: 'hidden' }}>
        <WebView ref={ref} originWhitelist={['*']} source={{ html }} javaScriptEnabled domStorageEnabled={false} geolocationEnabled={false}
          setSupportMultipleWindows={false} style={{ backgroundColor: '#0F1419' }} />
      </View>
      <Button secondary label="Google Maps ↗" onPress={google} />
    </View>
  );
}
