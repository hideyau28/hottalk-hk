import { getServiceClient } from "../_shared/supabase-client.ts";
import {
  contentHash,
  normalizeTitle,
  errorResponse,
  jsonResponse,
} from "../_shared/utils.ts";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_RESULTS = 50;
const TIMEOUT_MS = 120_000;

interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    channelId: string;
    publishedAt: string;
    thumbnails: { high?: { url: string } };
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface YouTubeResponse {
  items: YouTubeVideo[];
}

interface YouTubeChannel {
  id: string;
  snippet: { country?: string };
}

interface YouTubeChannelsResponse {
  items: YouTubeChannel[];
}

/** Batch-fetch channel countries. channels.list accepts up to 50 IDs. */
async function fetchHKChannelIds(
  channelIds: string[],
  apiKey: string,
): Promise<Set<string>> {
  const hkChannels = new Set<string>();
  // Batch in chunks of 50 (YouTube API limit)
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const url = `${YOUTUBE_API_BASE}/channels?part=snippet&id=${batch.join(",")}&key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const data: YouTubeChannelsResponse = await resp.json();
    for (const ch of data.items ?? []) {
      if (ch.snippet.country === "HK") {
        hkChannels.add(ch.id);
      }
    }
  }
  return hkChannels;
}

Deno.serve(async () => {
  const startTime = Date.now();
  const supabase = getServiceClient();
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    return errorResponse("Missing YOUTUBE_API_KEY");
  }

  // Create scrape_run record
  const { data: scrapeRun, error: scrapeErr } = await supabase
    .from("scrape_runs")
    .insert({
      collector_name: "youtube_collector",
      platform: "youtube",
      status: "running",
    })
    .select("id")
    .single();

  if (scrapeErr || !scrapeRun) {
    return errorResponse(`Failed to create scrape_run: ${scrapeErr?.message}`);
  }

  const runId = scrapeRun.id;

  try {
    // Fetch YouTube trending with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const url = `${YOUTUBE_API_BASE}/videos?chart=mostPopular&regionCode=HK&maxResults=${MAX_RESULTS}&part=snippet,statistics&key=${apiKey}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.text();
      await finalizeScrapeRun(supabase, runId, startTime, {
        status: "failed",
        status_code: resp.status,
        error_message: `YouTube API error: ${resp.status} ${body.slice(0, 500)}`,
      });
      return errorResponse(`YouTube API error: ${resp.status}`, 502);
    }

    const data: YouTubeResponse = await resp.json();
    const allVideos = data.items ?? [];

    // Filter: only keep videos from HK channels
    const uniqueChannelIds = [
      ...new Set(allVideos.map((v) => v.snippet.channelId)),
    ];
    const hkChannelIds = await fetchHKChannelIds(uniqueChannelIds, apiKey);
    const videos = allVideos.filter((v) =>
      hkChannelIds.has(v.snippet.channelId),
    );

    // Fetch previous view counts for delta calculation
    const platformIds = videos.map((v) => `yt_${v.id}`);
    const { data: existingPosts } = await supabase
      .from("raw_posts")
      .select("platform_id, view_count")
      .eq("platform", "youtube")
      .in("platform_id", platformIds);

    const prevViewCounts = new Map<string, number>();
    if (existingPosts) {
      for (const p of existingPosts) {
        prevViewCounts.set(p.platform_id, Number(p.view_count) || 0);
      }
    }

    // Prepare rows for upsert
    const rows = await Promise.all(
      videos.map(async (v) => {
        const platformId = `yt_${v.id}`;
        const currentViews = Number(v.statistics.viewCount) || 0;
        const prevViews = prevViewCounts.get(platformId) ?? 0;
        const delta = prevViews > 0 ? currentViews - prevViews : currentViews;
        const hash = await contentHash(v.snippet.title);

        return {
          platform: "youtube",
          platform_id: platformId,
          title: v.snippet.title,
          description: (v.snippet.description ?? "").slice(0, 200),
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail_url: v.snippet.thumbnails?.high?.url ?? null,
          author_name: v.snippet.channelTitle,
          author_id: v.snippet.channelId,
          view_count: currentViews,
          view_count_delta_24h: Math.max(0, delta),
          like_count: Number(v.statistics.likeCount) || 0,
          comment_count: Number(v.statistics.commentCount) || 0,
          content_hash: hash,
          scrape_run_id: runId,
          processing_status: "pending",
          content_policy: "metadata_only",
          data_quality: "normal",
          published_at: v.snippet.publishedAt,
          collected_at: new Date().toISOString(),
        };
      }),
    );

    // Upsert raw_posts
    const { data: upserted, error: upsertErr } = await supabase
      .from("raw_posts")
      .upsert(rows, { onConflict: "platform,platform_id" })
      .select("id");

    if (upsertErr) {
      await finalizeScrapeRun(supabase, runId, startTime, {
        status: "failed",
        error_message: `Upsert error: ${upsertErr.message}`,
        posts_fetched: videos.length,
      });
      return errorResponse(`Upsert error: ${upsertErr.message}`);
    }

    const postsNew = (upserted?.length ?? 0) - prevViewCounts.size;

    await finalizeScrapeRun(supabase, runId, startTime, {
      status: "success",
      status_code: 200,
      posts_fetched: videos.length,
      posts_new: Math.max(0, postsNew),
    });

    return jsonResponse({
      collector: "youtube_collector",
      trending_total: allVideos.length,
      hk_channels: hkChannelIds.size,
      posts_fetched: videos.length,
      posts_new: Math.max(0, postsNew),
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeScrapeRun(supabase, runId, startTime, {
      status: "failed",
      error_message: message.slice(0, 1000),
    });
    return errorResponse(message);
  }
});

async function finalizeScrapeRun(
  supabase: ReturnType<typeof getServiceClient>,
  runId: string,
  startTime: number,
  fields: Record<string, unknown>,
) {
  await supabase
    .from("scrape_runs")
    .update({
      ...fields,
      duration_ms: Date.now() - startTime,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}
