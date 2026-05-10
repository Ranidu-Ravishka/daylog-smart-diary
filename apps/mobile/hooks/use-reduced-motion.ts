import { useReducedMotion } from "react-native-reanimated";

/**
 * Wrapper so feature code can branch on accessibility “reduce motion” in one place.
 */
export function useReducedMotionPreference(): boolean {
  return useReducedMotion();
}
