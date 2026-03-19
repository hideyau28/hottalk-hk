import { getServiceClient } from "../_shared/supabase-client.ts";
import { contentHash, errorResponse, jsonResponse } from "../_shared/utils.ts";

const TIMEOUT_MS = 120_000;
const LIHKG_API_BASE = "https://lihkg.com/api_v2/thread/hot";
const LIHKG_WEB_BASE = "https://lihkg.com";

// Degradation triggers
const L1_TO_L2_CONSECUTIVE_FAILURES = 3;
const L2_TO_L3_CONSECUTIVE_FAILURES = 3;

type DegradationLevel = "L1" | "L2" | "L3";

interface LihkgThread {
  thread_id: string;
  title: string;
  no_of_reply: number;
  like_count: number;
  dislike_count: number;
  user_nickname: string;
  user_id: string;
  create_time: number;
}

/**
 * Get degradation level from recent scrape_runs in DB.
 */
async function getDegradationLevel(
  supabase: ReturnType<typeof getServiceClient>
): Promise<DegradationLevel> {
  const { data } = await supabase
    .from("scrape_runs")
    .select("status, degradation_level")
    .eq("collector_name", "lihkg_collector")
    .order("started_at", { ascending: false })
    .limit(L1_TO_L2_CONSECUTIVE_FAILURES);

  if (!data || data.length === 0) return "L1";

  // Count consecutive failures
  let consecutiveFails = 0;
  for (const run of data) {
    if (run.status === "failed") consecutiveFails++;
    else break;
  }

  // Check last known degradation level
  const lastLevel = (data[0]?.degradation_level ?? "L1") as DegradationLevel;

  if (lastLevel === "L2" && consecutiveFails >= L2_TO_L3_CONSECUTIVE_FAILURES) {
    return "L3";
  }
  if (lastLevel === "L1" && consecutiveFails >= L1_TO_L2_CONSECUTIVE_FAILURES) {
    return "L2";
  }

  // If last run was success, reset to L1
  if (data[0]?.status === "success" || data[0]?.status === "degraded") {
    return "L1";
  }

  return lastLevel;
}

