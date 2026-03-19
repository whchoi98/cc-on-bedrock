"use client";

import { useState, useEffect, useCallback } from "react";
import StatCard from "@/components/cards/stat-card";
import TokenUsageChart from "@/components/charts/token-usage-chart";
import ModelRatioChart from "@/components/charts/model-ratio-chart";
import CostTrendChart from "@/components/charts/cost-trend-chart";
import type {
  TokenUsageData,
  ModelRatioData,
  CostTrendData,
  SpendLog,
  ModelMetrics,
  SpendSummary,
  ApiResponse,
} from "@/lib/types";

interface AnalyticsDashboardProps {
  isAdmin: boolean;
}

type TimeRange = "7d" | "30d" | "90d";

function getDateRange(range: TimeRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  switch (range) {
    case "7d":
      start.setDate(end.getDate() - 7);
      break;
    case "30d":
      start.setDate(end.getDate() - 30);
      break;
    case "90d":
      start.setDate(end.getDate() - 90);
      break;
  }
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export default function AnalyticsDashboard({
  isAdmin,
}: AnalyticsDashboardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [tokenData, setTokenData] = useState<TokenUsageData[]>([]);
  const [modelData, setModelData] = useState<ModelRatioData[]>([]);
  const [costData, setCostData] = useState<CostTrendData[]>([]);
  const [totalSpend, setTotalSpend] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { start, end } = getDateRange(timeRange);

    try {
      // Fetch spend logs
      const logsRes = await fetch(
        `/api/litellm?action=spend_logs&start_date=${start}&end_date=${end}`
      );
      const logsJson = (await logsRes.json()) as ApiResponse<SpendLog[]>;
      const logs = logsJson.data ?? [];

      // Aggregate token usage by date
      const tokenMap = new Map<
        string,
        { promptTokens: number; completionTokens: number }
      >();
      let sumSpend = 0;
      let sumTokens = 0;

      for (const log of logs) {
        const date = log.startTime.split("T")[0];
        const existing = tokenMap.get(date) ?? {
          promptTokens: 0,
          completionTokens: 0,
        };
        existing.promptTokens += log.prompt_tokens;
        existing.completionTokens += log.completion_tokens;
        tokenMap.set(date, existing);
        sumSpend += log.spend;
        sumTokens += log.total_tokens;
      }

      const tokenUsage: TokenUsageData[] = Array.from(tokenMap.entries())
        .map(([date, tokens]) => ({ date, ...tokens }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setTokenData(tokenUsage);
      setTotalSpend(sumSpend);
      setTotalTokens(sumTokens);
      setTotalRequests(logs.length);

      // Fetch model metrics (admin only)
      if (isAdmin) {
        const metricsRes = await fetch(
          `/api/litellm?action=model_metrics&start_date=${start}&end_date=${end}`
        );
        const metricsJson = (await metricsRes.json()) as ApiResponse<
          ModelMetrics[]
        >;
        const metrics = metricsJson.data ?? [];
        setModelData(
          metrics.map((m) => ({ name: m.model, value: m.num_requests }))
        );
      }

      // Fetch cost trend
      const spendRes = await fetch(
        `/api/litellm?action=spend_per_day&start_date=${start}&end_date=${end}`
      );
      const spendJson = (await spendRes.json()) as ApiResponse<SpendSummary[]>;
      const spendData = spendJson.data ?? [];
      setCostData(
        spendData.map((s) => ({ date: s.date, cost: s.spend }))
      );
    } catch (err) {
      console.error("Failed to fetch analytics data:", err);
    } finally {
      setLoading(false);
    }
  }, [timeRange, isAdmin]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex items-center gap-2">
        {(["7d", "30d", "90d"] as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              timeRange === range
                ? "bg-primary-600 text-white"
                : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
            }`}
          >
            {range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "90 Days"}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Spend"
          value={`$${totalSpend.toFixed(4)}`}
          description={`Last ${timeRange === "7d" ? "7 days" : timeRange === "30d" ? "30 days" : "90 days"}`}
        />
        <StatCard
          title="Total Tokens"
          value={totalTokens.toLocaleString()}
          description="Input + Output tokens"
        />
        <StatCard
          title="Total Requests"
          value={totalRequests.toLocaleString()}
          description="API calls"
        />
      </div>

      {/* Charts */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-sm text-gray-500">Loading analytics...</div>
        </div>
      ) : (
        <div className="space-y-6">
          <TokenUsageChart data={tokenData} title="Daily Token Usage" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {isAdmin && (
              <ModelRatioChart
                data={modelData}
                title="Model Usage (Opus 4.6 vs Sonnet 4.6)"
              />
            )}
            <CostTrendChart data={costData} title="Daily Cost Trend" />
          </div>
        </div>
      )}
    </div>
  );
}
