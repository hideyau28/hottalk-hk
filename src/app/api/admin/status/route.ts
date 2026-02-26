import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { redis } from "@/lib/redis";

const LLM_COST_PER_TOKEN = 0.80 / 1_000_000;
const DAILY_TOKEN_CAP = 500_000;
const REDIS_TOKEN_KEY_PREFIX = "hottalk:llm_tokens";
const REDIS_LIHKG_LEVEL_KEY = "hottalk:lihkg:degradation_level";

const COLLECTORS = [
  "youtube_collector",
  "news_collector",
  "lihkg_collector",
  "google_trends_collector",
];

const JOBS = ["incremental_assign", "nightly_recluster", "summarize"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const db = createServerClient();
    const today = todayStr();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Scrape runs stats (last 24h) for each collector
    const { data: recentRuns } = await db
      .from("scrape_runs")
      .select("collector_name, status, started_at, completed_at, posts_fetched, posts_new, error_message, duration_ms, degradation_level")
      .gte("started_at", since24h)
      .order("started_at", { ascending: false });

    // Aggregate per collector
    const collectorStats: Record<
      string,
      { success: number; failed: number; partial: number; last_success: string | null; last_run: string | null }
    > = {};

    for (const name of [...COLLECTORS, ...JOBS]) {
      collectorStats[name] = { success: 0, failed: 0, partial: 0, last_success: null, last_run: null };
    }

    for (const run of recentRuns ?? []) {
      const name = run.collector_name;
      if (!collectorStats[name]) {
        collectorStats[name] = { success: 0, failed: 0, partial: 0, last_success: null, last_run: null };
      }
      const entry = collectorStats[name];

      if (run.status === "success") entry.success++;
      else if (run.status === "failed") entry.failed++;
      else if (run.status === "partial" || run.status === "degraded") entry.partial++;

      if (!entry.last_run) entry.last_run = run.started_at;
      if ((run.status === "success" || run.status === "degraded") && !entry.last_success) {
        entry.last_success = run.completed_at || run.started_at;
      }
    }

    // 2. Redis counters for today
    const redisCounters: Record<string, { ok: number; err: number }> = {};
    for (const name of [...COLLECTORS, ...JOBS]) {
      const [okVal, errVal] = await Promise.all([
        redis.get(`hottalk:ok:${name}:${today}`),
        redis.get(`hottalk:err:${name}:${today}`),
      ]);
      redisCounters[name] = {
        ok: Number(okVal) || 0,
        err: Number(errVal) || 0,
      };
    }

    // 3. LLM token usage
    const tokenVal = await redis.get(`${REDIS_TOKEN_KEY_PREFIX}:${today}`);
    const tokensUsed = Number(tokenVal) || 0;
    const estimatedCost = tokensUsed * LLM_COST_PER_TOKEN;

    // 4. LIHKG degradation level
    const lihkgLevel = (await redis.get(REDIS_LIHKG_LEVEL_KEY)) ?? "L1";

    return NextResponse.json({
      collectorStats,
      redisCounters,
      llm: {
        tokens_used: tokensUsed,
        token_cap: DAILY_TOKEN_CAP,
        estimated_cost_usd: Math.round(estimatedCost * 10000) / 10000,
        usage_pct: Math.round((tokensUsed / DAILY_TOKEN_CAP) * 100),
      },
      lihkg_degradation_level: lihkgLevel,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}
