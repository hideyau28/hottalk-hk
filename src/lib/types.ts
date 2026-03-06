/** Platform identifiers */
export type Platform = "youtube" | "lihkg" | "news" | "google_trends";

/** Processing status for raw_posts */
export type ProcessingStatus = "pending" | "embedded" | "assigned" | "noise";

/** Data quality levels */
export type DataQuality = "normal" | "degraded" | "no_ai" | "seed";

/** Topic lifecycle status */
export type TopicStatus = "emerging" | "rising" | "peak" | "declining" | "archive";

/** Summary generation status */
export type SummaryStatus = "pending" | "generated" | "failed" | "hidden";

/** Scrape run status */
export type ScrapeRunStatus = "running" | "success" | "partial" | "failed" | "degraded";

/** LIHKG degradation levels */
export type DegradationLevel = "L1" | "L2" | "L3";

/** Content report status */
export type ReportStatus = "pending" | "reviewed" | "actioned" | "dismissed";

/** Audit log actions */
export type AuditAction =
  | "merge"
  | "split"
  | "hide"
  | "restore"
  | "assign"
  | "manual_review"
  | "merge_suggestion"
  | "new_topic_suggestion";

// --- Database row types ---

export interface RawPost {
  id: string;
  platform: Platform;
  platform_id: string;
  title: string;
  description: string | null;
  url: string;
  canonical_url: string | null;
  content_hash: string | null;
  thumbnail_url: string | null;
  author_name: string | null;
  author_id: string | null;
  view_count: number;
  view_count_delta_24h: number;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  share_count: number;
  embedding: number[] | null;
  normalized_text: string | null;
  processing_status: ProcessingStatus;
  scrape_run_id: string | null;
  content_policy: string;
  data_quality: DataQuality;
  published_at: string;
  collected_at: string;
}

export interface Topic {
  id: string;
  slug: string;
  canonical_id: string | null;
  title: string;
  summary: string | null;
  summary_status: SummaryStatus;
  heat_score: number; // INTEGER 0-10000
  total_engagement: number;
  source_count: number;
  post_count: number;
  sentiment_positive: number;
  sentiment_negative: number;
  sentiment_neutral: number;
  sentiment_controversial: number;
  centroid: number[] | null;
  centroid_post_count: number;
  status: TopicStatus;
  first_detected_at: string;
  peak_at: string | null;
  last_updated_at: string;
  flags: string[];
  report_count: number;
  keywords: string[] | null;
  meta_description: string | null;
  platforms_json: Record<string, unknown>;
  created_at: string;
}

export interface TopicPost {
  id: string;
  topic_id: string;
  post_id: string;
  similarity_score: number | null;
  assigned_method: string;
  assigned_at: string;
}

export interface TopicAlias {
  id: string;
  old_slug: string;
  topic_id: string;
  created_at: string;
}

export interface TopicHistory {
  id: string;
  topic_id: string;
  heat_score: number; // INTEGER
  post_count: number;
  engagement: number;
  snapshot_at: string;
}

export interface ScrapeRun {
  id: string;
  collector_name: string;
  collector_version: string;
  platform: Platform;
  status: ScrapeRunStatus;
  status_code: number | null;
  posts_fetched: number;
  posts_new: number;
  proxy_id: string | null;
  degradation_level: DegradationLevel;
  error_message: string | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface NewsSource {
  id: string;
  name: string;
  name_en: string | null;
  rss_url: string;
  logo_url: string | null;
  language: string;
  trust_weight: number;
  is_active: boolean;
  priority: number;
}

export interface Entity {
  id: string;
  canonical: string;
  aliases: string[];
  category: string | null;
  created_at: string;
}

export interface PlatformDailyStats {
  id: string;
  platform: Platform;
  date: string;
  p50_engagement: number | null;
  p75_engagement: number | null;
  p90_engagement: number | null;
  p95_engagement: number | null;
  p99_engagement: number | null;
  total_posts: number | null;
}

export interface ContentReport {
  id: string;
  topic_id: string | null;
  post_id: string | null;
  reason: string;
  details: string | null;
  reporter_ip: string | null;
  status: ReportStatus;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: AuditAction;
  actor: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface DailyBrief {
  id: string;
  brief_date: string;
  tier: "free" | "pro";
  content: {
    topics: Array<{
      rank: number;
      title: string;
      slug: string;
      heat_score: number;
      platforms: string[];
    }>;
  };
  generated_at: string;
}

export interface SensitiveKeyword {
  id: string;
  keyword: string;
  action: string;
  is_active: boolean;
}
