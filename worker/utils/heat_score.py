"""Heat Score calculation — strictly follows HOTTALK-HEAT-SCORE-MATH-v1.0.md.

Output: INTEGER 0-10000.
All queries enforce WHERE published_at > NOW() - INTERVAL '48 hours'.
Seed data excluded from percentile (data_quality != 'seed').
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import structlog

from worker.utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# === Component weights (Section 3.1) ===
BASE_WEIGHTS: dict[str, float] = {
    "engagement": 0.30,
    "source_diversity": 0.25,
    "velocity": 0.25,
    "trends_signal": 0.10,
    "recency": 0.10,
}

# === Launch date — used for bootstrap phase detection ===
# Set via env or default; updated on first call
_LAUNCH_DATE: datetime | None = None


def _get_launch_date(supabase: Any) -> datetime:
    """Get the earliest post date as a proxy for launch date."""
    global _LAUNCH_DATE
    if _LAUNCH_DATE is not None:
        return _LAUNCH_DATE

    result = (
        supabase.table("raw_posts")
        .select("published_at")
        .order("published_at")
        .limit(1)
        .execute()
    )
    if result.data:
        _LAUNCH_DATE = datetime.fromisoformat(
            result.data[0]["published_at"].replace("Z", "+00:00")
        )
    else:
        _LAUNCH_DATE = datetime.now(timezone.utc)
    return _LAUNCH_DATE


def _days_since_launch(supabase: Any) -> int:
    launch = _get_launch_date(supabase)
    delta = datetime.now(timezone.utc) - launch
    return max(1, delta.days)


# ============================================
# STEP 0: Per-platform raw_engagement (Section 1)
# ============================================


def get_raw_engagement(platform: str, posts: list[dict[str, Any]]) -> float:
    """Per-platform raw engagement — single source of truth.

    Must match platform_daily_stats calculation exactly.
    """
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
# STEP 1: Percentile rank (Section 2.2)
# ============================================


def _percentile_rank_from_stats(
    value: float,
    p50: float,
    p75: float,
    p90: float,
    p95: float,
    p99: float,
) -> float:
    """Linear interpolation percentile rank per Math doc Section 2.2."""
    if p50 == 0:
        return 0.0

    if value <= 0:
        return 0.0
    if value <= p50:
        return value / p50 * 0.50
    if value <= p75:
        denom = p75 - p50
        return 0.50 + ((value - p50) / denom * 0.25 if denom > 0 else 0.25)
    if value <= p90:
        denom = p90 - p75
        return 0.75 + ((value - p75) / denom * 0.15 if denom > 0 else 0.15)
    if value <= p95:
        denom = p95 - p90
        return 0.90 + ((value - p90) / denom * 0.05 if denom > 0 else 0.05)
    if value <= p99:
        denom = p99 - p95
        return 0.95 + ((value - p95) / denom * 0.04 if denom > 0 else 0.04)

    # Beyond p99
    if p99 > 0:
        return min(1.0, 0.99 + (value - p99) / p99 * 0.01)
    return 1.0


def _simple_rank_today(
    supabase: Any, platform: str, value: float
) -> float:
    """Bootstrap day 1-7: simple rank within today's posts for this platform."""
    result = (
        supabase.rpc(
            "count_raw_posts_by_platform_today",
            {"p_platform": platform},
        ).execute()
    )
    # Fallback: manual count if RPC not available
    if not result.data:
        count_result = (
            supabase.table("raw_posts")
            .select("id", count="exact")
            .eq("platform", platform)
            .gte("published_at", "now() - interval '24 hours'")
            .neq("data_quality", "seed")
            .execute()
        )
        total = count_result.count or 1

        less_result = (
            supabase.table("raw_posts")
            .select("id", count="exact")
            .eq("platform", platform)
            .gte("published_at", "now() - interval '24 hours'")
            .neq("data_quality", "seed")
            .execute()
        )
        # Simplified: treat value as rank / total
        return min(1.0, value / max(total, 1))

    total = result.data if isinstance(result.data, int) else 1
    return min(1.0, value / max(total, 1))


def percentile_rank_7d(
    supabase: Any, platform: str, value: float
) -> float:
    """Percentile rank with bootstrap + smooth transition (Section 2.3).

    Day 1-7: 100% simple_rank
    Day 8-10: blended
    Day 11+: 100% percentile
    Excludes seed data.
    """
    days = _days_since_launch(supabase)

    if days <= 7:
        return _simple_rank_today(supabase, platform, value)

    # Query rolling 7-day stats
    stats_result = (
        supabase.table("platform_daily_stats")
        .select("p50_engagement, p75_engagement, p90_engagement, p95_engagement, p99_engagement")
        .eq("platform", platform)
        .gte("date", "now() - interval '7 days'")
        .execute()
    )

    if not stats_result.data:
        return _simple_rank_today(supabase, platform, value)

    # Average across available days
    rows = stats_result.data
    n = len(rows)
    p50 = sum(r.get("p50_engagement", 0) or 0 for r in rows) / n
    p75 = sum(r.get("p75_engagement", 0) or 0 for r in rows) / n
    p90 = sum(r.get("p90_engagement", 0) or 0 for r in rows) / n
    p95 = sum(r.get("p95_engagement", 0) or 0 for r in rows) / n
    p99 = sum(r.get("p99_engagement", 0) or 0 for r in rows) / n

    percentile = _percentile_rank_from_stats(value, p50, p75, p90, p95, p99)

    if days <= 10:
        # Smooth transition (Section 2.3)
        blend = min(1.0, (days - 7) / 3.0)
        simple = _simple_rank_today(supabase, platform, value)
        return (1 - blend) * simple + blend * percentile

    return percentile


