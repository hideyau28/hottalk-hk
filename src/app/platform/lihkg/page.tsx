import type { Metadata } from "next";
import { createServerClient } from "@/lib/supabase";
import type { RawPost } from "@/lib/types";
import { TimeAgo } from "@/components/time-ago";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "連登熱門帖文",
  description: "LIHKG 最近 48 小時最熱門帖文",
};

async function getLihkgPosts(): Promise<RawPost[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("raw_posts")
    .select("*")
    .eq("platform", "lihkg")
    .gt("published_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .order("comment_count", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to fetch LIHKG posts:", error);
    return [];
  }
  return data as RawPost[];
}

export default async function LihkgPage() {
  const posts = await getLihkgPosts();

  return (
    <>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        💬 連登熱門帖文
      </h1>
      <p className="mt-1 text-sm text-zinc-500">最近 48 小時最熱門帖文</p>

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
              className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {post.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {post.author_name && <span>{post.author_name}</span>}
                  <TimeAgo date={post.published_at} />
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-zinc-500">
                <span>💬 {post.comment_count.toLocaleString()}</span>
                {post.like_count > 0 && (
                  <span>
                    👍 {post.like_count.toLocaleString()}
                    {post.dislike_count > 0 && (
                      <> / 👎 {post.dislike_count.toLocaleString()}</>
                    )}
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
