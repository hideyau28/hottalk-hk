import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthServerClient, isAdminEmail } from "@/lib/supabase-auth";
import { createServerClient } from "@/lib/supabase";

const COLLECTORS = [
  "youtube_collector",
  "news_collector",
  "lihkg_collector",
  "google_trends_collector",
];

const JOBS = ["incremental_assign", "nightly_recluster", "summarize"];

export async function GET() {
  // Verify admin session before returning any data
  const cookieStore = await cookies();
  const supabase = createAuthServerClient({
    getAll() {
      return cookieStore.getAll();
    },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = createServerClient();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Scrape runs stats (last 24h)
    const { data: recentRuns } = await db
      .from("scrape_runs")
      .select(
        "collector_name, status, started_at, completed_at, posts_fetched, posts_new, error_message, duration_ms, degradation_level",
      )
      .gte("started_at", since24h)
      .order("started_at", { ascending: false });

    // Aggregate per collector
    const collectorStats: Record<
      string,
      {
        success: number;
        failed: number;
        partial: number;
        last_success: string | null;
        last_run: string | null;
      }
    > = {};

    for (const name of [...COLLECTORS, ...JOBS]) {
      collectorStats[name] = {
        success: 0,
        failed: 0,
        partial: 0,
        last_success: null,
        last_run: null,
      };
    }

    for (const run of recentRuns ?? []) {
      const name = run.collector_name;
      if (!collectorStats[name]) {
        collectorStats[name] = {
          success: 0,
          failed: 0,
          partial: 0,
          last_success: null,
          last_run: null,
        };
      }
      const entry = collectorStats[name];

      if (run.status === "success") entry.success++;
      else if (run.status === "failed") entry.failed++;
      else if (run.status === "partial" || run.status === "degraded")
        entry.partial++;

      if (!entry.last_run) entry.last_run = run.started_at;
      if (
        (run.status === "success" || run.status === "degraded") &&
        !entry.last_success
      ) {
        entry.last_success = run.completed_at || run.started_at;
      }
    }

    // LIHKG degradation: infer from last scrape_run
    const lihkgRuns = (recentRuns ?? []).filter(
      (r) => r.collector_name === "lihkg_collector",
    );
    const lihkgLevel = lihkgRuns[0]?.degradation_level ?? "L1";

    return NextResponse.json({
      collectorStats,
      lihkg_degradation_level: lihkgLevel,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
