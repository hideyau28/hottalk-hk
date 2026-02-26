"use client";

import { useRouter, useSearchParams } from "next/navigation";

const TABS = [
  { key: "", emoji: "🔥", label: "全部" },
  { key: "youtube", emoji: "📺", label: "YouTube" },
  { key: "lihkg", emoji: "💬", label: "連登" },
  { key: "news", emoji: "📰", label: "新聞" },
  { key: "google_trends", emoji: "🔍", label: "Google" },
] as const;

export function PlatformTabs({ activeTab }: { activeTab: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleClick(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (key) {
      params.set("platform", key);
    } else {
      params.delete("platform");
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  return (
    <nav className="sticky top-[57px] z-40 -mx-4 overflow-x-auto border-b border-zinc-200 bg-white/90 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="flex gap-1 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleClick(tab.key)}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
