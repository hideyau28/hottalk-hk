"use client";

import { useEffect, useState } from "react";

interface CollectorStat {
  success: number;
  failed: number;
  partial: number;
  last_success: string | null;
  last_run: string | null;
}

interface StatusData {
  collectorStats: Record<string, CollectorStat>;
  lihkg_degradation_level: string;
  generated_at: string;
}

const COLLECTOR_LABELS: Record<string, string> = {
  youtube_collector: "YouTube",
  news_collector: "News RSS",
  lihkg_collector: "LIHKG",
  google_trends_collector: "Google Trends",
  incremental_assign: "Incremental Assign",
  nightly_recluster: "Nightly Recluster",
  summarize: "Summarize",
};

const LEVEL_COLORS: Record<string, string> = {
  L1: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  L2: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  L3: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function StatusDashboardPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchStatus() {
    try {
      const resp = await fetch("/api/admin/status");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <p className="py-10 text-center text-sm text-zinc-500">載入中…</p>;
  }

  if (error || !data) {
    return (
      <p className="py-10 text-center text-sm text-red-600">
        載入失敗: {error}
      </p>
    );
  }

  const collectors = [
    "youtube_collector",
    "news_collector",
    "lihkg_collector",
    "google_trends_collector",
  ];
  const jobs = ["incremental_assign", "nightly_recluster", "summarize"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Status Dashboard
        </h1>
        <span className="text-xs text-zinc-400">
          更新: {new Date(data.generated_at).toLocaleTimeString("zh-HK")} (每 30s)
        </span>
      </div>

      {/* LIHKG Degradation */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          LIHKG 降級等級:
        </span>
        <span
          className={`rounded px-3 py-1 text-sm font-bold ${LEVEL_COLORS[data.lihkg_degradation_level] ?? "bg-zinc-100"}`}
        >
          {data.lihkg_degradation_level}
        </span>
      </div>

      {/* Collector Status Table */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          Collectors (24h)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-xs text-zinc-500 dark:border-zinc-700">
                <th className="px-4 py-2">Collector</th>
                <th className="px-4 py-2">Success</th>
                <th className="px-4 py-2">Failed</th>
                <th className="px-4 py-2">Partial</th>
                <th className="px-4 py-2">Last Success</th>
                <th className="px-4 py-2">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {collectors.map((name) => {
                const stat = data.collectorStats[name];
                return (
                  <tr
                    key={name}
                    className="border-b border-zinc-50 dark:border-zinc-800"
                  >
                    <td className="px-4 py-2 font-medium">
                      {COLLECTOR_LABELS[name] ?? name}
                    </td>
                    <td className="px-4 py-2 text-green-600">{stat?.success ?? 0}</td>
                    <td className="px-4 py-2 text-red-600">{stat?.failed ?? 0}</td>
                    <td className="px-4 py-2 text-yellow-600">{stat?.partial ?? 0}</td>
                    <td className="px-4 py-2 text-xs text-zinc-500">
                      {timeAgo(stat?.last_success ?? null)}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">
                      {timeAgo(stat?.last_run ?? null)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Pipeline Jobs Table */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          AI Pipeline Jobs (24h)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-xs text-zinc-500 dark:border-zinc-700">
                <th className="px-4 py-2">Job</th>
                <th className="px-4 py-2">Success</th>
                <th className="px-4 py-2">Failed</th>
                <th className="px-4 py-2">Last Success</th>
                <th className="px-4 py-2">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((name) => {
                const stat = data.collectorStats[name];
                return (
                  <tr
                    key={name}
                    className="border-b border-zinc-50 dark:border-zinc-800"
                  >
                    <td className="px-4 py-2 font-medium">
                      {COLLECTOR_LABELS[name] ?? name}
                    </td>
                    <td className="px-4 py-2 text-green-600">{stat?.success ?? 0}</td>
                    <td className="px-4 py-2 text-red-600">{stat?.failed ?? 0}</td>
                    <td className="px-4 py-2 text-xs text-zinc-500">
                      {timeAgo(stat?.last_success ?? null)}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">
                      {timeAgo(stat?.last_run ?? null)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
