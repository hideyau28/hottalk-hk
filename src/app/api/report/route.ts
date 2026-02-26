import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { reportRatelimit } from "@/lib/redis";
import crypto from "crypto";

const VALID_REASONS = [
  "AI 摘要不準確",
  "話題合併錯誤",
  "包含個人私隱",
  "包含不當內容",
  "其他",
] as const;

interface ReportBody {
  topic_id: string;
  reason: string;
  details?: string;
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    // Rate limit check
    const { success } = await reportRatelimit.limit(ip);
    if (!success) {
      return NextResponse.json(
        { error: "請求過於頻繁，請稍後再試" },
        { status: 429 }
      );
    }

    const body: ReportBody = await request.json();

    // Validate required fields
    if (!body.topic_id || !body.reason) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate reason
    if (!VALID_REASONS.includes(body.reason as (typeof VALID_REASONS)[number])) {
      return NextResponse.json(
        { error: "Invalid reason" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const hashedIp = hashIp(ip);

    // Insert report
    const { error: insertError } = await supabase
      .from("content_reports")
      .insert({
        topic_id: body.topic_id,
        reason: body.reason,
        details: body.details ?? null,
        reporter_ip: hashedIp,
        status: "pending",
      });

    if (insertError) {
      console.error("Failed to insert report:", insertError);
      return NextResponse.json(
        { error: "Failed to submit report" },
        { status: 500 }
      );
    }

    // Increment report_count on topic
    const { data: topic, error: fetchError } = await supabase
      .from("topics")
      .select("report_count")
      .eq("id", body.topic_id)
      .single();

    if (fetchError || !topic) {
      // Report was inserted, but topic not found — still return success
      return NextResponse.json({ success: true });
    }

    const newCount = (topic.report_count ?? 0) + 1;

    // Build update based on report count thresholds
    const updates: Record<string, unknown> = { report_count: newCount };

    if (newCount >= 5) {
      updates.status = "archive";
      // Add 'reported' flag via RPC or raw SQL since array_append isn't in PostgREST
    } else if (newCount >= 3) {
      updates.summary_status = "hidden";
    }

    await supabase.from("topics").update(updates).eq("id", body.topic_id);

    // If count >= 5, add 'reported' flag
    if (newCount >= 5) {
      try {
        await supabase.rpc("array_append_flag", {
          topic_id_input: body.topic_id,
          flag_value: "reported",
        });
      } catch {
        // Fallback: flags update via raw query — will be handled by admin
        console.warn("Could not append reported flag, RPC may not exist yet");
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Report API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
