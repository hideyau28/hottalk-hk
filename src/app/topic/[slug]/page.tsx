import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createServerClient } from "@/lib/supabase";
import type { Topic, RawPost, TopicAlias } from "@/lib/types";
import { HeatIndicator } from "@/components/heat-indicator";
import { PlatformBadge } from "@/components/platform-badge";
import { SentimentBar } from "@/components/sentiment-bar";
import { ReportButton } from "@/components/report-button";
import { TimeAgo } from "@/components/time-ago";
import type { Platform } from "@/lib/types";

export const revalidate = 300;

interface TopicPageProps {
  params: Promise<{ slug: string }>;
}

async function getTopicBySlug(slug: string) {
  const supabase = createServerClient();

  // Check if slug is an alias first
  const { data: alias } = await supabase
    .from("topic_aliases")
    .select("topic_id")
    .eq("old_slug", slug)
    .single();

  if (alias) {
    // Get canonical topic to redirect
    const { data: canonical } = await supabase
      .from("topics")
      .select("slug")
      .eq("id", alias.topic_id)
      .single();

    if (canonical) {
      redirect(`/topic/${canonical.slug}`);
    }
  }

  const { data: topic, error } = await supabase
    .from("topics")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !topic) return null;
  return topic as Topic;
}

async function getTopicPosts(topicId: string) {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("topic_posts")
    .select("similarity_score, raw_posts(*)")
    .eq("topic_id", topicId)
    .order("assigned_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    ...(row.raw_posts as unknown as RawPost),
    similarity_score: row.similarity_score,
  }));
}

export async function generateStaticParams() {
  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from("topics")
      .select("slug")
      .in("status", ["emerging", "rising", "peak"])
      .order("heat_score", { ascending: false })
      .limit(50);

    return (data ?? []).map((t) => ({ slug: t.slug }));
  } catch {
    // Build-time: env vars may not be available
    return [];
  }
}

export async function generateMetadata({ params }: TopicPageProps): Promise<Metadata> {
  try {
    const { slug } = await params;
    const supabase = createServerClient();
    const { data: topic } = await supabase
      .from("topics")
      .select("title, summary, meta_description")
      .eq("slug", slug)
      .single();

    if (!topic) return {};

  const description = topic.meta_description ?? topic.summary?.slice(0, 160) ?? "";

  return {
    title: topic.title,
    description,
    openGraph: {
      title: topic.title,
      description,
      type: "article",
    },
    alternates: {
      canonical: `https://hottalk.hk/topic/${slug}`,
    },
  };
  } catch {
    return {};
  }
}

function parsePlatforms(platformsJson: Record<string, unknown>): { platform: Platform; count: number }[] {
  const results: { platform: Platform; count: number }[] = [];
  for (const [key, value] of Object.entries(platformsJson)) {
    if (typeof value === "number") {
      results.push({ platform: key as Platform, count: value });
    }
  }
  return results;
}

function groupByPlatform(posts: (RawPost & { similarity_score: number | null })[]) {
  const groups: Record<string, (RawPost & { similarity_score: number | null })[]> = {};
  for (const post of posts) {
    const key = post.platform;
    if (!groups[key]) groups[key] = [];
    groups[key].push(post);
  }
  return groups;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "📺 YouTube",
  lihkg: "💬 連登",
  news: "📰 新聞",
  google_trends: "🔍 Google Trends",
};

export default async function TopicPage({ params }: TopicPageProps) {
  const { slug } = await params;
  const topic = await getTopicBySlug(slug);

  if (!topic) notFound();

  const posts = await getTopicPosts(topic.id);
  const platforms = parsePlatforms(topic.platforms_json);
  const groupedPosts = groupByPlatform(posts);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: topic.title,
        datePublished: topic.first_detected_at,
        dateModified: topic.last_updated_at,
        description: topic.summary ?? "",
        author: { "@type": "Organization", name: "HotTalk HK" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首頁", item: "https://hottalk.hk" },
          { "@type": "ListItem", position: 2, name: topic.title, item: `https://hottalk.hk/topic/${slug}` },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-4 text-sm text-zinc-500">
        <a href="/" className="hover:underline">首頁</a>
        <span className="mx-1">/</span>
        <span>{topic.title}</span>
      </nav>

      <article>
        <h1 className="text-2xl font-bold leading-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          {topic.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <HeatIndicator score={topic.heat_score} />
          <span className="text-sm text-zinc-500">
            {topic.post_count} 篇來源
          </span>
          <TimeAgo date={topic.last_updated_at} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {platforms.map(({ platform, count }) => (
            <PlatformBadge key={platform} platform={platform} count={count} />
          ))}
        </div>

        {topic.summary && topic.summary_status !== "hidden" && (
          <div className="mt-6 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
            <h2 className="mb-2 text-sm font-semibold text-zinc-500">AI 摘要</h2>
            <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
              {topic.summary}
            </p>
          </div>
        )}

        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">輿論情緒</h2>
          <SentimentBar
            positive={topic.sentiment_positive}
            negative={topic.sentiment_negative}
            neutral={topic.sentiment_neutral}
          />
        </div>

        <div className="mt-4">
          <ReportButton topicId={topic.id} />
        </div>

        {/* Related Posts */}
        <section className="mt-8">
          <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50">
            相關文章
          </h2>

          {Object.entries(groupedPosts).map(([platform, platformPosts]) => (
            <div key={platform} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                {PLATFORM_LABELS[platform as Platform] ?? platform}
              </h3>
              <div className="flex flex-col gap-2">
                {platformPosts.map((post) => (
                  <a
                    key={post.id}
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {post.title}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                        {post.author_name && <span>{post.author_name}</span>}
                        <TimeAgo date={post.published_at} />
                        {post.view_count > 0 && (
                          <span>{post.view_count.toLocaleString()} 次觀看</span>
                        )}
                        {post.like_count > 0 && (
                          <span>👍 {post.like_count.toLocaleString()}</span>
                        )}
                        {post.comment_count > 0 && (
                          <span>💬 {post.comment_count.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    <PlatformBadge platform={post.platform} />
                  </a>
                ))}
              </div>
            </div>
          ))}

          {posts.length === 0 && (
            <p className="text-sm text-zinc-500">暫未有相關文章</p>
          )}
        </section>
      </article>
    </>
  );
}
