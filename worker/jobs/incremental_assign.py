"""Incremental topic assignment — runs every 10 minutes via QStash.

Flow:
1. Batch embed pending posts (Task 2)
2. Fetch newly embedded posts (48h window)
3. Fetch top 300 active topic centroids
4. Cosine similarity matching → assign or create new topics
5. Update heat scores + status transitions + trigger summarization
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import structlog

from jobs.summarize import summarize_topics
from utils.embedding import batch_embed_pending_posts
from utils.heat_score import calculate_heat_score
from utils.supabase_client import get_supabase_client
from utils.topic_status import update_topic_status

logger = structlog.get_logger()

COSINE_THRESHOLD = 0.80

def _parse_vector(v: Any) -> list[float] | None:
    """Parse a vector value that may be a list or a JSON string from Supabase."""
    if v is None:
        return None
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        return json.loads(v)
    return None
TOP_ACTIVE_TOPICS_LIMIT = 300
MIN_CLUSTER_SIZE = 3
MIN_PLATFORM_DIVERSITY = 2
CENTROID_FULL_RECOMPUTE_INTERVAL = 20


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    dot = np.dot(va, vb)
    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def _hours_since(dt_str: str | None) -> float:
    if not dt_str:
        return 0.0
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    delta = datetime.now(timezone.utc) - dt
    return max(0.0, delta.total_seconds() / 3600)


def _days_since(dt_str: str | None) -> float:
    return _hours_since(dt_str) / 24.0


def _should_force_new_topic(topic: dict[str, Any]) -> bool:
    """Cross-time event protection (Section 5 of Math doc).

    If topic is stale (>72h since update) AND old (>7 days since creation),
    force new topic even if cosine similarity matches.
    """
    return (
        _hours_since(topic.get("last_updated_at")) > 72
        and _days_since(topic.get("first_detected_at")) > 7
    )


def _incremental_centroid_update(
    old_centroid: list[float],
    old_count: int,
    new_embedding: list[float],
) -> list[float]:
    """Incremental centroid: new = (old * n + new) / (n + 1)."""
    old = np.array(old_centroid, dtype=np.float64)
    new = np.array(new_embedding, dtype=np.float64)
    updated = (old * old_count + new) / (old_count + 1)
    return updated.tolist()


def _full_recompute_centroid(embeddings: list[list[float]]) -> list[float]:
    """Full centroid recompute: mean of all embeddings."""
    if not embeddings:
        return [0.0] * 1536
    arr = np.array(embeddings, dtype=np.float64)
    return np.mean(arr, axis=0).tolist()


def _greedy_cluster(
    posts: list[dict[str, Any]], threshold: float
) -> list[list[dict[str, Any]]]:
    """Greedy clustering on unassigned posts by cosine similarity."""
    if not posts:
        return []

    assigned = [False] * len(posts)
    clusters: list[list[dict[str, Any]]] = []

    for i in range(len(posts)):
        if assigned[i]:
            continue
        cluster = [posts[i]]
        assigned[i] = True

        for j in range(i + 1, len(posts)):
            if assigned[j]:
                continue
            sim = _cosine_similarity(
                posts[i]["embedding"], posts[j]["embedding"]
            )
            if sim >= threshold:
                cluster.append(posts[j])
                assigned[j] = True

        clusters.append(cluster)

    return clusters


async def run_incremental_assign() -> dict[str, Any]:
    """Main entry point for the incremental assignment job.

    Called every 10 minutes by QStash webhook.
    """
    supabase = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    stats: dict[str, Any] = {
        "embed_stats": {},
        "posts_processed": 0,
        "assigned_existing": 0,
        "new_topics": 0,
        "unassigned": 0,
        "topics_summarized": [],
    }

    # === Step 1: Embed pending posts ===
    embed_stats = await batch_embed_pending_posts()
    stats["embed_stats"] = embed_stats

    # === Step 2: Fetch newly embedded posts (48h window) ===
    cutoff_48h = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    embedded_result = (
        supabase.table("raw_posts")
        .select("id, platform, title, description, embedding, published_at")
        .eq("processing_status", "embedded")
        .gte("published_at", cutoff_48h)
        .limit(500)
        .execute()
    )

    new_posts = embedded_result.data
    # Pre-parse vector strings from Supabase into native lists
    for p in new_posts:
        p["embedding"] = _parse_vector(p.get("embedding"))
    if not new_posts:
        logger.info("no_embedded_posts_to_assign")
        return stats

    stats["posts_processed"] = len(new_posts)
    logger.info("incremental_assign_start", post_count=len(new_posts))

    # === Step 3: Fetch top 300 active topics ===
    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    topics_result = (
        supabase.table("topics")
        .select(
            "id, centroid, centroid_post_count, heat_score, status, "
            "first_detected_at, last_updated_at, post_count, source_count"
        )
        .in_("status", ["emerging", "rising", "peak"])
        .gte("last_updated_at", cutoff_24h)
        .order("heat_score", desc=True)
        .limit(TOP_ACTIVE_TOPICS_LIMIT)
        .execute()
    )

    active_topics = topics_result.data

    # === Step 4-6: Match each post to best topic ===
    assigned_posts: list[tuple[str, str, float]] = []  # (post_id, topic_id, sim)
    unassigned_posts: list[dict[str, Any]] = []
    topics_to_update: set[str] = set()
    topics_needing_summary: list[str] = []

    # Track new posts per topic for summary trigger
    new_posts_per_topic: dict[str, int] = {}

    for post in new_posts:
        post_embedding = post.get("embedding")
        if not post_embedding:
            unassigned_posts.append(post)
            continue

        best_topic_id: str | None = None
        best_sim = 0.0

        for topic in active_topics:
            centroid = _parse_vector(topic.get("centroid"))
            if not centroid:
                continue

            # Cross-time event protection
            if _should_force_new_topic(topic):
                continue

            sim = _cosine_similarity(post_embedding, centroid)
            if sim > best_sim:
                best_sim = sim
                best_topic_id = topic["id"]

        if best_topic_id and best_sim >= COSINE_THRESHOLD:
            # Assign to existing topic
            assigned_posts.append((post["id"], best_topic_id, best_sim))
            topics_to_update.add(best_topic_id)
            new_posts_per_topic[best_topic_id] = (
                new_posts_per_topic.get(best_topic_id, 0) + 1
            )
        else:
            unassigned_posts.append(post)

    # Write assignments to topic_posts
    for post_id, topic_id, sim in assigned_posts:
        try:
            supabase.table("topic_posts").upsert(
                {
                    "topic_id": topic_id,
                    "post_id": post_id,
                    "similarity_score": round(sim, 4),
                    "assigned_method": "incremental",
                },
                on_conflict="topic_id,post_id",
            ).execute()

            supabase.table("raw_posts").update(
                {"processing_status": "assigned"}
            ).eq("id", post_id).execute()
        except Exception as e:
            logger.error(
                "assignment_write_failed",
                post_id=post_id,
                topic_id=topic_id,
                error=str(e),
            )

    stats["assigned_existing"] = len(assigned_posts)

    # === Centroid updates for affected topics ===
    for topic in active_topics:
        tid = topic["id"]
        if tid not in topics_to_update:
            continue

        old_count = topic.get("centroid_post_count", 0)
        old_centroid = _parse_vector(topic.get("centroid"))
        if not old_centroid:
            continue

        # Get newly assigned post embeddings for this topic
        new_embeds = [
            p["embedding"]
            for p_id, t_id, _ in assigned_posts
            if t_id == tid
            for p in new_posts
            if p["id"] == p_id and p.get("embedding")
        ]

        new_count = old_count
        new_centroid = old_centroid
        for emb in new_embeds:
            new_centroid = _incremental_centroid_update(new_centroid, new_count, emb)
            new_count += 1

        # Full recompute every 20 posts
        if new_count > 0 and new_count % CENTROID_FULL_RECOMPUTE_INTERVAL == 0:
            all_embeds_result = (
                supabase.table("topic_posts")
                .select("raw_posts!inner(embedding)")
                .eq("topic_id", tid)
                .execute()
            )
            all_embeds = [
                parsed
                for r in all_embeds_result.data
                if r.get("raw_posts") and r["raw_posts"].get("embedding")
                for parsed in [_parse_vector(r["raw_posts"]["embedding"])]
                if parsed is not None
            ]
            if all_embeds:
                new_centroid = _full_recompute_centroid(all_embeds)
                logger.info("centroid_full_recompute", topic_id=tid, post_count=new_count)

        supabase.table("topics").update(
            {
                "centroid": new_centroid,
                "centroid_post_count": new_count,
            }
        ).eq("id", tid).execute()

    # === Step 7-8: Cluster unassigned posts → potential new topics ===
    valid_unassigned = [p for p in unassigned_posts if p.get("embedding")]
    clusters = _greedy_cluster(valid_unassigned, COSINE_THRESHOLD)

    for cluster in clusters:
        platforms = set(p["platform"] for p in cluster)
        cluster_size = len(cluster)

        # Check new topic conditions
        is_news_trends = "news" in platforms and "google_trends" in platforms
        meets_standard = (
            cluster_size >= MIN_CLUSTER_SIZE
            and len(platforms) >= MIN_PLATFORM_DIVERSITY
        )
        meets_exception = is_news_trends and cluster_size >= 2

        if not (meets_standard or meets_exception):
            # Leave as 'embedded' for next cycle
            continue

        # Create new topic
        topic_id = str(uuid.uuid4())
        temp_slug = f"temp-{topic_id[:8]}"
        centroid = _full_recompute_centroid(
            [p["embedding"] for p in cluster if p.get("embedding")]
        )
        first_title = cluster[0].get("title", "未命名話題")

        supabase.table("topics").insert(
            {
                "id": topic_id,
                "slug": temp_slug,
                "title": first_title,
                "status": "emerging",
                "heat_score": 0,
                "post_count": cluster_size,
                "source_count": len(platforms),
                "centroid": centroid,
                "centroid_post_count": cluster_size,
                "platforms_json": json.dumps(
                    {p: sum(1 for x in cluster if x["platform"] == p) for p in platforms}
                ),
            }
        ).execute()

        # Assign posts to new topic
        for post in cluster:
            sim = _cosine_similarity(post["embedding"], centroid) if post.get("embedding") else 0.0
            supabase.table("topic_posts").insert(
                {
                    "topic_id": topic_id,
                    "post_id": post["id"],
                    "similarity_score": round(sim, 4),
                    "assigned_method": "incremental",
                }
            ).execute()

            supabase.table("raw_posts").update(
                {"processing_status": "assigned"}
            ).eq("id", post["id"]).execute()

        topics_to_update.add(topic_id)
        topics_needing_summary.append(topic_id)
        stats["new_topics"] += 1

        logger.info(
            "new_topic_created",
            topic_id=topic_id,
            post_count=cluster_size,
            platforms=list(platforms),
        )

    # Count remaining unassigned
    stats["unassigned"] = sum(
        1
        for c in clusters
        if len(c) < MIN_CLUSTER_SIZE
        or len(set(p["platform"] for p in c)) < MIN_PLATFORM_DIVERSITY
    ) + len([p for p in unassigned_posts if not p.get("embedding")])

    # === Step 9-10: Update heat scores + status for all affected topics ===
    for topic_id in topics_to_update:
        try:
            # Update topic metadata
            tp_result = (
                supabase.table("topic_posts")
                .select("post_id, raw_posts!inner(platform)")
                .eq("topic_id", topic_id)
                .execute()
            )
            if tp_result.data:
                platforms = set(
                    r["raw_posts"]["platform"]
                    for r in tp_result.data
                    if r.get("raw_posts")
                )
                post_count = len(tp_result.data)
                supabase.table("topics").update(
                    {
                        "post_count": post_count,
                        "source_count": len(platforms),
                        "platforms_json": json.dumps(
                            {
                                p: sum(
                                    1
                                    for r in tp_result.data
                                    if r.get("raw_posts", {}).get("platform") == p
                                )
                                for p in platforms
                            }
                        ),
                        "last_updated_at": now_iso,
                    }
                ).eq("id", topic_id).execute()

            await calculate_heat_score(topic_id)
            await update_topic_status(topic_id)
        except Exception as e:
            logger.error(
                "topic_update_failed", topic_id=topic_id, error=str(e)
            )

    # === Step 11: Trigger summarization ===
    # New topics always need summary
    # Existing topics with ≥5 new posts need re-summary
    for tid, count in new_posts_per_topic.items():
        if count >= 5 and tid not in topics_needing_summary:
            topics_needing_summary.append(tid)

    if topics_needing_summary:
        try:
            summary_stats = await summarize_topics(topics_needing_summary)
            stats["topics_summarized"] = topics_needing_summary
            logger.info("summarization_triggered", topic_count=len(topics_needing_summary))
        except Exception as e:
            logger.error("summarization_failed", error=str(e))

    logger.info("incremental_assign_complete", **{k: v for k, v in stats.items() if k != "topics_summarized"})
    return stats
