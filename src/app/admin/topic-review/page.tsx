import { createServerClient } from "@/lib/supabase";
import TopicReviewClient from "./topic-review-client";

export const dynamic = "force-dynamic";

interface TopicRow {
  id: string;
  slug: string;
  title: string;
  heat_score: number;
  status: string;
  flags: string[];
  post_count: number;
  source_count: number;
  summary: string | null;
  summary_status: string;
  first_detected_at: string;
}

interface PostRow {
  post_id: string;
  raw_posts: {
    id: string;
    platform: string;
    title: string;
    url: string;
    published_at: string;
  };
}

async function fetchTopicsForReview() {
  const db = createServerClient();

  // Heat score top 20 active topics
  const { data: topTopics } = await db
    .from("topics")
    .select(
      "id, slug, title, heat_score, status, flags, post_count, source_count, summary, summary_status, first_detected_at",
    )
    .is("canonical_id", null)
    .in("status", ["emerging", "rising", "peak"])
    .order("heat_score", { ascending: false })
    .limit(20);

  // All flagged topics (regardless of status)
  const { data: flaggedTopics } = await db
    .from("topics")
    .select(
      "id, slug, title, heat_score, status, flags, post_count, source_count, summary, summary_status, first_detected_at",
    )
    .is("canonical_id", null)
    .not("flags", "eq", "{}");

  // Merge and deduplicate
  const topicMap = new Map<string, TopicRow>();
  for (const t of (topTopics ?? []) as TopicRow[]) {
    topicMap.set(t.id, t);
  }
  for (const t of (flaggedTopics ?? []) as TopicRow[]) {
    topicMap.set(t.id, t);
  }
  const allTopics = Array.from(topicMap.values()).sort(
    (a, b) => b.heat_score - a.heat_score,
  );

  // Fetch posts for each topic
  const topicsWithPosts = await Promise.all(
    allTopics.map(async (topic) => {
      const { data: postRows } = await db
        .from("topic_posts")
        .select("post_id, raw_posts!inner(id, platform, title, url, published_at)")
        .eq("topic_id", topic.id)
        .order("assigned_at", { ascending: false })
        .limit(30);

      const posts = (postRows as PostRow[] | null)?.map((r) => ({
        id: r.raw_posts.id,
        platform: r.raw_posts.platform,
        title: r.raw_posts.title,
        url: r.raw_posts.url,
        published_at: r.raw_posts.published_at,
      })) ?? [];

      return { ...topic, posts };
    }),
  );

  return topicsWithPosts;
}

export default async function TopicReviewPage() {
  const topics = await fetchTopicsForReview();

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-zinc-900 dark:text-zinc-100">
        Topic Review
      </h1>
      <p className="mb-4 text-sm text-zinc-500">
        Top 20 by heat_score + flagged topics ({topics.length} total)
      </p>
      <TopicReviewClient topics={topics} />
    </div>
  );
}
