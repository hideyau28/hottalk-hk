import type { MetadataRoute } from "next";
import { createServerClient } from "@/lib/supabase";

const BASE_URL = "https://hottalk.hk";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "always",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date("2026-02-26"),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: new Date("2026-02-26"),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: new Date("2026-02-26"),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/report`,
      lastModified: new Date("2026-02-26"),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  const platformPages: MetadataRoute.Sitemap = [
    "youtube",
    "lihkg",
    "news",
    "google-trends",
  ].map((platform) => ({
    url: `${BASE_URL}/platform/${platform}`,
    lastModified: new Date(),
    changeFrequency: "hourly" as const,
    priority: 0.7,
  }));

  let topicPages: MetadataRoute.Sitemap = [];

  try {
    const supabase = createServerClient();
    const { data: topics } = await supabase
      .from("topics")
      .select("slug, last_updated_at")
      .in("status", ["emerging", "rising", "peak"])
      .is("canonical_id", null)
      .order("heat_score", { ascending: false })
      .limit(1000);

    if (topics) {
      topicPages = topics.map((topic) => ({
        url: `${BASE_URL}/topic/${topic.slug}`,
        lastModified: new Date(topic.last_updated_at),
        changeFrequency: "hourly" as const,
        priority: 0.8,
      }));
    }
  } catch {
    // Build-time: Supabase env vars may not be available
  }

  return [...staticPages, ...platformPages, ...topicPages];
}
