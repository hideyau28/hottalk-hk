import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const WORKER_URL = process.env.WORKER_URL ?? "";

const EDGE_FUNCTIONS = [
  "youtube-collector",
  "lihkg-collector",
  "news-collector",
];

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // Trigger all 3 Edge Functions + Google Trends worker in parallel
  const tasks = [
    ...EDGE_FUNCTIONS.map(async (fn) => {
      try {
        const resp = await fetch(
          `${SUPABASE_URL}/functions/v1/${fn}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          }
        );
        results[fn] = resp.ok ? "ok" : `error:${resp.status}`;
      } catch (e) {
        results[fn] = `failed:${String(e)}`;
      }
    }),
    (async () => {
      try {
        const resp = await fetch(
          `${WORKER_URL}/jobs/collect-google-trends`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }
        );
        results["google-trends"] = resp.ok ? "ok" : `error:${resp.status}`;
      } catch (e) {
        results["google-trends"] = `failed:${String(e)}`;
      }
    })(),
  ];

  await Promise.allSettled(tasks);

  return NextResponse.json({ triggered: results });
}
