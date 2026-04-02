import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/verify-cron";

const WORKER_URL = process.env.WORKER_URL ?? "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const EDGE_FUNCTIONS = [
  "youtube-collector",
  "lihkg-collector",
  "news-collector",
];

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authError = await verifyCronRequest(request);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  if (!WORKER_URL) {
    return NextResponse.json(
      { error: "WORKER_URL is not configured." },
      { status: 503 },
    );
  }

  const results: Record<string, string> = {};

  // --- Phase 1: Collect (all in parallel) ---
  const collectTasks = [
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

  await Promise.allSettled(collectTasks);

  // --- Phase 2: Assign (after collect completes) ---
  try {
    const resp = await fetch(`${WORKER_URL}/jobs/incremental-assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!resp.ok) {
      const text = await resp.text();
      results["incremental-assign"] = `error:${resp.status}:${text.slice(0, 200)}`;
    } else {
      const data = await resp.json();
      results["incremental-assign"] = `ok:${data.posts_processed ?? 0}posts,${data.new_topics ?? 0}topics`;
    }
  } catch (e) {
    results["incremental-assign"] = `failed:${String(e)}`;
  }

  return NextResponse.json({ triggered: results });
}

// QStash sends POST requests
export async function POST(request: NextRequest) {
  return GET(request);
}
