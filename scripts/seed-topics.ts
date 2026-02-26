/**
 * Cold start seed script for HotTalk HK.
 *
 * Reads recent raw_posts from Supabase and creates seed topics
 * to ensure the homepage has >= 10 topics at launch.
 *
 * Usage: npx tsx scripts/seed-topics.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const MIN_TOPICS = 10;
const SEED_HEAT_BASE = 3000;

interface RawPostRow {
  id: string;
  platform: string;
  title: string;
  url: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string;
  processing_status: string;
}

interface TopicInsert {
  slug: string;
  title: string;
  heat_score: number;
  total_engagement: number;
  source_count: number;
  post_count: number;
  sentiment_positive: number;
  sentiment_negative: number;
  sentiment_neutral: number;
  sentiment_controversial: number;
  centroid_post_count: number;
  status: string;
  first_detected_at: string;
  last_updated_at: string;
  flags: string[];
  report_count: number;
  keywords: string[];
  platforms_json: Record<string, number>;
  summary_status: string;
  data_quality: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/-$/, "");
}

function computeEngagement(post: RawPostRow): number {
  return post.view_count + post.like_count * 10 + post.comment_count * 5;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Check current active topic count
  const { count: activeCount } = await supabase
    .from("topics")
    .select("id", { count: "exact", head: true })
    .in("status", ["emerging", "rising", "peak"])
    .is("canonical_id", null);

  console.log(`Current active topics: ${activeCount ?? 0}`);

  if ((activeCount ?? 0) >= MIN_TOPICS) {
    console.log(`Already have >= ${MIN_TOPICS} topics. No seeding needed.`);
    return;
  }

  const needed = MIN_TOPICS - (activeCount ?? 0);
  console.log(`Need to seed ${needed} more topics.`);

  // Fetch recent 48h raw_posts ordered by engagement
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: posts, error: postsError } = await supabase
    .from("raw_posts")
    .select("id, platform, title, url, view_count, like_count, comment_count, published_at, processing_status")
    .gt("published_at", cutoff)
    .order("view_count", { ascending: false })
    .limit(200);

  if (postsError || !posts || posts.length === 0) {
    console.error("No recent raw_posts found:", postsError?.message ?? "empty result");
    console.log("Cannot seed without raw data. Please run collectors first.");
    return;
  }

  console.log(`Found ${posts.length} recent raw_posts.`);

  // Group by simplified title (deduplicate similar posts)
  const groups: Map<string, RawPostRow[]> = new Map();
  for (const post of posts as RawPostRow[]) {
    // Simple grouping: first 20 chars of title (lowercase)
    const key = post.title.slice(0, 20).toLowerCase().trim();
    const group = groups.get(key) ?? [];
    group.push(post);
    groups.set(key, group);
  }

  // Sort groups by total engagement and pick top N
  const sortedGroups = Array.from(groups.entries())
    .map(([key, groupPosts]) => ({
      key,
      posts: groupPosts,
      totalEngagement: groupPosts.reduce((sum, p) => sum + computeEngagement(p), 0),
      platforms: new Set(groupPosts.map((p) => p.platform)),
    }))
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, needed);

  if (sortedGroups.length === 0) {
    console.log("No suitable post groups found for seeding.");
    return;
  }

  console.log(`Creating ${sortedGroups.length} seed topics...`);

  const topicsToInsert: TopicInsert[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < sortedGroups.length; i++) {
    const group = sortedGroups[i];
    const representativePost = group.posts[0];
    const title = representativePost.title;
    const slug = slugify(title) || `seed-topic-${i + 1}`;

    const platformCounts: Record<string, number> = {};
    for (const post of group.posts) {
      platformCounts[post.platform] = (platformCounts[post.platform] ?? 0) + 1;
    }

    // Heat score descending from SEED_HEAT_BASE
    const heatScore = Math.max(1000, SEED_HEAT_BASE - i * 200);

    topicsToInsert.push({
      slug,
      title,
      heat_score: heatScore,
      total_engagement: group.totalEngagement,
      source_count: group.platforms.size,
      post_count: group.posts.length,
      sentiment_positive: 0.33,
      sentiment_negative: 0.33,
      sentiment_neutral: 0.34,
      sentiment_controversial: 0,
      centroid_post_count: 0,
      status: "rising",
      first_detected_at: representativePost.published_at,
      last_updated_at: now,
      flags: [],
      report_count: 0,
      keywords: title.split(/\s+/).slice(0, 3),
      platforms_json: platformCounts,
      summary_status: "pending",
      data_quality: "seed",
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("topics")
    .insert(topicsToInsert)
    .select("id, slug, title, heat_score");

  if (insertError) {
    console.error("Failed to insert seed topics:", insertError.message);
    process.exit(1);
  }

  console.log(`Successfully seeded ${inserted?.length ?? 0} topics:`);
  for (const t of inserted ?? []) {
    console.log(`  - [${t.heat_score}] ${t.title} (/topic/${t.slug})`);
  }

  // Link posts to topics via topic_posts
  for (let i = 0; i < sortedGroups.length; i++) {
    const group = sortedGroups[i];
    const topic = inserted?.[i];
    if (!topic) continue;

    const topicPosts = group.posts.map((post) => ({
      topic_id: topic.id,
      post_id: post.id,
      similarity_score: null,
      assigned_method: "seed",
    }));

    const { error: linkError } = await supabase
      .from("topic_posts")
      .insert(topicPosts);

    if (linkError) {
      console.warn(`  Warning: Failed to link posts to topic "${topic.slug}":`, linkError.message);
    }
  }

  console.log("\nSeeding complete. Seed topics are marked with data_quality='seed'.");
  console.log("Remember: platform_daily_stats excludes seed data (WHERE data_quality != 'seed').");
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
