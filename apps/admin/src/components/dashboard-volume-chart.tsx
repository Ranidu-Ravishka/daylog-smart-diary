"use client";

import { useMounted } from "@/lib/use-mounted";
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
  const hasMounted = useMounted();
  const isDark = hasMounted && resolvedTheme === "dark";

  const fill = isDark ? "#91B49A" : "#2F3E46";
  const gridStroke = isDark ? "#2F2F2F" : "#E5E5E5";
  const tickFill = isDark ? "#A0A0A0" : "#6B6B6B";
  const tooltipBackground = isDark ? "#1E1E1E" : "#FFFFFF";
  const tooltipBorder = isDark ? "#2F2F2F" : "#E5E5E5";
  const tooltipLabel = isDark ? "#EAEAEA" : "#1A1A1A";

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
            cursor={{ fill: "rgba(0, 0, 0, 0.04)" }}
            contentStyle={{
              borderRadius: 12,
              border: `1px solid ${tooltipBorder}`,
              background: tooltipBackground,
              fontSize: 12,
            }}
            labelStyle={{ color: tooltipLabel, fontWeight: 600 }}
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
