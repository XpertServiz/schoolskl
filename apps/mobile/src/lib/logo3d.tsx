import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

/**
 * The school-house mark as a gently turning 3D object (stacked copies with perspective), floating up and down — the same mark and motion
 * language as the splash and the website. Pauses for reduced motion.
 */
export function Logo3D({ size = 120 }: { size?: number }) {
  const turn = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loops = [
        Animated.loop(Animated.sequence([
          Animated.timing(turn, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(turn, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])),
        Animated.loop(Animated.sequence([
          Animated.timing(float, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(float, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])),
      ];
      loops.forEach((l) => l.start());
    });
    return () => loops.forEach((l) => l.stop());
  }, [turn, float]);
  const rotateY = turn.interpolate({ inputRange: [0, 1], outputRange: ['-28deg', '28deg'] });
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  return (
    <View style={{ width: size * 1.6, height: size * 1.35, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: 'absolute', width: size * 1.5, height: size * 1.5, borderRadius: size, backgroundColor: 'rgba(245,165,36,0.05)', borderWidth: 1, borderColor: 'rgba(245,165,36,0.12)' }} />
      <Animated.View style={{ position: 'absolute', bottom: size * 0.04, width: size * 0.8, height: size * 0.12, borderRadius: size, backgroundColor: 'rgba(0,0,0,0.18)', transform: [{ scaleX: float.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }) }] }} />
      {[3, 2, 1, 0].map((d) => (
        <Animated.Image key={d} source={require('../../assets/splash-icon.png')} resizeMode="contain"
          style={{ position: 'absolute', width: size, height: size, opacity: d === 0 ? 1 : 0.22, transform: [{ perspective: 600 }, { translateY }, { rotateX: '12deg' }, { rotateY }, { translateX: d * 1.4 }, { translateY: d * 1.1 }] }} />
      ))}
    </View>
  );
}
