"""Tests for incremental_assign.py — pure functions (no DB)."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from jobs.incremental_assign import (
    CLUSTER_THRESHOLD,
    COSINE_THRESHOLD,
    MIN_CLUSTER_SIZE,
    MIN_PLATFORM_DIVERSITY,
    TOP_ACTIVE_TOPICS_LIMIT,
    _cosine_similarity,
    _days_since,
    _full_recompute_centroid,
    _greedy_cluster,
    _hours_since,
    _incremental_centroid_update,
    _parse_vector,
    _platforms_compatible,
    _should_force_new_topic,
)


# ============================================
# _cosine_similarity
# ============================================


class TestCosineSimilarity:
    def test_identical_vectors(self) -> None:
        v = [1.0, 2.0, 3.0]
        assert _cosine_similarity(v, v) == pytest.approx(1.0, abs=1e-6)

    def test_orthogonal_vectors(self) -> None:
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert _cosine_similarity(a, b) == pytest.approx(0.0, abs=1e-6)

    def test_opposite_vectors(self) -> None:
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert _cosine_similarity(a, b) == pytest.approx(-1.0, abs=1e-6)

    def test_zero_vector_returns_zero(self) -> None:
        a = [0.0, 0.0, 0.0]
        b = [1.0, 2.0, 3.0]
        assert _cosine_similarity(a, b) == 0.0

    def test_both_zero_vectors(self) -> None:
        a = [0.0, 0.0]
        b = [0.0, 0.0]
        assert _cosine_similarity(a, b) == 0.0


# ============================================
# _hours_since / _days_since
# ============================================


class TestTimeSince:
    def test_hours_since_none(self) -> None:
        assert _hours_since(None) == 0.0

    def test_hours_since_recent(self) -> None:
        ts = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
        assert 2.9 < _hours_since(ts) < 3.2

    def test_days_since(self) -> None:
        ts = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        assert 1.9 < _days_since(ts) < 2.1


# ============================================
# _should_force_new_topic
# ============================================


class TestShouldForceNewTopic:
    def test_stale_old_topic_forced(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "last_updated_at": (now - timedelta(hours=80)).isoformat(),
            "first_detected_at": (now - timedelta(days=10)).isoformat(),
        }
        assert _should_force_new_topic(topic) is True

    def test_recent_topic_not_forced(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "last_updated_at": (now - timedelta(hours=1)).isoformat(),
            "first_detected_at": (now - timedelta(days=1)).isoformat(),
        }
        assert _should_force_new_topic(topic) is False

    def test_old_but_recently_updated_not_forced(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "last_updated_at": (now - timedelta(hours=1)).isoformat(),
            "first_detected_at": (now - timedelta(days=30)).isoformat(),
        }
        assert _should_force_new_topic(topic) is False

    def test_stale_but_new_topic_not_forced(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "last_updated_at": (now - timedelta(hours=80)).isoformat(),
            "first_detected_at": (now - timedelta(days=3)).isoformat(),
        }
        assert _should_force_new_topic(topic) is False

    def test_missing_fields_not_forced(self) -> None:
        assert _should_force_new_topic({}) is False


# ============================================
# _incremental_centroid_update
# ============================================


class TestIncrementalCentroidUpdate:
    def test_first_post(self) -> None:
        old = [1.0, 0.0, 0.0]
        new = [0.0, 1.0, 0.0]
        result = _incremental_centroid_update(old, 1, new)
        assert result == pytest.approx([0.5, 0.5, 0.0])

    def test_with_existing_posts(self) -> None:
        old = [1.0, 1.0]
        new = [0.0, 0.0]
        # (old * 9 + new) / 10 = [0.9, 0.9]
        result = _incremental_centroid_update(old, 9, new)
        assert result == pytest.approx([0.9, 0.9])


# ============================================
# _full_recompute_centroid
# ============================================


class TestFullRecomputeCentroid:
    def test_single_embedding(self) -> None:
        embs = [[1.0, 2.0, 3.0]]
        assert _full_recompute_centroid(embs) == pytest.approx([1.0, 2.0, 3.0])

    def test_multiple_embeddings(self) -> None:
        embs = [[1.0, 0.0], [0.0, 1.0]]
        assert _full_recompute_centroid(embs) == pytest.approx([0.5, 0.5])

    def test_empty_returns_zeros(self) -> None:
        result = _full_recompute_centroid([])
        assert len(result) == 1536  # default dim

    def test_result_is_list(self) -> None:
        result = _full_recompute_centroid([[1.0, 2.0]])
        assert isinstance(result, list)


# ============================================
# _parse_vector
# ============================================


class TestParseVector:
    def test_none(self) -> None:
        assert _parse_vector(None) is None

    def test_list_passthrough(self) -> None:
        v = [1.0, 2.0, 3.0]
        assert _parse_vector(v) == v

    def test_json_string(self) -> None:
        v = "[1.0, 2.0, 3.0]"
        assert _parse_vector(v) == [1.0, 2.0, 3.0]

    def test_other_type(self) -> None:
        assert _parse_vector(42) is None


# ============================================
# _platforms_compatible
# ============================================


class TestPlatformsCompatible:
    def test_news_with_news(self) -> None:
        assert _platforms_compatible("news", "news") is True

    def test_news_with_youtube(self) -> None:
        assert _platforms_compatible("news", "youtube") is True

    def test_news_with_lihkg_incompatible(self) -> None:
        assert _platforms_compatible("news", "lihkg") is False

    def test_lihkg_with_youtube(self) -> None:
        assert _platforms_compatible("lihkg", "youtube") is True

    def test_youtube_with_lihkg(self) -> None:
        assert _platforms_compatible("youtube", "lihkg") is True


# ============================================
# _greedy_cluster
# ============================================


class TestGreedyCluster:
    def _make_post(self, platform: str, embedding: list[float]) -> dict:
        return {"platform": platform, "embedding": embedding}

    def test_empty(self) -> None:
        assert _greedy_cluster([], 0.8) == []

    def test_single_post(self) -> None:
        posts = [self._make_post("youtube", [1.0, 0.0])]
        clusters = _greedy_cluster(posts, 0.8)
        assert len(clusters) == 1
        assert len(clusters[0]) == 1

    def test_identical_posts_cluster(self) -> None:
        emb = [1.0, 0.0, 0.0]
        posts = [
            self._make_post("youtube", emb),
            self._make_post("lihkg", emb),
        ]
        clusters = _greedy_cluster(posts, 0.8)
        assert len(clusters) == 1
        assert len(clusters[0]) == 2

    def test_dissimilar_posts_separate(self) -> None:
        posts = [
            self._make_post("youtube", [1.0, 0.0, 0.0]),
            self._make_post("lihkg", [0.0, 1.0, 0.0]),
        ]
        clusters = _greedy_cluster(posts, 0.8)
        assert len(clusters) == 2

    def test_news_lihkg_incompatible_even_if_similar(self) -> None:
        emb = [1.0, 0.0, 0.0]
        posts = [
            self._make_post("news", emb),
            self._make_post("lihkg", emb),
        ]
        clusters = _greedy_cluster(posts, 0.8)
        # Should be 2 clusters because news + lihkg are incompatible
        assert len(clusters) == 2

    def test_news_youtube_compatible(self) -> None:
        emb = [1.0, 0.0, 0.0]
        posts = [
            self._make_post("news", emb),
            self._make_post("youtube", emb),
        ]
        clusters = _greedy_cluster(posts, 0.8)
        assert len(clusters) == 1


# ============================================
# Constants
# ============================================


class TestConstants:
    def test_cosine_threshold(self) -> None:
        assert 0.7 <= COSINE_THRESHOLD <= 0.9

    def test_cluster_threshold_lower_than_cosine(self) -> None:
        assert CLUSTER_THRESHOLD < COSINE_THRESHOLD

    def test_top_active_topics_limit(self) -> None:
        assert TOP_ACTIVE_TOPICS_LIMIT == 300

    def test_min_cluster_size(self) -> None:
        assert MIN_CLUSTER_SIZE >= 1

    def test_min_platform_diversity(self) -> None:
        assert MIN_PLATFORM_DIVERSITY >= 1
