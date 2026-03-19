import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const WORKER_URL = process.env.WORKER_URL ?? "";

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const resp = await fetch(`${WORKER_URL}/jobs/incremental-assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `Worker returned ${resp.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      );
    }

    const result = await resp.json();
    return NextResponse.json({ status: "ok", result });
  } catch (e) {
    return NextResponse.json(
      { error: `Worker unreachable: ${String(e)}` },
      { status: 502 }
    );
  }
}
