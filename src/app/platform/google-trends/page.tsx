import type { Metadata } from "next";
import { createServerClient } from "@/lib/supabase";
import type { RawPost } from "@/lib/types";
import { TimeAgo } from "@/components/time-ago";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Google 搜尋趨勢",
  description: "香港 Google Trends 最近 48 小時搜尋趨勢",
};

async function getGoogleTrendsPosts(): Promise<RawPost[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("raw_posts")
    .select("*")
    .eq("platform", "google_trends")
    .gt("published_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .order("view_count", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to fetch Google Trends posts:", error);
    return [];
  }
  return data as RawPost[];
}

export default async function GoogleTrendsPage() {
  const posts = await getGoogleTrendsPosts();

  return (
    <>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        🔍 Google 搜尋趨勢
      </h1>
      <p className="mt-1 text-sm text-zinc-500">最近 48 小時香港搜尋趨勢</p>

      {posts.length === 0 ? (
        <p className="mt-8 text-center text-zinc-500">暫無資料</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {posts.map((post) => (
            <a
              key={post.id}
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {post.title}
                </p>
                <div className="mt-1 text-xs text-zinc-500">
                  <TimeAgo date={post.published_at} />
                </div>
              </div>
              {post.view_count > 0 && (
                <span className="shrink-0 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  {post.view_count.toLocaleString()}+ 搜尋量
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
