import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/verify-cron";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const WORKER_URL = process.env.WORKER_URL ?? "";

const EDGE_FUNCTIONS = [
  "youtube-collector",
  "lihkg-collector",
  "news-collector",
];

export async function GET(request: NextRequest) {
  const authError = await verifyCronRequest(request);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  if (!WORKER_URL) {
    return NextResponse.json(
      {
        error:
          "WORKER_URL is not configured. Set this env var in your deployment.",
      },
      { status: 503 },
    );
  }

  const results: Record<string, string> = {};

  // Trigger all 3 Edge Functions + Google Trends worker in parallel
  const tasks = [
    ...EDGE_FUNCTIONS.map(async (fn) => {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        results[fn] = resp.ok ? "ok" : `error:${resp.status}`;
      } catch (e) {
        results[fn] = `failed:${String(e)}`;
      }
    }),
    (async () => {
      try {
        const resp = await fetch(`${WORKER_URL}/jobs/collect-google-trends`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        results["google-trends"] = resp.ok ? "ok" : `error:${resp.status}`;
      } catch (e) {
        results["google-trends"] = `failed:${String(e)}`;
      }
    })(),
  ];

  await Promise.allSettled(tasks);

  return NextResponse.json({ triggered: results });
}
