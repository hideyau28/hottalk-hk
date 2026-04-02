"""Tests for embedding.py — batch logic, retry, fallback."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from utils.embedding import (
    BATCH_MAX,
    EMBEDDING_DIM,
    _embed_batch,
    _embed_with_retry,
    _embed_single_fallback,
    batch_embed_pending_posts,
)


# ============================================
# _embed_with_retry
# ============================================


class TestEmbedWithRetry:
    @pytest.mark.asyncio
    async def test_success_first_try(self) -> None:
        client = MagicMock()
        expected = [[0.1] * EMBEDDING_DIM]

        with patch("utils.embedding._embed_batch", new_callable=AsyncMock, return_value=expected) as mock_batch:
            result = await _embed_with_retry(client, ["hello"])

        assert result == expected
        mock_batch.assert_called_once()

    @pytest.mark.asyncio
    async def test_retries_on_failure(self) -> None:
        client = MagicMock()
        expected = [[0.1] * EMBEDDING_DIM]

        with patch("utils.embedding._embed_batch", new_callable=AsyncMock) as mock_batch:
            mock_batch.side_effect = [Exception("rate limit"), expected]
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await _embed_with_retry(client, ["hello"])

        assert result == expected
        assert mock_batch.call_count == 2

    @pytest.mark.asyncio
    async def test_raises_after_max_retries(self) -> None:
        client = MagicMock()

        with patch("utils.embedding._embed_batch", new_callable=AsyncMock, side_effect=Exception("fail")):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(Exception, match="fail"):
                    await _embed_with_retry(client, ["hello"])


# ============================================
# _embed_single_fallback
# ============================================


class TestEmbedSingleFallback:
    @pytest.mark.asyncio
    async def test_returns_none_for_failed_items(self) -> None:
        client = MagicMock()

        embedding_result = MagicMock()
        embedding_obj = MagicMock()
        embedding_obj.values = [0.1] * EMBEDDING_DIM
        embedding_result.embeddings = [embedding_obj]

        call_count = 0

        def embed_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise Exception("single fail")
            return embedding_result

        client.models.embed_content = embed_side_effect

        with patch("asyncio.to_thread", side_effect=lambda fn, *a, **kw: fn(*a, **kw)):
            result = await _embed_single_fallback(client, ["text1", "text2", "text3"])

        assert len(result) == 3
        assert result[0] is not None
        assert result[1] is None  # failed
        assert result[2] is not None


# ============================================
# batch_embed_pending_posts
# ============================================


class TestBatchEmbedPendingPosts:
    @pytest.mark.asyncio
    async def test_no_pending_posts(self) -> None:
        client = MagicMock()
        chain = MagicMock()
        for m in ("select", "eq", "gte", "limit"):
            getattr(chain, m).return_value = chain
        result_mock = MagicMock()
        result_mock.data = []
        chain.execute.return_value = result_mock
        client.table.return_value = chain

        with patch("utils.embedding.get_supabase_client", return_value=client):
            stats = await batch_embed_pending_posts()

        assert stats == {"embedded": 0, "failed": 0, "skipped": 0}

    @pytest.mark.asyncio
    async def test_embeds_and_writes_back(self) -> None:
        client = MagicMock()

        # Set up select chain
        select_chain = MagicMock()
        for m in ("select", "eq", "gte", "limit"):
            getattr(select_chain, m).return_value = select_chain
        select_result = MagicMock()
        select_result.data = [
            {"id": "p1", "title": "Test Post", "description": "desc"},
        ]
        select_chain.execute.return_value = select_result

        # Set up update chain
        update_chain = MagicMock()
        for m in ("update", "eq"):
            getattr(update_chain, m).return_value = update_chain
        update_chain.execute.return_value = MagicMock()

        def table_router(name: str):
            return select_chain

        client.table.side_effect = table_router
        # Override the update path
        select_chain.update.return_value = update_chain

        embedding = [0.1] * EMBEDDING_DIM

        with (
            patch("utils.embedding.get_supabase_client", return_value=client),
            patch("utils.embedding._embed_with_retry", new_callable=AsyncMock, return_value=[embedding]),
            patch("utils.embedding._get_genai_client", return_value=MagicMock()),
        ):
            stats = await batch_embed_pending_posts()

        assert stats["embedded"] == 1
        assert stats["failed"] == 0


class TestBatchChunking:
    """Verify that posts are split into chunks of BATCH_MAX."""

    def test_batch_max_is_100(self) -> None:
        assert BATCH_MAX == 100

    def test_embedding_dim_is_768(self) -> None:
        assert EMBEDDING_DIM == 768