Deno.serve(async () => {
  const startTime = Date.now();
  const supabase = getServiceClient();

  const level = await getDegradationLevel(supabase);

  // Create scrape_run
  const { data: scrapeRun, error: scrapeErr } = await supabase
    .from("scrape_runs")
    .insert({
      collector_name: "lihkg_collector",
      platform: "lihkg",
      status: "running",
      degradation_level: level,
    })
    .select("id")
    .single();

  if (scrapeErr || !scrapeRun) {
    return errorResponse(`Failed to create scrape_run: ${scrapeErr?.message}`);
  }
  const runId = scrapeRun.id;

  try {
    let result: { threads: LihkgThread[]; statusCode: number; proxyUsed: string };

    if (level === "L3") {
      result = await fetchL3();
    } else {
      const proxyUrl = level === "L1"
        ? Deno.env.get("PROXY_A_URL")
        : Deno.env.get("PROXY_B_URL");
      result = await fetchApi(proxyUrl ?? null);
    }

    // Prepare and upsert rows
    const rows = await Promise.all(
      result.threads.map(async (t) => {
        const hash = await contentHash(t.title);
        return {
          platform: "lihkg",
          platform_id: `lihkg_${t.thread_id}`,
          title: t.title,
          url: `${LIHKG_WEB_BASE}/thread/${t.thread_id}`,
          author_name: t.user_nickname ?? null,
          author_id: t.user_id ?? null,
          like_count: t.like_count ?? 0,
          dislike_count: t.dislike_count ?? 0,
          comment_count: t.no_of_reply ?? 0,
          content_hash: hash,
          scrape_run_id: runId,
          processing_status: "pending",
          content_policy: "metadata_only",
          data_quality: level === "L3" ? "degraded" : "normal",
          published_at: t.create_time
            ? new Date(t.create_time * 1000).toISOString()
            : new Date().toISOString(),
          collected_at: new Date().toISOString(),
        };
      })
    );

    const { data: upserted, error: upsertErr } = await supabase
      .from("raw_posts")
      .upsert(rows, { onConflict: "platform,platform_id" })
      .select("id");

    if (upsertErr) {
      await finalizeScrapeRun(supabase, runId, startTime, {
        status: "partial",
        status_code: result.statusCode,
        posts_fetched: result.threads.length,
        posts_new: 0,
        proxy_id: result.proxyUsed,
        degradation_level: level,
        error_message: `Upsert error: ${upsertErr.message}`,
      });
      return errorResponse(`Upsert error: ${upsertErr.message}`);
    }

    await finalizeScrapeRun(supabase, runId, startTime, {
      status: level === "L3" ? "degraded" : "success",
      status_code: result.statusCode,
      posts_fetched: result.threads.length,
      posts_new: upserted?.length ?? 0,
      proxy_id: result.proxyUsed,
      degradation_level: level,
    });

    return jsonResponse({
      collector: "lihkg_collector",
      level,
      posts_fetched: result.threads.length,
      posts_new: upserted?.length ?? 0,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await finalizeScrapeRun(supabase, runId, startTime, {
      status: "failed",
      degradation_level: level,
      error_message: message.slice(0, 1000),
    });

    return errorResponse(message);
  }
});

async function fetchApi(
  proxyUrl: string | null,
): Promise<{ threads: LihkgThread[]; statusCode: number; proxyUsed: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const apiUrl = `${LIHKG_API_BASE}?cat_id=1&page=1&count=50`;

  const fetchOptions: RequestInit = {
    signal: controller.signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
      "Referer": "https://lihkg.com/",
    },
  };

  const targetUrl = proxyUrl
    ? `${proxyUrl}?url=${encodeURIComponent(apiUrl)}`
    : apiUrl;

  try {
    const resp = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`LIHKG API returned ${resp.status}`);
    }

    const data = await resp.json();
    const threads: LihkgThread[] = (data.response?.items ?? []).map((item: Record<string, unknown>) => ({
      thread_id: String(item.thread_id ?? ""),
      title: String(item.title ?? ""),
      no_of_reply: Number(item.no_of_reply ?? 0),
      like_count: Number(item.like_count ?? 0),
      dislike_count: Number(item.dislike_count ?? 0),
      user_nickname: String(item.user_nickname ?? ""),
      user_id: String(item.user_id ?? ""),
      create_time: Number(item.create_time ?? 0),
    }));

    return {
      threads,
      statusCode: resp.status,
      proxyUsed: proxyUrl ? hashProxy(proxyUrl) : "direct",
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function fetchL3(): Promise<{
  threads: LihkgThread[];
  statusCode: number;
  proxyUsed: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${LIHKG_WEB_BASE}/category/1`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html",
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`LIHKG HTML returned ${resp.status}`);
    }

    const html = await resp.text();
    const threads = parseL3Html(html);

    return { threads, statusCode: resp.status, proxyUsed: "direct_html" };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function parseL3Html(html: string): LihkgThread[] {
  const threads: LihkgThread[] = [];
  const threadRegex = /\/thread\/(\d+)\/page\/\d+[^"]*"[^>]*>([^<]+)</gi;
  let match;
  const seen = new Set<string>();

  while ((match = threadRegex.exec(html)) !== null) {
    const threadId = match[1];
    const title = match[2].trim();

    if (threadId && title && !seen.has(threadId)) {
      seen.add(threadId);
      threads.push({
        thread_id: threadId,
        title,
        no_of_reply: 0,
        like_count: 0,
        dislike_count: 0,
        user_nickname: "",
        user_id: "",
        create_time: Math.floor(Date.now() / 1000),
      });
    }
  }

  return threads;
}

function hashProxy(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `proxy_${Math.abs(hash).toString(16)}`;
}

async function finalizeScrapeRun(
  supabase: ReturnType<typeof getServiceClient>,
  runId: string,
  startTime: number,
  fields: Record<string, unknown>
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
