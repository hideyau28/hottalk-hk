"""Daily Brief generation — v3.2 M1-3 (Free tier).

Generates a daily top-5 topics summary at 12:00 HKT.
Writes to daily_briefs table. Frontend reads and renders.

Pro tier (M4+): Top 10 + Claude Haiku AI summaries at 08:00 HKT — not yet implemented.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Any

import structlog

from utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# HKT = UTC+8
HKT = timezone(timedelta(hours=8))

TOP_N_FREE = 5


async def generate_daily_brief() -> dict[str, Any]:
    """Generate today's free-tier daily brief (Top 5 topics by heat_score).

    Returns stats dict.
    """
    supabase = get_supabase_client()

    # Today in HKT
    today_hkt = datetime.now(HKT).strftime("%Y-%m-%d")

    # Fetch top 5 active topics
    result = (
        supabase.table("topics")
        .select("title, slug, heat_score, platforms_json, status")
        .in_("status", ["emerging", "rising", "peak"])
        .is_("canonical_id", "null")
        .order("heat_score", desc=True)
        .limit(TOP_N_FREE)
        .execute()
    )

    topics = result.data
    if not topics:
        logger.warning("daily_brief_no_topics")
        return {"brief_date": today_hkt, "topics_count": 0}

    # Build content
    brief_topics: list[dict[str, Any]] = []
    for rank, topic in enumerate(topics, 1):
        platforms_json = topic.get("platforms_json", {})
        if isinstance(platforms_json, str):
            platforms_json = json.loads(platforms_json)
        platforms = list(platforms_json.keys()) if platforms_json else []

        brief_topics.append({
            "rank": rank,
            "title": topic["title"],
            "slug": topic["slug"],
            "heat_score": topic["heat_score"],
            "platforms": platforms,
        })

    content = {"topics": brief_topics}

    # Upsert into daily_briefs
    supabase.table("daily_briefs").upsert(
        {
            "brief_date": today_hkt,
            "tier": "free",
            "content": content,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="brief_date,tier",
    ).execute()

    logger.info(
        "daily_brief_generated",
        brief_date=today_hkt,
        tier="free",
        topics_count=len(brief_topics),
    )

    return {
        "brief_date": today_hkt,
        "tier": "free",
        "topics_count": len(brief_topics),
    }
