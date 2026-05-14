import { useMemo } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TAB_BAR_HEIGHT = 70;
const TAB_BAR_FLOAT_OFFSET = 12;
const TAB_BAR_BREATHING_GAP = 18;

/**
 * Returns the bottom padding scrollable screens should reserve so their content
 * never sits underneath the floating tab bar (or its Android inset compensation).
 *
 * Use this on the `contentContainerStyle.paddingBottom` of every tabbed screen
 * (or as a `<View />` height spacer at the end of the scroll list).
 */
export function useTabBarSpacing(extra = 0): number {
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    const androidInsetCompensation =
      Platform.OS === "android" ? insets.bottom : 0;
    return (
      TAB_BAR_HEIGHT +
      TAB_BAR_FLOAT_OFFSET +
      TAB_BAR_BREATHING_GAP +
      androidInsetCompensation +
      extra
    );
  }, [insets.bottom, extra]);
}
