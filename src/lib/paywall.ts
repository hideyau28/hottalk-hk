/** Feature-based paywall gate — v3.2 preparation for M4.
 *
 * Free: all content visible (with ads) + daily brief top 5 titles
 * Pro:  full brief top 10 + AI summaries + no ads + history + sentiment trends
 */

export type UserTier = "free" | "pro";

export type Feature =
  | "daily_brief_basic" // Top 5 titles (Free)
  | "daily_brief_full" // Top 10 + AI summaries (Pro)
  | "ad_free" // No ads (Pro)
  | "history_access" // Historical data (Pro)
  | "sentiment_trends" // Sentiment trend charts (Pro)
  | "browse_topics"; // Browse all topics (Free)

const PRO_FEATURES: Set<Feature> = new Set([
  "daily_brief_full",
  "ad_free",
  "history_access",
  "sentiment_trends",
]);

export function isProFeature(feature: Feature): boolean {
  return PRO_FEATURES.has(feature);
}

export function hasAccess(feature: Feature, tier: UserTier): boolean {
  if (tier === "pro") return true;
  return !PRO_FEATURES.has(feature);
}
