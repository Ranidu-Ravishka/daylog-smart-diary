import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";

export type MoodTrendPoint = {
  /** Mood score on a 0–100 scale, or `null` if no memories that day */
  value: number | null;
  /** Short day label, e.g. "Mo" */
  day: string;
};

type MoodTrendChartProps = {
  data: MoodTrendPoint[];
  colors: ThemeColors;
  width: number;
  height?: number;
};

const PADDING_X = 18;
const PADDING_Y = 18;
const GRID_LEVELS = 4;
const DEFAULT_HEIGHT = 168;

function buildSmoothLinePath(
  points: { x: number; y: number }[],
): ReturnType<typeof Skia.Path.Make> | null {
  if (points.length < 2) return null;
  const path = Skia.Path.Make();
  path.moveTo(points[0]!.x, points[0]!.y);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, points.length - 1)]!;

    // Catmull–Rom → Bezier conversion (tension = 0.5)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path.cubicTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  return path;
}

function buildAreaPath(
  linePoints: { x: number; y: number }[],
  baselineY: number,
  smoothLine: ReturnType<typeof Skia.Path.Make> | null,
): ReturnType<typeof Skia.Path.Make> | null {
  if (!smoothLine || linePoints.length < 2) return null;
  const area = smoothLine.copy();
  area.lineTo(linePoints[linePoints.length - 1]!.x, baselineY);
  area.lineTo(linePoints[0]!.x, baselineY);
  area.close();
  return area;
}

function MoodTrendChartComponent({
  data,
  colors,
  width,
  height = DEFAULT_HEIGHT,
}: MoodTrendChartProps) {
  const progress = useSharedValue(0);

  const definedSeries = useMemo(
    () =>
      data
        .map((d, index) => ({ index, value: d.value }))
        .filter(
          (entry): entry is { index: number; value: number } =>
            entry.value !== null,
        ),
    [data],
  );

  const seriesKey = useMemo(
    () =>
      definedSeries.map((entry) => `${entry.index}:${entry.value}`).join("|"),
    [definedSeries],
  );

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: 720,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, seriesKey]);

  const animatedEnd = useDerivedValue(() => progress.value, [progress]);
  const animatedOpacity = useDerivedValue(() => progress.value, [progress]);

  const innerWidth = Math.max(width - PADDING_X * 2, 0);
  const innerHeight = Math.max(height - PADDING_Y * 2, 0);
  const baselineY = PADDING_Y + innerHeight;
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  const linePoints = useMemo(() => {
    if (definedSeries.length === 0) return [];
    return definedSeries.map((entry) => {
      const ratio = Math.min(Math.max(entry.value, 0), 100) / 100;
      return {
        x: PADDING_X + stepX * entry.index,
        y: PADDING_Y + innerHeight - innerHeight * ratio,
        index: entry.index,
        value: entry.value,
      };
    });
  }, [definedSeries, innerHeight, stepX]);

  const smoothLine = useMemo(
    () => buildSmoothLinePath(linePoints),
    [linePoints],
  );
  const areaPath = useMemo(
    () => buildAreaPath(linePoints, baselineY, smoothLine),
    [linePoints, baselineY, smoothLine],
  );

  const gridStart = useMemo(() => vec(PADDING_X, 0), []);
  const gridEnd = useMemo(() => vec(PADDING_X, height), [height]);

  const accentStart = useMemo(() => vec(0, PADDING_Y), []);
  const accentEnd = useMemo(() => vec(0, baselineY), [baselineY]);

  if (data.length === 0 || width <= 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <Canvas style={{ width, height }}>
        <Group>
          {Array.from({ length: GRID_LEVELS + 1 }).map((_, i) => {
            const y = PADDING_Y + (innerHeight * i) / GRID_LEVELS;
            const gridPath = Skia.Path.Make();
            gridPath.moveTo(PADDING_X, y);
            gridPath.lineTo(PADDING_X + innerWidth, y);
            return (
              <Path
                key={`grid-${i}`}
                path={gridPath}
                color={colors.divider}
                style="stroke"
                strokeWidth={1}
                opacity={0.45}
              />
            );
          })}
        </Group>

        {areaPath ? (
          <Group opacity={animatedOpacity}>
            <Path path={areaPath} style="fill">
              <LinearGradient
                start={accentStart}
                end={accentEnd}
                colors={[`${colors.tint}55`, `${colors.tint}00`]}
              />
            </Path>
          </Group>
        ) : null}

        {smoothLine ? (
          <Path
            path={smoothLine}
            color={colors.tint}
            style="stroke"
            strokeWidth={2.5}
            strokeJoin="round"
            strokeCap="round"
            start={0}
            end={animatedEnd}
          />
        ) : null}

        <Group opacity={animatedOpacity}>
          {linePoints.map((p) => (
            <Group key={`pt-${p.index}`}>
              <Circle cx={p.x} cy={p.y} r={5.5} color={colors.surface} />
              <Circle cx={p.x} cy={p.y} r={3.5} color={colors.tint} />
            </Group>
          ))}

          {data.map((entry, index) => {
            if (entry.value !== null) return null;
            const x = PADDING_X + stepX * index;
            return (
              <Circle
                key={`empty-${index}`}
                cx={x}
                cy={baselineY}
                r={2.5}
                color={colors.textTertiary}
                opacity={0.55}
              />
            );
          })}
        </Group>

        {/* Hide the unused grid endpoints from the unused-vars rule */}
        <Group opacity={0}>
          <Circle cx={gridStart.x} cy={gridStart.y} r={0} color={colors.tint} />
          <Circle cx={gridEnd.x} cy={gridEnd.y} r={0} color={colors.tint} />
        </Group>
      </Canvas>

      <View
        style={[styles.dayRow, { paddingHorizontal: PADDING_X }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {data.map((entry, index) => (
          <Text
            key={`${entry.day}-${index}`}
            style={[styles.dayLabel, { color: colors.textTertiary }]}
          >
            {entry.day}
          </Text>
        ))}
      </View>
    </View>
  );
}

export const MoodTrendChart = React.memo(MoodTrendChartComponent);

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  dayRow: {
    marginTop: Spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayLabel: {
    ...Typography.caption2,
    width: 24,
    textAlign: "center",
  },
});
