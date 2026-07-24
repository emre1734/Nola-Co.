export const useSharedValue = (v: any) => ({ value: v });
export const useAnimatedStyle = (fn: any) => fn();
export const withTiming = (v: any) => v;
export const withSpring = (v: any) => v;
export const withSequence = (...args: any[]) => args[args.length - 1];
export const withDelay = (_: any, v: any) => v;
export const Easing = { linear: (t: any) => t, ease: (t: any) => t };
export default { useSharedValue, useAnimatedStyle, withTiming, withSpring };
