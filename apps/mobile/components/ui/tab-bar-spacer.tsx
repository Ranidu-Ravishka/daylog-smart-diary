import React from "react";
import { View } from "react-native";

import { useTabBarSpacing } from "@/hooks/use-tab-bar-spacing";

type TabBarSpacerProps = {
  /**
   * Extra pixels to reserve on top of the tab-bar clearance. Use when the
   * scroll list ends in something tall (e.g. a primary CTA you want to keep
   * comfortably above the bar).
   */
  extra?: number;
};

/**
 * Drop this at the bottom of any tabbed screen's scroll list to ensure the
 * last row clears the floating tab bar (and Android system inset). Replaces
 * the legacy `<View style={{ height: 100 }} />` magic spacer.
 */
export function TabBarSpacer({ extra = 0 }: TabBarSpacerProps) {
  const height = useTabBarSpacing(extra);
  return <View pointerEvents="none" style={{ height }} />;
}
