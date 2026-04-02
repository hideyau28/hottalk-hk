"""Tests for heat_score.py — pure functions + async calculate_heat_score."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from utils.heat_score import (
    WEIGHTS,
    _group_posts_by_platform,
    _hours_since,
    get_raw_engagement,
    calculate_heat_score,
)


# ============================================
# get_raw_engagement
# ============================================


class TestGetRawEngagement:
    def test_youtube_sums_view_deltas(self) -> None:
        posts = [
            {"view_count_delta_24h": 1000},
            {"view_count_delta_24h": 500},
        ]
        assert get_raw_engagement("youtube", posts) == 1500.0

    def test_youtube_handles_none_values(self) -> None:
        posts = [
            {"view_count_delta_24h": None},
            {"view_count_delta_24h": 200},
        ]
        assert get_raw_engagement("youtube", posts) == 200.0

    def test_youtube_empty_posts(self) -> None:
        assert get_raw_engagement("youtube", []) == 0.0

    def test_lihkg_net_likes_plus_comments(self) -> None:
        posts = [
            {"like_count": 50, "dislike_count": 10, "comment_count": 20},
            {"like_count": 30, "dislike_count": 5, "comment_count": 15},
        ]
        # (50-10+20) + (30-5+15) = 60 + 40 = 100
        assert get_raw_engagement("lihkg", posts) == 100.0

    def test_lihkg_handles_none_fields(self) -> None:
        posts = [{"like_count": None, "dislike_count": None, "comment_count": 10}]
        assert get_raw_engagement("lihkg", posts) == 10.0

    def test_news_sums_trust_weight(self) -> None:
        posts = [
            {"trust_weight": 1.5},
            {"trust_weight": 0.8},
        ]
        assert get_raw_engagement("news", posts) == pytest.approx(2.3)

    def test_news_defaults_trust_weight_to_1(self) -> None:
        posts = [{"trust_weight": None}, {}]
        assert get_raw_engagement("news", posts) == 2.0

    def test_google_trends_takes_max_view_count(self) -> None:
        posts = [
            {"view_count": 100},
            {"view_count": 500},
            {"view_count": 200},
        ]
        assert get_raw_engagement("google_trends", posts) == 500.0

    def test_google_trends_empty(self) -> None:
        assert get_raw_engagement("google_trends", []) == 0.0

    def test_unknown_platform_returns_zero(self) -> None:
        assert get_raw_engagement("threads", [{"view_count": 999}]) == 0.0


# ============================================
# _group_posts_by_platform
# ============================================


class TestGroupPostsByPlatform:
    def test_groups_correctly(self) -> None:
        posts = [
            {"platform": "youtube", "id": 1},
            {"platform": "lihkg", "id": 2},
            {"platform": "youtube", "id": 3},
        ]
        grouped = _group_posts_by_platform(posts)
        assert set(grouped.keys()) == {"youtube", "lihkg"}
        assert len(grouped["youtube"]) == 2
        assert len(grouped["lihkg"]) == 1

    def test_empty_list(self) -> None:
        assert _group_posts_by_platform([]) == {}

    def test_single_platform(self) -> None:
        posts = [{"platform": "news", "id": 1}, {"platform": "news", "id": 2}]
        grouped = _group_posts_by_platform(posts)
        assert list(grouped.keys()) == ["news"]
        assert len(grouped["news"]) == 2


# ============================================
# _hours_since
# ============================================


class TestHoursSince:
    def test_none_returns_zero(self) -> None:
        assert _hours_since(None) == 0.0

    def test_empty_string_returns_zero(self) -> None:
        assert _hours_since("") == 0.0

    def test_recent_timestamp(self) -> None:
        one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        result = _hours_since(one_hour_ago)
        assert 0.9 < result < 1.2  # allow some drift

    def test_z_suffix_parsed(self) -> None:
        two_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        result = _hours_since(two_hours_ago)
        assert 1.9 < result < 2.2

    def test_future_timestamp_clamps_to_zero(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        assert _hours_since(future) == 0.0


# ============================================
# WEIGHTS
# ============================================


class TestWeights:
    def test_weights_sum_to_one(self) -> None:
        assert sum(WEIGHTS.values()) == pytest.approx(1.0)

    def test_engagement_is_highest(self) -> None:
        assert WEIGHTS["engagement"] >= max(
            WEIGHTS["diversity"], WEIGHTS["recency"], WEIGHTS["trends_signal"]
        )


# ============================================
# calculate_heat_score (integration with mocked DB)
# ============================================


class TestCalculateHeatScore:
    @pytest.fixture()
    def supabase(self) -> MagicMock:
        """Build a mock Supabase client with chained query support."""
        client = MagicMock()

        def make_chain(data=None, count=None):
            chain = MagicMock()
            for m in ("select", "eq", "neq", "gte", "lte", "order", "limit", "single", "in_", "is_"):
                getattr(chain, m).return_value = chain
            result = MagicMock()
            result.data = data
            result.count = count
            chain.execute.return_value = result
            return chain

        # We'll set up per-call returns via side_effect
        self._make_chain = make_chain
        return client

    @pytest.mark.asyncio
    async def test_no_posts_returns_zero(self, supabase: MagicMock) -> None:
        topic_chain = self._make_chain(data={"id": "t1", "status": "active", "first_detected_at": None})
        posts_chain = self._make_chain(data=[])

        supabase.table.side_effect = lambda name: {
            "topics": topic_chain,
            "topic_posts": posts_chain,
        }.get(name, self._make_chain())

        with patch("utils.heat_score.get_supabase_client", return_value=supabase):
            score = await calculate_heat_score("t1")

        assert score == 0

    @pytest.mark.asyncio
    async def test_single_youtube_post(self, supabase: MagicMock) -> None:
        now = datetime.now(timezone.utc).isoformat()
        topic_chain = self._make_chain(data={"id": "t1", "status": "active", "first_detected_at": now})
        posts_chain = self._make_chain(data=[
            {
                "post_id": "p1",
                "raw_posts": {
                    "id": "p1",
                    "platform": "youtube",
                    "view_count": 10000,
                    "view_count_delta_24h": 5000,
                    "like_count": 100,
                    "dislike_count": 5,
                    "comment_count": 50,
                    "share_count": 10,
                    "author_name": "TestChannel",
                    "published_at": now,
                    "data_quality": "good",
                },
            }
        ])

        call_count = {"topics": 0}

        def table_router(name: str):
            if name == "topics":
                call_count["topics"] += 1
                if call_count["topics"] == 1:
                    return topic_chain
                return self._make_chain()  # update call
            if name == "topic_posts":
                return posts_chain
            return self._make_chain()  # topic_history, news_sources, etc.

        supabase.table.side_effect = table_router

        with patch("utils.heat_score.get_supabase_client", return_value=supabase):
            score = await calculate_heat_score("t1")

        assert 0 < score <= 10000

    @pytest.mark.asyncio
    async def test_multi_platform_higher_diversity(self, supabase: MagicMock) -> None:
        now = datetime.now(timezone.utc).isoformat()
        topic_chain = self._make_chain(data={"id": "t1", "status": "active", "first_detected_at": now})
        posts_data = [
            {
                "post_id": f"p{i}",
                "raw_posts": {
                    "id": f"p{i}",
                    "platform": platform,
                    "view_count": 100,
                    "view_count_delta_24h": 100,
                    "like_count": 10,
                    "dislike_count": 1,
                    "comment_count": 5,
                    "share_count": 0,
                    "author_name": "Test",
                    "published_at": now,
                    "data_quality": "good",
                },
            }
            for i, platform in enumerate(["youtube", "lihkg", "news"])
        ]
        posts_chain = self._make_chain(data=posts_data)

        call_count = {"topics": 0}

        def table_router(name: str):
            if name == "topics":
                call_count["topics"] += 1
                if call_count["topics"] == 1:
                    return topic_chain
                return self._make_chain()
            if name == "topic_posts":
                return posts_chain
            if name == "news_sources":
                return self._make_chain(data=[{"trust_weight": 1.0}])
            return self._make_chain()

        supabase.table.side_effect = table_router

        with patch("utils.heat_score.get_supabase_client", return_value=supabase):
            score = await calculate_heat_score("t1")

        # 3 platforms → diversity = min(3/3, 1.0) = 1.0
        assert score > 0

    @pytest.mark.asyncio
    async def test_score_clamped_to_10000(self, supabase: MagicMock) -> None:
        """Even with extreme values, score should never exceed 10000."""
        now = datetime.now(timezone.utc).isoformat()
        topic_chain = self._make_chain(data={"id": "t1", "status": "active", "first_detected_at": now})
        posts_data = [
            {
                "post_id": "p1",
                "raw_posts": {
                    "id": "p1",
                    "platform": "youtube",
                    "view_count": 999999999,
                    "view_count_delta_24h": 999999999,
                    "like_count": 999999,
                    "dislike_count": 0,
                    "comment_count": 999999,
                    "share_count": 999999,
                    "author_name": "Viral",
                    "published_at": now,
                    "data_quality": "good",
                },
            }
        ]
        posts_chain = self._make_chain(data=posts_data)

        call_count = {"topics": 0}

        def table_router(name: str):
            if name == "topics":
                call_count["topics"] += 1
                if call_count["topics"] == 1:
                    return topic_chain
                return self._make_chain()
            if name == "topic_posts":
                return posts_chain
            return self._make_chain()

        supabase.table.side_effect = table_router

        with patch("utils.heat_score.get_supabase_client", return_value=supabase):
            score = await calculate_heat_score("t1")

        assert score <= 10000
