import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase";
import type { Platform } from "@/lib/types";

export const runtime = "edge";

const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  lihkg: "LIHKG",
  news: "News",
  google_trends: "Google",
};

function getHeatLevel(score: number): { fires: number; label: string } {
  if (score >= 8000) return { fires: 5, label: "爆熱" };
  if (score >= 6000) return { fires: 4, label: "極熱" };
  if (score >= 4000) return { fires: 3, label: "高熱" };
  if (score >= 2000) return { fires: 2, label: "熱門" };
  return { fires: 1, label: "關注" };
}

function parsePlatformKeys(platformsJson: Record<string, unknown>): Platform[] {
  return Object.keys(platformsJson).filter(
    (k): k is Platform => k in PLATFORM_LABELS
  );
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("topic");

  // Default OG image (no topic specified)
  if (!slug) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #18181b 0%, #27272a 50%, #18181b 100%)",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ fontSize: 72, fontWeight: 700, color: "#fafafa", display: "flex" }}>
            熱話 HotTalk HK
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#a1a1aa",
              marginTop: 16,
              display: "flex",
            }}
          >
            一頁睇晒，全港熱話
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  // Fetch topic data
  let title = slug;
  let heatScore = 0;
  let platforms: Platform[] = [];

  try {
    const supabase = createServerClient();
    const { data: topic } = await supabase
      .from("topics")
      .select("title, heat_score, platforms_json")
      .eq("slug", slug)
      .single();

    if (topic) {
      title = topic.title;
      heatScore = topic.heat_score;
      platforms = parsePlatformKeys(topic.platforms_json as Record<string, unknown>);
    }
  } catch {
    // Fallback to slug as title
  }

  const heat = getHeatLevel(heatScore);
  const fireEmojis = Array(heat.fires).fill("🔥").join("");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #18181b 0%, #27272a 50%, #18181b 100%)",
          padding: 60,
          fontFamily: "sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 700, color: "#a1a1aa", display: "flex" }}>
            熱話 HotTalk HK
          </div>
          <div style={{ fontSize: 24, color: "#71717a", display: "flex" }}>hottalk.hk</div>
        </div>

        {/* Title */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: title.length > 20 ? 52 : 64,
              fontWeight: 700,
              color: "#fafafa",
              lineHeight: 1.2,
              display: "flex",
            }}
          >
            {title}
          </div>
        </div>

        {/* Bottom bar: heat + platforms */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 32, display: "flex" }}>{fireEmojis}</span>
            <span style={{ fontSize: 24, color: "#f97316", fontWeight: 700, display: "flex" }}>
              {heatScore.toLocaleString()}
            </span>
            <span style={{ fontSize: 20, color: "#a1a1aa", display: "flex" }}>{heat.label}</span>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {platforms.map((p) => (
              <div
                key={p}
                style={{
                  background: "#3f3f46",
                  borderRadius: 8,
                  padding: "6px 16px",
                  fontSize: 18,
                  color: "#d4d4d8",
                  display: "flex",
                }}
              >
                {PLATFORM_LABELS[p]}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    }
  );
}
