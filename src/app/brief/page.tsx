import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase";
import type { DailyBrief } from "@/lib/types";
import { HeatIndicator } from "@/components/heat-indicator";
import { PlatformBadge } from "@/components/platform-badge";
import type { Platform } from "@/lib/types";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "今日懶人包",
  description: "每日精選全港 Top 5 熱話，一分鐘睇完今日重點。",
  openGraph: {
    title: "今日懶人包 | 熱話 HotTalk HK",
    description: "每日精選全港 Top 5 熱話，一分鐘睇完今日重點。",
    url: "https://hottalk.hk/brief",
    images: [
      {
        url: "https://hottalk.hk/api/og",
        width: 1200,
        height: 630,
        alt: "今日懶人包 — 全港 Top 5 熱話",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "今日懶人包 | 熱話 HotTalk HK",
    description: "每日精選全港 Top 5 熱話，一分鐘睇完今日重點。",
    images: ["https://hottalk.hk/api/og"],
  },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+08:00");
  return d.toLocaleDateString("zh-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

async function getTodayBrief(): Promise<DailyBrief | null> {
  try {
    const supabase = createServerClient();

    // Try today first (HKT = UTC+8)
    const now = new Date();
    const hktOffset = 8 * 60 * 60 * 1000;
    const hktDate = new Date(now.getTime() + hktOffset);
    const today = hktDate.toISOString().slice(0, 10);

    const { data } = await supabase
      .from("daily_briefs")
      .select("*")
      .eq("tier", "free")
      .eq("brief_date", today)
      .single();

    if (data) return data as DailyBrief;

    // Fallback: most recent brief
    const { data: latest } = await supabase
      .from("daily_briefs")
      .select("*")
      .eq("tier", "free")
      .order("brief_date", { ascending: false })
      .limit(1)
      .single();

    return latest as DailyBrief | null;
  } catch {
    return null;
  }
}

export default async function BriefPage() {
  const brief = await getTodayBrief();

  if (!brief) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          今日懶人包
        </h1>
        <p className="mt-4 text-zinc-500">
          今日嘅懶人包仲未準備好，請稍後再嚟。
        </p>
      </div>
    );
  }

  const topics = brief.content.topics;

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        今日懶人包
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {formatDate(brief.brief_date)} — 全港 Top {topics.length} 熱話
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {topics.map((topic) => (
          <Link
            key={topic.slug}
            href={`/topic/${topic.slug}`}
            className="flex items-start gap-4 rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
              {topic.rank}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                {topic.title}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <HeatIndicator score={topic.heat_score} />
                <div className="flex gap-1">
                  {topic.platforms.map((p) => (
                    <PlatformBadge key={p} platform={p as Platform} />
                  ))}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-zinc-400">
        每日中午 12:00 更新
      </p>
    </div>
  );
}
