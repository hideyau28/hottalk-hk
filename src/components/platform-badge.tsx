import type { Platform } from "@/lib/types";

const PLATFORM_CONFIG: Record<Platform, { emoji: string; label: string; bg: string }> = {
  youtube: { emoji: "📺", label: "YouTube", bg: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  lihkg: { emoji: "💬", label: "連登", bg: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
  news: { emoji: "📰", label: "新聞", bg: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  google_trends: { emoji: "🔍", label: "Google", bg: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" },
};

export function PlatformBadge({
  platform,
  count,
}: {
  platform: Platform;
  count?: number;
}) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.bg}`}
    >
      <span>{config.emoji}</span>
      <span>{config.label}</span>
      {count != null && count > 0 && (
        <span className="tabular-nums">({count})</span>
      )}
    </span>
  );
}
