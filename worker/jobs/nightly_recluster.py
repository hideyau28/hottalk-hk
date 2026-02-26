"""Nightly recluster — runs daily at 02:00 HKT via QStash.

Full HDBSCAN batch clustering on 48h data, followed by
topic reconciliation (merge/split) with SEO stability gates.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import hdbscan
import numpy as np
import structlog

from worker.jobs.summarize import summarize_topics
from worker.utils.heat_score import calculate_heat_score
from worker.utils.supabase_client import get_supabase_client
from worker.utils.topic_status import update_topic_status

logger = structlog.get_logger()

# HDBSCAN parameters
MIN_CLUSTER_SIZE = 3
MIN_SAMPLES = 2

# Reconciliation thresholds
OVERLAP_THRESHOLD = 0.70  # Jaccard overlap to consider same topic
COSINE_MERGE_THRESHOLD = 0.75  # Centroid similarity for merge candidates


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
    """Main entry point for the nightly recluster job."""
    supabase = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    stats: dict[str, Any] = {
        "total_posts": 0,
        "clusters_found": 0,
        "noise_posts": 0,
        "merges": 0,
        "splits": 0,
        "new_topics": 0,
        "topics_updated": 0,
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
        logger.info("insufficient_posts_for_recluster", count=len(posts))
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

    # === Step 4: Fetch existing topics for reconciliation ===
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

    # === Reconciliation ===
    cluster_to_topic: dict[int, str] = {}  # cluster_label → matched topic_id
    topics_needing_summary: list[str] = []
    topics_to_update: set[str] = set()
    processed_topics: set[str] = set()

    for cluster_label, cluster_posts in cluster_map.items():
        cluster_post_ids = {p["id"] for p in cluster_posts}
        cluster_platforms = set(p["platform"] for p in cluster_posts)

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
            # Match to existing topic — keep slug
            cluster_to_topic[cluster_label] = best_topic_id
            processed_topics.add(best_topic_id)
            topics_to_update.add(best_topic_id)
        else:
            # Check if this cluster should become a new topic
            if (
                len(cluster_posts) >= MIN_CLUSTER_SIZE
                and len(cluster_platforms) >= 2
            ):
                topic_id = str(uuid.uuid4())
                temp_slug = f"temp-{topic_id[:8]}"
                cluster_embeddings = [
                    p["embedding"]
                    for p in cluster_posts
                    if p.get("embedding")
                ]
                centroid = (
                    np.mean(np.array(cluster_embeddings, dtype=np.float64), axis=0).tolist()
                    if cluster_embeddings
                    else [0.0] * 1536
                )

                supabase.table("topics").insert(
                    {
                        "id": topic_id,
                        "slug": temp_slug,
                        "title": cluster_posts[0].get("title", "未命名話題"),
                        "status": "emerging",
                        "heat_score": 0,
                        "post_count": len(cluster_posts),
                        "source_count": len(cluster_platforms),
                        "centroid": centroid,
                        "centroid_post_count": len(cluster_posts),
                        "platforms_json": json.dumps(
                            {
                                p: sum(1 for x in cluster_posts if x["platform"] == p)
                                for p in cluster_platforms
                            }
                        ),
                    }
                ).execute()

                cluster_to_topic[cluster_label] = topic_id
                topics_needing_summary.append(topic_id)
                topics_to_update.add(topic_id)
                stats["new_topics"] += 1

    # === Check for merges: unprocessed existing topics that overlap with matched clusters ===
    for topic in existing_topics:
        if topic["id"] in processed_topics:
            continue

        topic_centroid = topic.get("centroid")
        if not topic_centroid:
            continue

        topic_age_hours = _hours_since(topic.get("first_detected_at"))

        # Check if this topic should merge into a matched topic
        for assigned_topic_id in set(cluster_to_topic.values()):
            assigned_topic = next(
                (t for t in existing_topics if t["id"] == assigned_topic_id), None
            )
            if not assigned_topic or not assigned_topic.get("centroid"):
                continue

            sim = _cosine_similarity(topic_centroid, assigned_topic["centroid"])
            if sim >= COSINE_MERGE_THRESHOLD:
                # Merge: lower heat_score topic → canonical_id = higher heat_score topic
                if (topic.get("heat_score", 0) or 0) <= (
                    assigned_topic.get("heat_score", 0) or 0
                ):
                    canonical_id = assigned_topic_id
                    merged_id = topic["id"]
                else:
                    canonical_id = topic["id"]
                    merged_id = assigned_topic_id

                # SEO: create alias for merged slug
                merged_topic = next(
                    (t for t in existing_topics if t["id"] == merged_id), None
                )
                if merged_topic and merged_topic.get("slug"):
                    try:
                        supabase.table("topic_aliases").insert(
                            {
                                "old_slug": merged_topic["slug"],
                                "topic_id": canonical_id,
                            }
                        ).execute()
                    except Exception:
                        pass  # Duplicate alias

                supabase.table("topics").update(
                    {"canonical_id": canonical_id, "status": "archive"}
                ).eq("id", merged_id).execute()

                # Move posts from merged → canonical
                supabase.table("topic_posts").update(
                    {"topic_id": canonical_id, "assigned_method": "recluster"}
                ).eq("topic_id", merged_id).execute()

                # Audit log
                supabase.table("audit_log").insert(
                    {
                        "entity_type": "topic",
                        "entity_id": merged_id,
                        "action": "merge",
                        "actor": "system",
                        "details": {
                            "canonical_id": canonical_id,
                            "cosine_similarity": round(sim, 4),
                        },
                    }
                ).execute()

                topics_to_update.add(canonical_id)
                if canonical_id not in topics_needing_summary:
                    topics_needing_summary.append(canonical_id)
                stats["merges"] += 1
                processed_topics.add(topic["id"])
                logger.info(
                    "topics_merged",
                    merged=merged_id,
                    canonical=canonical_id,
                    similarity=round(sim, 4),
                )
                break

    # === Reassign posts for matched clusters ===
    for cluster_label, cluster_posts in cluster_map.items():
        topic_id = cluster_to_topic.get(cluster_label)
        if not topic_id:
            continue

        for post in cluster_posts:
            emb = post.get("embedding")
            topic_data = next(
                (t for t in existing_topics if t["id"] == topic_id), None
            )
            centroid = topic_data.get("centroid") if topic_data else None
            sim = _cosine_similarity(emb, centroid) if emb and centroid else 0.0

            try:
                supabase.table("topic_posts").upsert(
                    {
                        "topic_id": topic_id,
                        "post_id": post["id"],
                        "similarity_score": round(sim, 4),
                        "assigned_method": "recluster",
                    },
                    on_conflict="topic_id,post_id",
                ).execute()

                supabase.table("raw_posts").update(
                    {"processing_status": "assigned"}
                ).eq("id", post["id"]).execute()
            except Exception as e:
                logger.error(
                    "recluster_assign_failed",
                    post_id=post["id"],
                    topic_id=topic_id,
                    error=str(e),
                )

    # === Step 5: Full centroid recompute for all updated topics ===
    for topic_id in topics_to_update:
        all_embeds_result = (
            supabase.table("topic_posts")
            .select("raw_posts!inner(embedding)")
            .eq("topic_id", topic_id)
            .execute()
        )
        all_embeds = [
            r["raw_posts"]["embedding"]
            for r in all_embeds_result.data
            if r.get("raw_posts") and r["raw_posts"].get("embedding")
        ]
        if all_embeds:
            centroid = np.mean(
                np.array(all_embeds, dtype=np.float64), axis=0
            ).tolist()
            supabase.table("topics").update(
                {
                    "centroid": centroid,
                    "centroid_post_count": len(all_embeds),
                    "last_updated_at": now_iso,
                }
            ).eq("id", topic_id).execute()

    # === Step 6: Update heat scores + status ===
    for topic_id in topics_to_update:
        try:
            # Refresh metadata
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
                supabase.table("topics").update(
                    {
                        "post_count": len(tp_result.data),
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
                    }
                ).eq("id", topic_id).execute()

            await calculate_heat_score(topic_id)
            await update_topic_status(topic_id)
            stats["topics_updated"] += 1
        except Exception as e:
            logger.error("recluster_topic_update_failed", topic_id=topic_id, error=str(e))

    # === Step 7: Trigger summarization for new/changed topics ===
    if topics_needing_summary:
        try:
            await summarize_topics(topics_needing_summary)
        except Exception as e:
            logger.error("recluster_summarization_failed", error=str(e))

    # === Step 8: Quality metrics ===
    if stats["clusters_found"] > 0:
        # Average intra-cluster similarity
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
