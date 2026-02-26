import Link from "next/link";
import type { Topic, Platform } from "@/lib/types";
import { HeatIndicator } from "./heat-indicator";
import { PlatformBadge } from "./platform-badge";
import { SentimentBar } from "./sentiment-bar";
import { ReportButton } from "./report-button";

function parsePlatforms(platformsJson: Record<string, unknown>): { platform: Platform; count: number }[] {
  const results: { platform: Platform; count: number }[] = [];
  for (const [key, value] of Object.entries(platformsJson)) {
    if (typeof value === "number") {
      results.push({ platform: key as Platform, count: value });
    }
  }
  return results;
}

export function TopicCard({ topic, rank }: { topic: Topic; rank: number }) {
  const platforms = parsePlatforms(topic.platforms_json);

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/topic/${topic.slug}`}
              className="text-base font-bold leading-snug text-zinc-900 hover:underline dark:text-zinc-50"
            >
              {topic.title}
            </Link>
            <HeatIndicator score={topic.heat_score} />
          </div>

          {topic.summary && topic.summary_status !== "hidden" && (
            <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
              {topic.summary}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            {platforms.map(({ platform, count }) => (
              <PlatformBadge key={platform} platform={platform} count={count} />
            ))}
          </div>

          <div className="mt-2">
            <SentimentBar
              positive={topic.sentiment_positive}
              negative={topic.sentiment_negative}
              neutral={topic.sentiment_neutral}
            />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-zinc-400">
              {topic.post_count} 篇來源 · {topic.source_count} 個平台
            </span>
            <ReportButton topicId={topic.id} />
          </div>
        </div>
      </div>
    </article>
  );
}
