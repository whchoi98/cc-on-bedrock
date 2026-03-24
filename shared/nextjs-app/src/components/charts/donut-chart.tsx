"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface DonutEntry {
  name: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutEntry[];
  title: string;
  colors?: string[];
  centerLabel?: string;
  centerValue?: string;
  valueFormatter?: (v: number) => string;
  height?: number;
}

const DEFAULT_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

export default function DonutChart({
  data,
  title,
  colors = DEFAULT_COLORS,
  centerLabel,
  centerValue,
  valueFormatter,
  height = 220,
}: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
      <h4 className="text-sm font-medium text-gray-300 mb-3">{title}</h4>
      <div style={{ height }} className="relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, i) => (
                <Cell
                  key={entry.name}
                  fill={entry.color ?? colors[i % colors.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "0.5rem",
                color: "#f3f4f6",
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [
                valueFormatter
                  ? valueFormatter(value)
                  : `${value.toLocaleString()} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        {centerLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-white">{centerValue}</span>
            <span className="text-[10px] text-gray-500">{centerLabel}</span>
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 justify-center">
        {data.map((entry, i) => {
          const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0";
          return (
            <div key={entry.name} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{
                  backgroundColor:
                    entry.color ?? colors[i % colors.length],
                }}
              />
              <span className="text-[10px] text-gray-400">
                {entry.name} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
