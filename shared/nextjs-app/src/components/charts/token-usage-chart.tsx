"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TokenUsageData } from "@/lib/types";

interface TokenUsageChartProps {
  data: TokenUsageData[];
  title?: string;
}

export default function TokenUsageChart({
  data,
  title = "Token Usage",
}: TokenUsageChartProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <h3 className="text-sm font-medium text-gray-900 mb-4">{title}</h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              stroke="#9ca3af"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              stroke="#9ca3af"
              tickFormatter={(v: number) =>
                v >= 1000000
                  ? `${(v / 1000000).toFixed(1)}M`
                  : v >= 1000
                  ? `${(v / 1000).toFixed(0)}K`
                  : String(v)
              }
            />
            <Tooltip
              contentStyle={{
                borderRadius: "0.5rem",
                border: "1px solid #e5e7eb",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
              formatter={(value: number, name: string) => [
                value.toLocaleString(),
                name === "promptTokens" ? "Input Tokens" : "Output Tokens",
              ]}
            />
            <Legend
              formatter={(value: string) =>
                value === "promptTokens" ? "Input Tokens" : "Output Tokens"
              }
            />
            <Bar
              dataKey="promptTokens"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              name="promptTokens"
            />
            <Bar
              dataKey="completionTokens"
              fill="#8b5cf6"
              radius={[4, 4, 0, 0]}
              name="completionTokens"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
