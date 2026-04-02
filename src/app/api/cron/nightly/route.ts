import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/verify-cron";

const WORKER_URL = process.env.WORKER_URL ?? "";

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

  try {
    const resp = await fetch(`${WORKER_URL}/jobs/nightly-recluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `Worker returned ${resp.status}`, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }

    const result = await resp.json();
    return NextResponse.json({ status: "ok", result });
  } catch (e) {
    return NextResponse.json(
      { error: `Worker unreachable: ${String(e)}` },
      { status: 502 },
    );
  }
}
