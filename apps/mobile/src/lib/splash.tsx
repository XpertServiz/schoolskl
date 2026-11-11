import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { color } from './ui';

/**
 * In-app splash, the same motion as the website's opening splash: the school-house mark spins in in 3D (perspective + rotateY), an orbit
 * ring sweeps round it, the name rises, a progress line fills, then everything fades (~2.4 s). It sits on top of the app while the
 * session loads, never blocks touches once it starts fading, and is skipped when the phone asks for reduced motion.
 * The native splash (app.json → splash) shows the same mark on the same colour first, so the hand-over is seamless.
 */
export function AnimatedSplash({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!alive) return;
      if (reduce) { setDone(true); return; }
      Animated.loop(Animated.timing(orbit, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true })).start();
      Animated.parallel([
        Animated.timing(spin, { toValue: 1, duration: 2000, easing: Easing.bezier(0.16, 0.84, 0.3, 1), useNativeDriver: true }),
        Animated.timing(text, { toValue: 1, duration: 500, delay: 1100, useNativeDriver: true }),
        Animated.timing(bar, { toValue: 1, duration: 2000, delay: 200, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
      ]).start(() => {
        Animated.timing(out, { toValue: 0, duration: 450, useNativeDriver: true }).start(() => alive && setDone(true));
      });
    });
    return () => { alive = false; };
  }, [spin, text, bar, orbit, out]);

  if (done) return null;
  const rotateY = spin.interpolate({ inputRange: [0, 0.7, 1], outputRange: ['-220deg', '-10deg', '-16deg'] });
  const rotateX = spin.interpolate({ inputRange: [0, 1], outputRange: ['25deg', '10deg'] });
  const scale = spin.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 1.04, 1] });
  const ring = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[st.wrap, { opacity: out }]}>
      <View style={st.glow} />
      <View style={st.stage}>
        <Animated.View style={[st.orbit, { transform: [{ perspective: 700 }, { rotateX: '72deg' }, { rotateZ: ring }] }]} />
        {/* a few stacked copies give the mark depth as it turns, like the web version's layers */}
        {[3, 2, 1, 0].map((depth) => (
          <Animated.Image key={depth} source={require('../../assets/splash-icon.png')} resizeMode="contain"
            style={[st.mark, { opacity: depth === 0 ? 1 : 0.25, transform: [{ perspective: 700 }, { rotateX }, { rotateY }, { scale }, { translateX: depth * 1.5 }, { translateY: depth * 1.2 }] }]} />
        ))}
      </View>
      <Animated.Text style={[st.name, { opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>{name}</Animated.Text>
      <View style={st.track}><Animated.View style={[st.fill, { transform: [{ scaleX: bar }] }]} /></View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: '#23303A', alignItems: 'center', justifyContent: 'center', gap: 18, zIndex: 100 },
  glow: { position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(245,165,36,0.10)' },
  stage: { width: 170, height: 170, alignItems: 'center', justifyContent: 'center' },
  orbit: { position: 'absolute', width: 260, height: 260, borderRadius: 130, borderWidth: 2, borderColor: 'rgba(245,165,36,0.55)', borderTopColor: 'transparent', borderLeftColor: 'transparent' },
  mark: { position: 'absolute', width: 170, height: 170 },
  name: { color: color.ink, fontSize: 26, fontWeight: '800', letterSpacing: 0.5 },
  track: { width: 140, height: 3, borderRadius: 3, backgroundColor: 'rgba(43,53,64,0.9)', overflow: 'hidden' },
  fill: { width: 140, height: 3, backgroundColor: color.accent, transformOrigin: 'left' },
});