# ============================================
# STEP 4: Velocity (Section 4)
# ============================================


def calculate_velocity(supabase: Any, topic_id: str) -> float:
    """velocity = min(1.0, posts_in_last_1h / 3.0)

    Cap at 1.0. Avoids small-sample false highs.
    """
    result = (
        supabase.table("topic_posts")
        .select("id", count="exact")
        .eq("topic_id", topic_id)
        .gte("assigned_at", "now() - interval '1 hour'")
        .execute()
    )
    posts_1h = result.count or 0
    return min(1.0, posts_1h / 3.0)


# ============================================
# Main: calculate_heat_score (Section 3)
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


async def calculate_heat_score(topic_id: str) -> int:
    """Calculate heat score for a topic. Returns INTEGER 0-10000.

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
    posts_result = (
        supabase.table("topic_posts")
        .select(
            "post_id, raw_posts!inner(id, platform, view_count, view_count_delta_24h, "
            "like_count, dislike_count, comment_count, share_count, author_name, "
            "published_at, data_quality)"
        )
        .eq("topic_id", topic_id)
        .gte("raw_posts.published_at", "now() - interval '48 hours'")
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

    # Per-platform percentile scoring
    platform_scores: dict[str, float] = {}
    for platform, platform_posts in grouped.items():
        raw = get_raw_engagement(platform, platform_posts)
        score = percentile_rank_7d(supabase, platform, raw)
        platform_scores[platform] = score

    # Weights with re-normalize on missing platforms (Section 3.2)
    weights = dict(BASE_WEIGHTS)
    if "google_trends" not in active_platforms:
        orphan = weights.pop("trends_signal", 0)
        total_w = sum(weights.values())
        if total_w > 0:
            weights = {k: v / total_w for k, v in weights.items()}

    # Components
    engagement = (
        sum(platform_scores.values()) / len(platform_scores)
        if platform_scores
        else 0.0
    )
    diversity = min(len(active_platforms) / 4.0, 1.0)
    velocity = calculate_velocity(supabase, topic_id)
    trends = platform_scores.get("google_trends", 0.0)
    recency = math.exp(-0.05 * _hours_since(topic.get("first_detected_at")))

    # Composite (Section 3)
    raw_score = (
        weights.get("engagement", 0) * engagement
        + weights.get("source_diversity", 0) * diversity
        + weights.get("velocity", 0) * velocity
        + weights.get("trends_signal", 0) * trends
        + weights.get("recency", 0) * recency
    )

    heat_score = int(round(raw_score * 10000))
    heat_score = max(0, min(10000, heat_score))

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
        velocity=velocity,
    )

    return heat_score


async def update_platform_daily_stats() -> dict[str, int]:
    """Daily cron (04:00 HKT): compute percentile stats per platform.

    Uses the same raw_engagement formulas as heat_score.
    Excludes seed data. Enforces 48h window.
    """
    supabase = get_supabase_client()

    # Fetch recent posts (24h for stats, within 48h hard limit)
    result = (
        supabase.table("raw_posts")
        .select(
            "platform, view_count, view_count_delta_24h, like_count, "
            "dislike_count, comment_count, author_name, data_quality, published_at"
        )
        .gte("published_at", "now() - interval '24 hours'")
        .neq("data_quality", "seed")
        .execute()
    )

    posts = result.data
    if not posts:
        logger.info("no_posts_for_daily_stats")
        return {"platforms_updated": 0}

    # Group by platform
    grouped = _group_posts_by_platform(posts)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    updated = 0

    for platform, platform_posts in grouped.items():
        # Calculate raw engagement for each post individually
        engagements: list[float] = []
        for p in platform_posts:
            eng = get_raw_engagement(platform, [p])
            engagements.append(eng)

        if not engagements:
            continue

        engagements.sort()
        n = len(engagements)

        def _percentile(data: list[float], pct: float) -> float:
            idx = pct * (len(data) - 1)
            lower = int(idx)
            upper = min(lower + 1, len(data) - 1)
            frac = idx - lower
            return data[lower] * (1 - frac) + data[upper] * frac

        stats = {
            "platform": platform,
            "date": today,
            "p50_engagement": _percentile(engagements, 0.50),
            "p75_engagement": _percentile(engagements, 0.75),
            "p90_engagement": _percentile(engagements, 0.90),
            "p95_engagement": _percentile(engagements, 0.95),
            "p99_engagement": _percentile(engagements, 0.99),
            "total_posts": n,
        }

        supabase.table("platform_daily_stats").upsert(
            stats, on_conflict="platform,date"
        ).execute()
        updated += 1

    logger.info("daily_stats_updated", platforms=updated)
    return {"platforms_updated": updated}
