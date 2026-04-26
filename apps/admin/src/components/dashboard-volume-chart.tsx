"use client";

import { useTheme } from "next-themes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type VolumeDatum = { name: string; value: number };

export function DashboardVolumeChart({ data }: { data: VolumeDatum[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const fill = isDark ? "#fafafa" : "#18181b";
  const gridStroke = isDark ? "#3f3f46" : "#e4e4e7";
  const tickFill = isDark ? "#a1a1aa" : "#52525b";

  return (
    <div className="h-[280px] w-full text-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={gridStroke}
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fill: tickFill, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: tickFill, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "rgba(24, 24, 27, 0.06)" }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid rgb(228 228 231)",
              background: "#ffffff",
              fontSize: 12,
            }}
            labelStyle={{ color: "#18181b", fontWeight: 600 }}
          />
          <Bar
            dataKey="value"
            fill={fill}
            radius={[8, 8, 0, 0]}
            maxBarSize={44}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
