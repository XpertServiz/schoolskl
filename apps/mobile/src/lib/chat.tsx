import { useRef, useState } from 'react';
import { Animated, Dimensions, Image, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
// the helper engine is plain TypeScript shared with the website (no network, no API)
import { chipLabel, reply, STARTER_CHIPS, type Reply } from '../../../../packages/assistant/src/index';
import { useApp } from './session';
import { color, Icon, Muted, T } from './ui';

interface Msg { who: 'bot' | 'me'; text: string }
const SIZE = 58;

/** A floating helper bubble that can be dragged anywhere (it stays where you leave it) and opens a small chat. Answers are local — nothing is sent anywhere. */
export function ChatFab() {
  const { locale, session } = useApp();
  const ur = locale === 'ur';
  const L = (en: string, u: string) => (ur ? u : en);
  const { width, height } = Dimensions.get('window');
  const pos = useRef(new Animated.ValueXY({ x: width - SIZE - 14, y: height - SIZE - 150 })).current;
  const start = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chips, setChips] = useState<string[]>(STARTER_CHIPS);
  const [text, setText] = useState('');

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { pos.extractOffset(); moved.current = false; start.current = { x: 0, y: 0 }; },
    onPanResponderMove: (e, g) => { if (Math.abs(g.dx) + Math.abs(g.dy) > 6) moved.current = true; Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false })(e, g); },
    onPanResponderRelease: () => { pos.flattenOffset(); if (!moved.current) setOpen(true); },
  })).current;

  const ask = (q: string) => {
    const t = q.trim().slice(0, 300);
    if (!t) return;
    const r: Reply = reply(t, locale === 'ur' ? 'ur' : 'en');
    setMsgs((m) => [...m, { who: 'me', text: t }, { who: 'bot', text: r.text + (r.link ? `\n→ ${r.link.label}` : '') }]);
    setChips(r.chips);
    setText('');
  };
  const greeting = L('Salam! I am Aiman. Ask me about fees, attendance, results, the bus or how to use this app.', 'السلام علیکم! میں ایمن ہوں۔ فیس، حاضری، نتائج، بس یا ایپ کے استعمال کے بارے میں پوچھیں۔');

  if (!session) return null; // on the sign-in screen the helper would only cover the form
  return (
    <>
      <Animated.View {...pan.panHandlers} style={{ position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', borderWidth: 3, borderColor: color.accent, backgroundColor: color.bg, transform: pos.getTranslateTransform(), zIndex: 50, elevation: 8 }} accessibilityRole="button" accessibilityLabel={L('Chat helper', 'چیٹ ہیلپر')}>
        <Image source={require('../../assets/aiman.webp')} style={{ width: SIZE, height: SIZE }} />
      </Animated.View>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.45)' }}>
          <View style={{ height: '72%', backgroundColor: color.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: color.line, overflow: 'hidden' }}>
            <View style={{ flexDirection: ur ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: color.accent }}>
              <Image source={require('../../assets/aiman.webp')} style={{ width: 36, height: 36, borderRadius: 18 }} />
              <View style={{ flex: 1 }}><T style={{ fontWeight: '800', color: '#1A1F24' }}>{L('Aiman', 'ایمن')}</T><Muted style={{ color: '#1A1F24' }}>{L('Helper — answers instantly', 'ہیلپر — فوراً جواب')}</Muted></View>
              <Pressable onPress={() => setOpen(false)} accessibilityLabel={L('Close', 'بند')}><Icon name="close" tint="#1A1F24" /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
              <Bubble who="bot" text={greeting} />
              {msgs.map((m, i) => <Bubble key={i} who={m.who} text={m.text} />)}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingBottom: 6 }} style={{ flexGrow: 0 }}>
              {chips.filter((c) => c !== 'contact').map((c) => (
                <Pressable key={c} onPress={() => ask(chipLabel(c, locale === 'ur' ? 'ur' : 'en'))} style={{ borderWidth: 1, borderColor: color.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}><T style={{ fontSize: 13 }}>{chipLabel(c, locale === 'ur' ? 'ur' : 'en')}</T></Pressable>
              ))}
            </ScrollView>
            <View style={{ flexDirection: ur ? 'row-reverse' : 'row', gap: 8, padding: 10, borderTopWidth: 1, borderColor: color.line }}>
              <TextInput value={text} onChangeText={setText} onSubmitEditing={() => ask(text)} maxLength={300} placeholder={L('Type your question…', 'اپنا سوال لکھیں…')} placeholderTextColor={color.ink3}
                style={{ flex: 1, color: color.ink, borderWidth: 1, borderColor: color.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, textAlign: ur ? 'right' : 'left' }} />
              <Pressable onPress={() => ask(text)} style={{ backgroundColor: color.accent, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center' }}><T style={{ fontWeight: '800', color: '#1A1F24' }}>{L('Send', 'بھیجیں')}</T></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function Bubble({ who, text }: { who: 'bot' | 'me'; text: string }) {
  const me = who === 'me';
  return (
    <View style={{ alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: me ? color.accent : 'rgba(255,255,255,.08)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
      <T style={{ color: me ? '#1A1F24' : color.ink }}>{text}</T>
    </View>
  );
}
