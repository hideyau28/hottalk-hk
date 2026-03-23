"""Heat Score calculation — v3.2 simplified weighted formula.

Output: INTEGER 0-10000.
All queries enforce WHERE published_at > NOW() - INTERVAL '48 hours'.

Formula:
    engagement (50%) + diversity (20%) + recency (20%) + trends_signal (10%)
    engagement = mean(log_scaled_per_platform)  # min(1.0, log1p(raw) / 10.0)
    diversity  = min(platforms / 3, 1.0)
    recency    = exp(-0.05 * hours)
    trends     = min(1.0, log1p(raw) / 10.0) if google_trends present, else 0.0
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog

from utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# === v3.2 Component weights ===
WEIGHTS: dict[str, float] = {
    "engagement": 0.50,
    "diversity": 0.20,
    "recency": 0.20,
    "trends_signal": 0.10,
}


# ============================================
# Per-platform raw_engagement
# ============================================


def get_raw_engagement(platform: str, posts: list[dict[str, Any]]) -> float:
    """Per-platform raw engagement — single source of truth."""
    if platform == "youtube":
        return float(sum(p.get("view_count_delta_24h", 0) or 0 for p in posts))

    if platform == "lihkg":
        return float(
            sum(
                ((p.get("like_count", 0) or 0) - (p.get("dislike_count", 0) or 0))
                + (p.get("comment_count", 0) or 0)
                for p in posts
            )
        )

    if platform == "news":
        # trust_weight is joined from news_sources via author_name
        return float(sum(p.get("trust_weight", 1.0) or 1.0 for p in posts))

    if platform == "google_trends":
        values = [p.get("view_count", 0) or 0 for p in posts]
        return float(max(values)) if values else 0.0

    return 0.0


# ============================================
# Helpers
# ============================================


def _group_posts_by_platform(
    posts: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for p in posts:
        platform = p["platform"]
        groups.setdefault(platform, []).append(p)
    return groups


def _hours_since(dt_str: str | None) -> float:
    if not dt_str:
        return 0.0
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    delta = datetime.now(timezone.utc) - dt
    return max(0.0, delta.total_seconds() / 3600)


# ============================================
# Main: calculate_heat_score (v3.2)
# ============================================


async def calculate_heat_score(topic_id: str) -> int:
    """Calculate heat score for a topic. Returns INTEGER 0-10000.

    v3.2 simplified formula — no percentile, no bootstrap, no velocity.
    Writes back to topics.heat_score and inserts topic_history snapshot.
    """
    supabase = get_supabase_client()

    # Fetch topic metadata
    topic_result = (
        supabase.table("topics")
        .select("id, first_detected_at, status")
        .eq("id", topic_id)
        .single()
        .execute()
    )
    topic = topic_result.data

    # Fetch topic's posts within 48h (mandatory WHERE)
    cutoff_48h = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    posts_result = (
        supabase.table("topic_posts")
        .select(
            "post_id, raw_posts!inner(id, platform, view_count, view_count_delta_24h, "
            "like_count, dislike_count, comment_count, share_count, author_name, "
            "published_at, data_quality)"
        )
        .eq("topic_id", topic_id)
        .gte("raw_posts.published_at", cutoff_48h)
        .execute()
    )

    # Flatten joined posts
    posts: list[dict[str, Any]] = []
    for row in posts_result.data:
        rp = row.get("raw_posts")
        if rp:
            # For news posts, look up trust_weight
            if rp.get("platform") == "news" and rp.get("author_name"):
                ns_result = (
                    supabase.table("news_sources")
                    .select("trust_weight")
                    .eq("name", rp["author_name"])
                    .limit(1)
                    .execute()
                )
                if ns_result.data:
                    rp["trust_weight"] = ns_result.data[0]["trust_weight"]
                else:
                    rp["trust_weight"] = 1.0
            posts.append(rp)

    if not posts:
        return 0

    # Group by platform
    grouped = _group_posts_by_platform(posts)
    active_platforms = list(grouped.keys())

    # === engagement: mean of log-scaled per-platform ===
    platform_log_scores: list[float] = []
    for platform, platform_posts in grouped.items():
        raw = get_raw_engagement(platform, platform_posts)
        log_scaled = min(1.0, math.log1p(raw) / 10.0)
        platform_log_scores.append(log_scaled)

    engagement = (
        sum(platform_log_scores) / len(platform_log_scores)
        if platform_log_scores
        else 0.0
    )

    # === diversity: min(platforms / 3, 1.0) ===
    diversity = min(len(active_platforms) / 3.0, 1.0)

    # === recency: exp(-0.05 * hours_since_newest_post) ===
    newest_published = max(
        (p.get("published_at", "") for p in posts),
        default="",
    )
    recency = math.exp(-0.05 * _hours_since(newest_published))

    # === trends_signal: log-scaled google_trends if present, else 0.0 ===
    if "google_trends" in grouped:
        raw_trends = get_raw_engagement("google_trends", grouped["google_trends"])
        trends_signal = min(1.0, math.log1p(raw_trends) / 10.0)
    else:
        trends_signal = 0.0

    # === Composite score ===
    raw_score = (
        WEIGHTS["engagement"] * engagement
        + WEIGHTS["diversity"] * diversity
        + WEIGHTS["recency"] * recency
        + WEIGHTS["trends_signal"] * trends_signal
    )

    heat_score = max(0, min(10000, int(raw_score * 10000)))

    # Write back
    total_engagement = int(
        sum(get_raw_engagement(p, grouped[p]) for p in grouped)
    )
    supabase.table("topics").update(
        {
            "heat_score": heat_score,
            "total_engagement": total_engagement,
            "last_updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", topic_id).execute()

    # Insert history snapshot
    supabase.table("topic_history").insert(
        {
            "topic_id": topic_id,
            "heat_score": heat_score,
            "post_count": len(posts),
            "engagement": total_engagement,
        }
    ).execute()

    logger.info(
        "heat_score_calculated",
        topic_id=topic_id,
        heat_score=heat_score,
        platforms=active_platforms,
        engagement=round(engagement, 4),
        diversity=round(diversity, 4),
        recency=round(recency, 4),
        trends_signal=round(trends_signal, 4),
    )

    return heat_score
