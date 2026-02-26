import { Suspense } from "react";
import { createServerClient } from "@/lib/supabase";
import type { Topic } from "@/lib/types";
import { PlatformTabs } from "@/components/platform-tabs";
import { TopicCard } from "@/components/topic-card";
import { AdSlot } from "@/components/ad-slot";
import { TimeAgo } from "@/components/time-ago";

export const revalidate = 300;

const TOPIC_COLUMNS =
  "id, slug, title, summary, summary_status, heat_score, total_engagement, source_count, post_count, sentiment_positive, sentiment_negative, sentiment_neutral, status, platforms_json, last_updated_at, report_count, flags";

const MIN_TOPICS_THRESHOLD = 10;

async function getTopics(platform?: string): Promise<Topic[]> {
  const supabase = createServerClient();

  let query = supabase
    .from("topics")
    .select(TOPIC_COLUMNS)
    .in("status", ["emerging", "rising", "peak"])
    .is("canonical_id", null)
    .lt("report_count", 5)
    .order("heat_score", { ascending: false })
    .limit(50);

  if (platform) {
    query = query.contains("platforms_json", { [platform]: {} });
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch topics:", error);
    return [];
  }

  let topics = (data as Topic[]).filter(
    (t) => !t.flags?.includes("suspected_spam")
  );

  // Fallback: if < MIN_TOPICS, relax conditions (include declining, source_diversity >= 1)
  if (topics.length < MIN_TOPICS_THRESHOLD && !platform) {
    const existingIds = new Set(topics.map((t) => t.id));

    const { data: fallbackData } = await supabase
      .from("topics")
      .select(TOPIC_COLUMNS)
      .in("status", ["emerging", "rising", "peak", "declining"])
      .is("canonical_id", null)
      .lt("report_count", 5)
      .order("heat_score", { ascending: false })
      .limit(50);

    if (fallbackData) {
      const fallbackTopics = (fallbackData as Topic[]).filter(
        (t) => !t.flags?.includes("suspected_spam") && !existingIds.has(t.id)
      );
      topics = [...topics, ...fallbackTopics].slice(0, 50);
    }
  }

  return topics;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const platform = typeof params.platform === "string" ? params.platform : "";
  const topics = await getTopics(platform || undefined);

  const latestUpdate = topics.length > 0 ? topics[0].last_updated_at : null;

  return (
    <>
      <Suspense>
        <PlatformTabs activeTab={platform} />
      </Suspense>

      {latestUpdate && (
        <div className="mt-3 flex items-center gap-1 text-sm text-zinc-500">
          <span>更新於</span>
          <TimeAgo date={latestUpdate} />
        </div>
      )}

      {topics.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <span className="text-5xl">🔥</span>
          <h2 className="text-xl font-bold text-zinc-700 dark:text-zinc-300">
            熱話即將上線
          </h2>
          <p className="text-zinc-500">
            我哋正努力收集同分析全港熱話，請稍後再返嚟！
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {topics.map((topic, i) => (
            <div key={topic.id}>
              <TopicCard topic={topic} rank={i + 1} />
              {(i + 1) % 4 === 0 && i < topics.length - 1 && (
                <div className="mt-3">
                  <AdSlot slot={`home-${Math.floor(i / 4)}`} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
