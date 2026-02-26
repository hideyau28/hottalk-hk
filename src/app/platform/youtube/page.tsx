import type { Metadata } from "next";
import Image from "next/image";
import { createServerClient } from "@/lib/supabase";
import type { RawPost } from "@/lib/types";
import { TimeAgo } from "@/components/time-ago";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "YouTube 熱門影片",
  description: "香港 YouTube 最近 48 小時最熱門影片",
};

async function getYoutubePosts(): Promise<RawPost[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("raw_posts")
    .select("*")
    .eq("platform", "youtube")
    .gt("published_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .order("view_count", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to fetch YouTube posts:", error);
    return [];
  }
  return data as RawPost[];
}

export default async function YouTubePage() {
  const posts = await getYoutubePosts();

  return (
    <>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        📺 YouTube 熱門影片
      </h1>
      <p className="mt-1 text-sm text-zinc-500">最近 48 小時最熱門影片</p>

      {posts.length === 0 ? (
        <p className="mt-8 text-center text-zinc-500">暫無資料</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {posts.map((post) => (
            <a
              key={post.id}
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="overflow-hidden rounded-lg border border-zinc-200 transition-shadow hover:shadow-md dark:border-zinc-800"
            >
              {post.thumbnail_url && (
                <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-800">
                  <Image
                    src={post.thumbnail_url}
                    alt={post.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 50vw"
                  />
                </div>
              )}
              <div className="p-3">
                <p className="line-clamp-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {post.title}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {post.author_name && <span>{post.author_name}</span>}
                  <span>{post.view_count.toLocaleString()} 次觀看</span>
                  {post.like_count > 0 && (
                    <span>👍 {post.like_count.toLocaleString()}</span>
                  )}
                  <TimeAgo date={post.published_at} />
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
