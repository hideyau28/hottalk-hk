import { getServiceClient } from "../_shared/supabase-client.ts";
import { verifyQStashSignature } from "../_shared/qstash-verify.ts";
import { contentHash, errorResponse, jsonResponse } from "../_shared/utils.ts";

// --- Constants ---
const TIMEOUT_MS = 120_000;
const LIHKG_API_BASE = "https://lihkg.com/api_v2/thread/hot";
const LIHKG_WEB_BASE = "https://lihkg.com";

// Degradation triggers
const L1_TO_L2_CONSECUTIVE_FAILURES = 3; // 連續 3 次 403/429
const L1_TO_L2_CONSECUTIVE_TIMEOUTS = 2; // 連續 2 次 timeout
const L2_TO_L3_CONSECUTIVE_FAILURES = 3; // proxy B 亦連續 3 次失敗

// Frequency control (ms)
const L2_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const L3_INTERVAL_MS = 60 * 60 * 1000; // 60 min

// Redis keys
const REDIS_LEVEL_KEY = "hottalk:lihkg:degradation_level";
const REDIS_FAILURES_KEY = "hottalk:lihkg:consecutive_failures";
const REDIS_LAST_L2_KEY = "hottalk:lihkg:last_l2_fetch";
const REDIS_LAST_L3_KEY = "hottalk:lihkg:last_l3_fetch";

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

interface RedisClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  incr: (key: string) => Promise<number>;
}

async function getRedisClient(): Promise<RedisClient> {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) throw new Error("Missing Upstash Redis config");

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function command(...args: string[]): Promise<unknown> {
    const resp = await fetch(`${url}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    });
    const data = await resp.json();
    return data.result;
  }

  return {
    get: async (key: string) => (await command("GET", key)) as string | null,
    set: async (key: string, value: string) => { await command("SET", key, value); },
    incr: async (key: string) => Number(await command("INCR", key)),
  };
}

Deno.serve(async (req: Request) => {
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    return errorResponse("Unauthorized", 401);
  }

  const startTime = Date.now();
  const supabase = getServiceClient();

  let redis: RedisClient;
  try {
    redis = await getRedisClient();
  } catch (err) {
    return errorResponse(`Redis init failed: ${err}`);
  }

  // Determine current degradation level
  const level = ((await redis.get(REDIS_LEVEL_KEY)) ?? "L1") as DegradationLevel;

  // Check frequency throttle for L2/L3
  if (level === "L2") {
    const lastFetch = await redis.get(REDIS_LAST_L2_KEY);
    if (lastFetch && Date.now() - Number(lastFetch) < L2_INTERVAL_MS) {
      return jsonResponse({ collector: "lihkg_collector", status: "skipped", reason: "L2 throttle" });
    }
  }
  if (level === "L3") {
    const lastFetch = await redis.get(REDIS_LAST_L3_KEY);
    if (lastFetch && Date.now() - Number(lastFetch) < L3_INTERVAL_MS) {
      return jsonResponse({ collector: "lihkg_collector", status: "skipped", reason: "L3 throttle" });
    }
  }

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
      result = await fetchApi(proxyUrl ?? null, level);
    }

    // Success → reset degradation
    await redis.set(REDIS_LEVEL_KEY, "L1");
    await redis.set(REDIS_FAILURES_KEY, "0");

    // Update throttle timestamp
    if (level === "L2") await redis.set(REDIS_LAST_L2_KEY, String(Date.now()));
    if (level === "L3") await redis.set(REDIS_LAST_L3_KEY, String(Date.now()));

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
    const isBlockError = message.includes("403") || message.includes("429");
    const isTimeout = message.includes("abort") || message.includes("timeout");

    // Increment failure counter
    const failures = await redis.incr(REDIS_FAILURES_KEY);

    // Determine degradation transition
    if (level === "L1") {
      if ((isBlockError && failures >= L1_TO_L2_CONSECUTIVE_FAILURES) ||
          (isTimeout && failures >= L1_TO_L2_CONSECUTIVE_TIMEOUTS)) {
        await redis.set(REDIS_LEVEL_KEY, "L2");
        await redis.set(REDIS_FAILURES_KEY, "0");
      }
    } else if (level === "L2") {
      if (failures >= L2_TO_L3_CONSECUTIVE_FAILURES) {
        await redis.set(REDIS_LEVEL_KEY, "L3");
        await redis.set(REDIS_FAILURES_KEY, "0");
      }
    }
    // L3 failure: stay at L3, just log

    const statusCode = isBlockError ? (message.includes("403") ? 403 : 429) : undefined;

    await finalizeScrapeRun(supabase, runId, startTime, {
      status: "failed",
      status_code: statusCode,
      degradation_level: level,
      error_message: message.slice(0, 1000),
    });

    return errorResponse(message);
  }
});

async function fetchApi(
  proxyUrl: string | null,
  level: DegradationLevel
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

  // If proxy is configured, route through it
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
  // L3: simple HTTP fetch of hot list page, parse titles + thread IDs
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

  // Extract thread links and titles from HTML
  // Pattern: /thread/{threadId}/page/1 with title text
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
  // Simple hash for proxy tracking (唔暴露完整 URL)
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
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
