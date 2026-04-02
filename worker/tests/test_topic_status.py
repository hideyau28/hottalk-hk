"""Tests for topic_status.py — status transition logic."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from utils.topic_status import _hours_since, update_topic_status


# ============================================
# _hours_since (same as heat_score but separate copy)
# ============================================


class TestHoursSince:
    def test_none(self) -> None:
        assert _hours_since(None) == 0.0

    def test_empty(self) -> None:
        assert _hours_since("") == 0.0

    def test_one_hour_ago(self) -> None:
        ts = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert 0.9 < _hours_since(ts) < 1.2

    def test_future_clamps(self) -> None:
        ts = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
        assert _hours_since(ts) == 0.0


# ============================================
# update_topic_status (mocked DB)
# ============================================


class TestUpdateTopicStatus:
    """Test status transition rules with mocked Supabase."""

    def _build_supabase(
        self,
        topic_data: dict,
        velocity_count: int = 0,
        active_scores: list[int] | None = None,
    ) -> MagicMock:
        client = MagicMock()

        def make_chain(data=None, count=None):
            chain = MagicMock()
            for m in ("select", "eq", "neq", "gte", "lte", "gt", "lt", "in_", "order", "limit", "single", "is_"):
                getattr(chain, m).return_value = chain
            result = MagicMock()
            result.data = data
            result.count = count
            chain.execute.return_value = result
            return chain

        call_counts: dict[str, int] = {}

        def table_router(name: str):
            call_counts[name] = call_counts.get(name, 0) + 1

            if name == "topics":
                if call_counts[name] == 1:
                    # First call: fetch topic
                    return make_chain(data=topic_data)
                if active_scores is not None:
                    # Percentile threshold query
                    scores_data = [{"heat_score": s} for s in active_scores]
                    return make_chain(data=scores_data)
                return make_chain()

            if name == "topic_posts":
                return make_chain(data=[], count=velocity_count)

            return make_chain()  # audit_log etc.

        client.table.side_effect = table_router
        return client

    @pytest.mark.asyncio
    async def test_emerging_to_rising(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "id": "t1",
            "status": "emerging",
            "heat_score": 3000,
            "post_count": 5,
            "source_count": 2,
            "first_detected_at": (now - timedelta(hours=2)).isoformat(),
            "last_updated_at": now.isoformat(),
        }
        client = self._build_supabase(topic)

        with patch("utils.topic_status.get_supabase_client", return_value=client):
            result = await update_topic_status("t1")

        assert result == "rising"

    @pytest.mark.asyncio
    async def test_emerging_stays_if_not_enough_posts(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "id": "t1",
            "status": "emerging",
            "heat_score": 1000,
            "post_count": 2,
            "source_count": 1,
            "first_detected_at": (now - timedelta(hours=1)).isoformat(),
            "last_updated_at": now.isoformat(),
        }
        client = self._build_supabase(topic)

        with patch("utils.topic_status.get_supabase_client", return_value=client):
            result = await update_topic_status("t1")

        assert result == "emerging"

    @pytest.mark.asyncio
    async def test_emerging_to_archive_if_stale(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "id": "t1",
            "status": "emerging",
            "heat_score": 500,
            "post_count": 2,
            "source_count": 1,
            "first_detected_at": (now - timedelta(hours=7)).isoformat(),
            "last_updated_at": now.isoformat(),
        }
        client = self._build_supabase(topic)

        with patch("utils.topic_status.get_supabase_client", return_value=client):
            result = await update_topic_status("t1")

        assert result == "archive"

    @pytest.mark.asyncio
    async def test_rising_to_peak(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "id": "t1",
            "status": "rising",
            "heat_score": 9000,
            "post_count": 20,
            "source_count": 3,
            "first_detected_at": (now - timedelta(hours=5)).isoformat(),
            "last_updated_at": now.isoformat(),
        }
        # p90 = 8000, topic score 9000 > 8000
        active_scores = list(range(1000, 9001, 1000))  # [1000..9000]
        client = self._build_supabase(topic, velocity_count=3, active_scores=active_scores)

        with patch("utils.topic_status.get_supabase_client", return_value=client):
            result = await update_topic_status("t1")

        assert result == "peak"

    @pytest.mark.asyncio
    async def test_rising_to_declining_low_velocity(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "id": "t1",
            "status": "rising",
            "heat_score": 5000,
            "post_count": 10,
            "source_count": 2,
            "first_detected_at": (now - timedelta(hours=10)).isoformat(),
            "last_updated_at": now.isoformat(),
        }
        # velocity = 0/3 = 0 < 0.2
        # p90 check: score 5000, need active_scores where p90 > 5000
        active_scores = list(range(1000, 10001, 1000))
        client = self._build_supabase(topic, velocity_count=0, active_scores=active_scores)

        with patch("utils.topic_status.get_supabase_client", return_value=client):
            result = await update_topic_status("t1")

        assert result == "declining"

    @pytest.mark.asyncio
    async def test_declining_to_archive_after_72h(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "id": "t1",
            "status": "declining",
            "heat_score": 1000,
            "post_count": 5,
            "source_count": 2,
            "first_detected_at": (now - timedelta(days=5)).isoformat(),
            "last_updated_at": (now - timedelta(hours=73)).isoformat(),
        }
        client = self._build_supabase(topic)

        with patch("utils.topic_status.get_supabase_client", return_value=client):
            result = await update_topic_status("t1")

        assert result == "archive"

    @pytest.mark.asyncio
    async def test_declining_stays_if_recent_update(self) -> None:
        now = datetime.now(timezone.utc)
        topic = {
            "id": "t1",
            "status": "declining",
            "heat_score": 1000,
            "post_count": 5,
            "source_count": 2,
            "first_detected_at": (now - timedelta(days=2)).isoformat(),
            "last_updated_at": (now - timedelta(hours=10)).isoformat(),
        }
        client = self._build_supabase(topic)

        with patch("utils.topic_status.get_supabase_client", return_value=client):
            result = await update_topic_status("t1")

        assert result == "declining"
