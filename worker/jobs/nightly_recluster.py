"""Nightly recluster — runs daily at 02:00 HKT via QStash.

v3.2: OFFLINE ANALYSIS ONLY.
- HDBSCAN clustering on 48h data
- Generates merge/new-topic suggestions → audit_log
- Does NOT write to topics, topic_posts, topic_aliases, or raw_posts
- Admin reviews suggestions and decides manually
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import hdbscan
import numpy as np
import structlog

from utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# HDBSCAN parameters
MIN_CLUSTER_SIZE = 3
MIN_SAMPLES = 2

# Reconciliation thresholds
OVERLAP_THRESHOLD = 0.70  # Jaccard overlap to consider same topic
COSINE_MERGE_THRESHOLD = 0.75  # Centroid similarity for merge candidates

# Minimum platform diversity for new cluster suggestions
MIN_PLATFORM_DIVERSITY = 2


def _hours_since(dt_str: str | None) -> float:
    if not dt_str:
        return 0.0
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    delta = datetime.now(timezone.utc) - dt
    return max(0.0, delta.total_seconds() / 3600)


def _jaccard_similarity(set_a: set[str], set_b: set[str]) -> float:
    if not set_a and not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    dot = np.dot(va, vb)
    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


async def run_nightly_recluster() -> dict[str, Any]:
    """Main entry point for the nightly recluster job.

    v3.2: Analysis only — generates suggestions, no production writes.
    """
    supabase = get_supabase_client()

    stats: dict[str, Any] = {
        "total_posts": 0,
        "clusters_found": 0,
        "noise_posts": 0,
        "merge_suggestions": 0,
        "new_cluster_suggestions": 0,
    }

    # === Step 1: Fetch all posts with embeddings in 48h window ===
    posts_result = (
        supabase.table("raw_posts")
        .select("id, platform, title, embedding, published_at")
        .not_("embedding", "is", "null")
        .gte("published_at", "now() - interval '48 hours'")
        .limit(5000)
        .execute()
    )

    posts = posts_result.data
    if not posts or len(posts) < MIN_CLUSTER_SIZE:
        logger.info("insufficient_posts_for_recluster", count=len(posts or []))
        return stats

    stats["total_posts"] = len(posts)
    logger.info("nightly_recluster_start", post_count=len(posts))

    # === Step 2: Build embedding matrix ===
    valid_posts: list[dict[str, Any]] = []
    embeddings: list[list[float]] = []
    for p in posts:
        emb = p.get("embedding")
        if emb and isinstance(emb, list) and len(emb) > 0:
            valid_posts.append(p)
            embeddings.append(emb)

    if len(valid_posts) < MIN_CLUSTER_SIZE:
        logger.info("insufficient_valid_embeddings", count=len(valid_posts))
        return stats

    X = np.array(embeddings, dtype=np.float64)

    # Normalize for cosine distance via euclidean on unit vectors
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X_normalized = X / norms

    # === Step 3: HDBSCAN clustering ===
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=MIN_CLUSTER_SIZE,
        min_samples=MIN_SAMPLES,
        metric="euclidean",
    )
    labels = clusterer.fit_predict(X_normalized)

    # Group posts by cluster label
    cluster_map: dict[int, list[dict[str, Any]]] = {}
    for idx, label in enumerate(labels):
        if label == -1:
            stats["noise_posts"] += 1
            continue
        cluster_map.setdefault(label, []).append(valid_posts[idx])

    stats["clusters_found"] = len(cluster_map)
    logger.info(
        "hdbscan_complete",
        clusters=len(cluster_map),
        noise=stats["noise_posts"],
    )

    # === Step 4: Fetch existing topics for comparison ===
    existing_topics_result = (
        supabase.table("topics")
        .select(
            "id, slug, centroid, centroid_post_count, heat_score, status, "
            "first_detected_at, last_updated_at, post_count"
        )
        .not_("status", "eq", "archive")
        .execute()
    )
    existing_topics = existing_topics_result.data

    # Build post-set for each existing topic
    topic_post_sets: dict[str, set[str]] = {}
    for topic in existing_topics:
        tp_result = (
            supabase.table("topic_posts")
            .select("post_id")
            .eq("topic_id", topic["id"])
            .execute()
        )
        topic_post_sets[topic["id"]] = {r["post_id"] for r in tp_result.data}

    # === Step 5: Match clusters to existing topics (read-only) ===
    cluster_to_topic: dict[int, str] = {}  # cluster_label -> matched topic_id
    processed_topics: set[str] = set()

    for cluster_label, cluster_posts in cluster_map.items():
        cluster_post_ids = {p["id"] for p in cluster_posts}

        # Find best matching existing topic by Jaccard overlap
        best_topic_id: str | None = None
        best_overlap = 0.0

        for topic in existing_topics:
            if topic["id"] in processed_topics:
                continue
            topic_posts_set = topic_post_sets.get(topic["id"], set())
            overlap = _jaccard_similarity(cluster_post_ids, topic_posts_set)
            if overlap > best_overlap:
                best_overlap = overlap
                best_topic_id = topic["id"]

        if best_topic_id and best_overlap >= OVERLAP_THRESHOLD:
            cluster_to_topic[cluster_label] = best_topic_id
            processed_topics.add(best_topic_id)
        else:
            # New cluster not matching any existing topic — log suggestion
            cluster_platforms = set(p["platform"] for p in cluster_posts)
            if (
                len(cluster_posts) >= MIN_CLUSTER_SIZE
                and len(cluster_platforms) >= MIN_PLATFORM_DIVERSITY
            ):
                sample_titles = [p.get("title", "") for p in cluster_posts[:5]]
                try:
                    supabase.table("audit_log").insert(
                        {
                            "entity_type": "cluster",
                            "entity_id": f"cluster-{cluster_label}",
                            "action": "new_topic_suggestion",
                            "actor": "system",
                            "details": {
                                "suggestion_type": "new_topic",
                                "post_count": len(cluster_posts),
                                "platforms": list(cluster_platforms),
                                "sample_titles": sample_titles,
                            },
                        }
                    ).execute()
                    stats["new_cluster_suggestions"] += 1
                except Exception as e:
                    logger.error("audit_log_insert_failed", error=str(e))

    # === Step 6: Check for merge suggestions among existing topics ===
    for topic in existing_topics:
        if topic["id"] in processed_topics:
            continue

        topic_centroid = topic.get("centroid")
        if not topic_centroid:
            continue

        for assigned_topic_id in set(cluster_to_topic.values()):
            assigned_topic = next(
                (t for t in existing_topics if t["id"] == assigned_topic_id), None
            )
            if not assigned_topic or not assigned_topic.get("centroid"):
                continue

            sim = _cosine_similarity(topic_centroid, assigned_topic["centroid"])
            if sim >= COSINE_MERGE_THRESHOLD:
                # Log merge suggestion — admin decides
                try:
                    supabase.table("audit_log").insert(
                        {
                            "entity_type": "topic",
                            "entity_id": topic["id"],
                            "action": "merge_suggestion",
                            "actor": "system",
                            "details": {
                                "suggestion_type": "merge",
                                "topic_a_id": topic["id"],
                                "topic_a_slug": topic.get("slug", ""),
                                "topic_b_id": assigned_topic_id,
                                "topic_b_slug": assigned_topic.get("slug", ""),
                                "cosine_similarity": round(sim, 4),
                            },
                        }
                    ).execute()
                    stats["merge_suggestions"] += 1
                except Exception as e:
                    logger.error("audit_log_insert_failed", error=str(e))

                logger.info(
                    "merge_suggestion_logged",
                    topic_a=topic["id"],
                    topic_b=assigned_topic_id,
                    similarity=round(sim, 4),
                )
                processed_topics.add(topic["id"])
                break

    # === Step 7: Quality metrics ===
    if stats["clusters_found"] > 0:
        intra_sims: list[float] = []
        for cluster_label, cluster_posts in cluster_map.items():
            embeds = [p["embedding"] for p in cluster_posts if p.get("embedding")]
            if len(embeds) < 2:
                continue
            centroid = np.mean(np.array(embeds, dtype=np.float64), axis=0).tolist()
            for e in embeds:
                intra_sims.append(_cosine_similarity(e, centroid))

        stats["avg_intra_cluster_similarity"] = (
            round(float(np.mean(intra_sims)), 4) if intra_sims else 0.0
        )

    logger.info("nightly_recluster_complete", **stats)
    return stats
