import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';

/**
 * Night-sky background for every screen (same look as the website hero): deep gradient, ~90 stars in three twinkle groups, a glowing
 * moon and two mountain silhouettes. Plain Views + native-driver opacity loops: no WebGL, cheap on low-end phones; still for reduced motion.
 */
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

export function StarSky({ moon = true }: { moon?: boolean }) {
  const { width, height } = useWindowDimensions();
  const groups = useRef([new Animated.Value(1), new Animated.Value(0.6), new Animated.Value(0.85)]).current;
  const stars = useMemo(() => {
    seed = 42;
    return Array.from({ length: 60 }, (_, i) => {
      const big = rnd() > 0.9;
      return { x: rnd() * width, y: rnd() * height * 0.78, r: big ? 2.4 : 0.8 + rnd() * 1.2, g: i % 3, tint: rnd() < 0.15 ? '#FFE3B0' : rnd() < 0.3 ? '#CFE0FF' : '#FFFFFF' };
    });
  }, [width, height]);
  const ridge = useMemo(() => {
    seed = 7; // a jagged skyline from stacked rotated blocks
    return Array.from({ length: 9 }, (_, i) => ({ x: (i / 8) * width - 60 + rnd() * 40, w: 120 + rnd() * 120, h: 60 + rnd() * 70 }));
  }, [width]);

  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loops = groups.map((v, i) => Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 0.25, duration: 1400 + i * 500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 1400 + i * 500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])));
      loops.forEach((l) => l.start());
    });
    return () => loops.forEach((l) => l.stop());
  }, [groups]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={['#02040B', '#060C1C', '#0B1424']} style={StyleSheet.absoluteFill} />
      {/* milky-way haze */}
      <View style={{ position: 'absolute', width: width * 1.6, height: 160, left: -width * 0.3, top: height * 0.18, borderRadius: 200, backgroundColor: 'rgba(170,190,255,0.05)', transform: [{ rotate: '-24deg' }] }} />
      {groups.map((v, gi) => (
        <Animated.View key={gi} style={[StyleSheet.absoluteFill, { opacity: v }]}>
          {stars.filter((s) => s.g === gi).map((s, i) => (
            <View key={i} style={{ position: 'absolute', left: s.x, top: s.y, width: s.r * 2, height: s.r * 2, borderRadius: s.r, backgroundColor: s.tint, shadowColor: s.tint, shadowOpacity: s.r > 2 ? 0.9 : 0, shadowRadius: 4 }} />
          ))}
        </Animated.View>
      ))}
      {moon ? (
        <View style={{ position: 'absolute', left: width * 0.1, top: height * 0.1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(210,222,255,0.035)' }} />
          <View style={{ position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(210,222,255,0.06)' }} />
          <LinearGradient colors={['#FFFDF5', '#DCD8CC', '#A9A69C']} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.9, y: 0.9 }} style={{ width: 46, height: 46, borderRadius: 23 }}>
            <View style={{ position: 'absolute', left: 10, top: 12, width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(120,116,108,0.35)' }} />
            <View style={{ position: 'absolute', left: 26, top: 24, width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(120,116,108,0.3)' }} />
            <View style={{ position: 'absolute', left: 20, top: 8, width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(120,116,108,0.3)' }} />
          </LinearGradient>
        </View>
      ) : null}
      {/* far and near mountain ridges */}
      {/* a rotated square shows only its top corner above the bottom edge: peaks of ~0.7·w − sink */}
      {ridge.map((r, i) => (
        <View key={`f${i}`} style={{ position: 'absolute', left: r.x, bottom: -r.w * 0.5 - (r.w * 0.707 - r.h), width: r.w, height: r.w, backgroundColor: '#0A1224', transform: [{ rotate: '45deg' }] }} />
      ))}
      {ridge.map((r, i) => (
        <View key={`n${i}`} style={{ position: 'absolute', left: r.x + 50, bottom: -r.w * 0.45 - (r.w * 0.64 - r.h * 0.55), width: r.w * 0.9, height: r.w * 0.9, backgroundColor: '#03060E', transform: [{ rotate: '45deg' }] }} />
      ))}
    </View>
  );
}
