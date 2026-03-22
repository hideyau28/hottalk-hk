"""Topic status auto-transition — runs after every heat_score update.

Transition rules per HOTTALK-HEAT-SCORE-MATH-v1.0.md Section 6.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog

from utils.supabase_client import get_supabase_client

logger = structlog.get_logger()


def _hours_since(dt_str: str | None) -> float:
    if not dt_str:
        return 0.0
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    delta = datetime.now(timezone.utc) - dt
    return max(0.0, delta.total_seconds() / 3600)


def _get_percentile_threshold(supabase: Any, percentile: int) -> int:
    """Get the heat_score threshold at a given percentile of today's active topics."""
    result = (
        supabase.table("topics")
        .select("heat_score")
        .in_("status", ["emerging", "rising", "peak"])
        .gte("last_updated_at", "now() - interval '24 hours'")
        .order("heat_score")
        .execute()
    )

    scores = [r["heat_score"] for r in result.data if r.get("heat_score") is not None]
    if not scores:
        return 0

    idx = int(percentile / 100.0 * (len(scores) - 1))
    idx = max(0, min(idx, len(scores) - 1))
    return scores[idx]


async def update_topic_status(topic_id: str) -> str:
    """Evaluate and update topic status after heat_score changes.

    Returns the new (or unchanged) status.
    """
    supabase = get_supabase_client()

    topic_result = (
        supabase.table("topics")
        .select(
            "id, status, heat_score, post_count, source_count, "
            "first_detected_at, last_updated_at"
        )
        .eq("id", topic_id)
        .single()
        .execute()
    )
    topic = topic_result.data
    current_status: str = topic["status"]
    hours_alive = _hours_since(topic.get("first_detected_at"))
    hours_since_update = _hours_since(topic.get("last_updated_at"))
    post_count: int = topic.get("post_count", 0)
    source_count: int = topic.get("source_count", 0)
    heat_score: int = topic.get("heat_score", 0)

    # Calculate velocity inline (same formula as heat_score module)
    vel_result = (
        supabase.table("topic_posts")
        .select("id", count="exact")
        .eq("topic_id", topic_id)
        .gte("assigned_at", "now() - interval '1 hour'")
        .execute()
    )
    posts_1h = vel_result.count or 0
    velocity = min(1.0, posts_1h / 3.0)

    new_status = current_status

    # emerging → rising: enough engagement + cross-platform
    if current_status == "emerging":
        if post_count >= 5 and source_count >= 2:
            new_status = "rising"
        elif hours_alive > 6 and post_count < 3:
            new_status = "archive"

    # rising → peak or declining
    elif current_status == "rising":
        p90 = _get_percentile_threshold(supabase, 90)
        if heat_score >= p90 and p90 > 0:
            new_status = "peak"
        elif velocity < 0.2:
            new_status = "declining"

    # peak → declining
    elif current_status == "peak":
        p70 = _get_percentile_threshold(supabase, 70)
        if velocity < 0.5 or (heat_score < p70 and p70 > 0):
            new_status = "declining"

    # declining → archive: 72h no new posts
    elif current_status == "declining":
        if hours_since_update > 72:
            new_status = "archive"

    # Write back if changed
    if new_status != current_status:
        update_fields: dict[str, Any] = {"status": new_status}
        if new_status == "peak":
            update_fields["peak_at"] = datetime.now(timezone.utc).isoformat()

        supabase.table("topics").update(update_fields).eq("id", topic_id).execute()

        # Audit log
        supabase.table("audit_log").insert(
            {
                "entity_type": "topic",
                "entity_id": topic_id,
                "action": "status_change",
                "actor": "system",
                "details": {
                    "from": current_status,
                    "to": new_status,
                    "velocity": velocity,
                    "heat_score": heat_score,
                },
            }
        ).execute()

        logger.info(
            "topic_status_changed",
            topic_id=topic_id,
            from_status=current_status,
            to_status=new_status,
            velocity=velocity,
        )

    return new_status
