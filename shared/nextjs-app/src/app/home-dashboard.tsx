"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { SpendLog, ContainerInfo, ApiResponse } from "@/lib/types";
import type { KeySpendInfo } from "@/lib/litellm-client";

interface HomeDashboardProps {
  isAdmin: boolean;
}

interface SystemHealth {
  status: string;
  db: string;
  cache: string;
  litellm_version: string;
  model_count: number;
}

// ── AWSops-style Stat Card ──
function StatsCard({
  title,
  value,
  subtitle,
  icon,
  iconBg = "bg-cyan-500/20",
  iconColor = "text-cyan-400",
  alert,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-[#111827] rounded-lg border border-gray-800/50 p-4 hover:border-gray-700/60 transition-colors">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-400 truncate">{title}</p>
          <p className={`mt-1 text-2xl font-bold tracking-tight ${alert ? "text-red-400" : "text-white"}`}>
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-gray-500 truncate">{subtitle}</p>
          )}
        </div>
        <div className={`shrink-0 p-2 rounded-full ${iconBg}`}>
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
    </div>
  );
}

// ── Section Header (AWSops style: uppercase, tracking) ──
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-3">
      {children}
    </h2>
  );
}

// ── Warning Bar ──
function WarningBar({ items }: { items: { icon: string; text: string; color?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="bg-[#111827] rounded-lg border border-gray-800/50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-400 text-xs">⚠</span>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Active Alerts ({items.length})
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span>{item.icon}</span>
            <span className={item.color ?? "text-gray-300"}>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Quick Nav Card ──
function NavCard({ href, title, desc, icon, iconBg }: {
  href: string; title: string; desc: string; icon: React.ReactNode; iconBg: string;
}) {
  return (
    <Link href={href}
      className="flex items-center gap-3 p-3 bg-[#111827] rounded-lg border border-gray-800/50 hover:border-cyan-500/30 hover:bg-[#151d2e] transition-all group"
    >
      <div className={`p-2 rounded-lg ${iconBg} shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-200 group-hover:text-cyan-300 transition-colors">{title}</p>
        <p className="text-[10px] text-gray-500 truncate">{desc}</p>
      </div>
      <svg className="w-3.5 h-3.5 ml-auto text-gray-700 group-hover:text-cyan-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// ── SVG Icons ──
const icons = {
  dollar: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  bolt: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  users: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  server: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>,
  db: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>,
  shield: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  chart: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  key: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>,
  model: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  cache: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
};

function formatCost(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(2)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export default function HomeDashboard({ isAdmin }: HomeDashboardProps) {
  const { t } = useI18n();
  const [totalSpend, setTotalSpend] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [keySpendList, setKeySpendList] = useState<KeySpendInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

      const fetches: Promise<Response>[] = [
        fetch(`/api/litellm?action=spend_logs&start_date=${weekAgo}&end_date=${today}`),
        fetch("/api/containers"),
      ];
      if (isAdmin) {
        fetches.push(
          fetch("/api/litellm?action=system_health"),
          fetch("/api/litellm?action=key_spend_list"),
        );
      }

      const [logsRes, containersRes, healthRes, keyRes] = await Promise.all(fetches);

      const logsJson = (await logsRes.json()) as ApiResponse<SpendLog[]>;
      const logs = logsJson.data ?? [];
      setTotalSpend(logs.reduce((s, l) => s + l.spend, 0));
      setTotalRequests(logs.length);
      setActiveUsers(new Set(logs.map((l) => l.user || l.api_key)).size);

      const cJson = (await containersRes.json()) as ApiResponse<ContainerInfo[]>;
      setContainers(cJson.data ?? []);

      if (healthRes) {
        const hJson = (await healthRes.json()) as ApiResponse<SystemHealth>;
        setSystemHealth(hJson.data ?? null);
      }
      if (keyRes) {
        const kJson = (await keyRes.json()) as ApiResponse<KeySpendInfo[]>;
        setKeySpendList(kJson.data ?? []);
      }
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Home fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runningContainers = containers.filter((c) => c.status === "RUNNING");
  const pendingContainers = containers.filter((c) => c.status === "PENDING" || c.status === "PROVISIONING");

  // Warnings
  const warnings: { icon: string; text: string; color?: string }[] = [];
  const overBudgetKeys = keySpendList.filter(
    (k) => k.max_budget && k.spend / k.max_budget > 0.8
  );
  if (overBudgetKeys.length > 0) {
    warnings.push({
      icon: "🔑",
      text: `${overBudgetKeys.length} API Key(s) over 80% budget`,
      color: "text-amber-400",
    });
  }
  if (pendingContainers.length > 0) {
    warnings.push({
      icon: "⏳",
      text: `${pendingContainers.length} container(s) pending`,
      color: "text-yellow-400",
    });
  }
  if (systemHealth && systemHealth.status !== "healthy") {
    warnings.push({
      icon: "🔴",
      text: `Proxy status: ${systemHealth.status}`,
      color: "text-red-400",
    });
  }

  // Budget stats
  const totalBudget = keySpendList.reduce((s, k) => s + (k.max_budget ?? 0), 0);
  const totalKeySpend = keySpendList.reduce((s, k) => s + k.spend, 0);
  const dailyBurnRate = totalSpend / 7;

  const isOnline = systemHealth?.status === "healthy";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-white tracking-tight">CC-on-Bedrock Dashboard</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-gray-500">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => void fetchData()}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded-full ${
            isOnline ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            {isOnline ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-sm text-gray-500">{t("analytics.loading")}</div>
        </div>
      ) : (
        <>
          {/* Usage & Cost */}
          <div>
            <SectionHeader>{t("home.title")} · USAGE &amp; COST</SectionHeader>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatsCard title={t("home.totalCost")} value={formatCost(totalSpend)} subtitle="Last 7 days" icon={icons.dollar} iconBg="bg-cyan-500/15" iconColor="text-cyan-400" />
              <StatsCard title={t("home.totalRequests")} value={totalRequests.toLocaleString()} subtitle="API calls" icon={icons.bolt} iconBg="bg-purple-500/15" iconColor="text-purple-400" />
              <StatsCard title={t("home.activeUsers")} value={activeUsers} subtitle="Last 7 days" icon={icons.users} iconBg="bg-green-500/15" iconColor="text-green-400" />
              <StatsCard title={t("home.runningContainers")} value={runningContainers.length} subtitle={`${containers.length} total`} icon={icons.server} iconBg="bg-amber-500/15" iconColor="text-amber-400" />
              <StatsCard title="Daily Burn" value={formatCost(dailyBurnRate)} subtitle="/day avg" icon={icons.chart} iconBg="bg-red-500/15" iconColor="text-red-400" />
              <StatsCard title="Monthly Est." value={formatCost(dailyBurnRate * 30)} subtitle="Projected" icon={icons.dollar} iconBg="bg-pink-500/15" iconColor="text-pink-400" />
            </div>
          </div>

          {/* Infrastructure */}
          {isAdmin && systemHealth && (
            <div>
              <SectionHeader>INFRASTRUCTURE &amp; SERVICES</SectionHeader>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatsCard title={t("home.proxyStatus")} value={systemHealth.status} subtitle={`v${systemHealth.litellm_version}`} icon={icons.bolt} iconBg="bg-green-500/15" iconColor="text-green-400" />
                <StatsCard title={t("home.dbStatus")} value={systemHealth.db} subtitle="PostgreSQL" icon={icons.db} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
                <StatsCard title={t("home.cacheStatus")} value={systemHealth.cache} subtitle="Valkey Serverless" icon={icons.cache} iconBg="bg-orange-500/15" iconColor="text-orange-400" />
                <StatsCard title={t("home.modelCount")} value={systemHealth.model_count} subtitle="Bedrock models" icon={icons.model} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
                <StatsCard title="API Keys" value={keySpendList.length} subtitle={`Budget: $${totalBudget.toFixed(0)}`} icon={icons.key} iconBg="bg-yellow-500/15" iconColor="text-yellow-400" />
                <StatsCard
                  title="Budget Used"
                  value={totalBudget > 0 ? `${((totalKeySpend / totalBudget) * 100).toFixed(1)}%` : "N/A"}
                  subtitle={`$${totalKeySpend.toFixed(4)} / $${totalBudget.toFixed(0)}`}
                  icon={icons.shield}
                  iconBg="bg-cyan-500/15"
                  iconColor="text-cyan-400"
                />
              </div>
            </div>
          )}

          {/* Warnings */}
          <WarningBar items={warnings} />

          {/* Quick Actions */}
          {isAdmin && (
            <div>
              <SectionHeader>{t("home.quickActions")}</SectionHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <NavCard href="/analytics" title={t("home.viewAnalytics")} desc="Token usage, cost, leaderboard" icon={<span className="text-cyan-400">{icons.chart}</span>} iconBg="bg-cyan-500/10" />
                <NavCard href="/monitoring" title={t("home.viewMonitoring")} desc="Health, containers, sessions" icon={<span className="text-green-400">{icons.bolt}</span>} iconBg="bg-green-500/10" />
                <NavCard href="/admin" title={t("home.manageUsers")} desc={`${activeUsers} active users`} icon={<span className="text-purple-400">{icons.users}</span>} iconBg="bg-purple-500/10" />
                <NavCard href="/admin/containers" title={t("home.manageContainers")} desc={`${runningContainers.length} running`} icon={<span className="text-amber-400">{icons.server}</span>} iconBg="bg-amber-500/10" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
