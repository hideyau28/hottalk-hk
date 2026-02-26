from __future__ import annotations

import os
import time
from typing import Any

import structlog
from openai import AsyncOpenAI

from worker.utils.entity_normalize import build_normalized_text
from worker.utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
BATCH_MAX = 2048  # OpenAI max texts per call
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds


def _get_openai_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        timeout=30.0,
    )


async def _embed_batch(client: AsyncOpenAI, texts: list[str]) -> list[list[float]]:
    """Call OpenAI embeddings API for a batch of texts."""
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
        dimensions=EMBEDDING_DIM,
    )
    # Return embeddings in the same order as input
    sorted_data = sorted(response.data, key=lambda x: x.index)
    return [item.embedding for item in sorted_data]


async def _embed_with_retry(
    client: AsyncOpenAI, texts: list[str]
) -> list[list[float]]:
    """Embed a batch with exponential backoff retry."""
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return await _embed_batch(client, texts)
        except Exception as e:
            last_err = e
            delay = RETRY_BASE_DELAY * (2**attempt)
            logger.warning(
                "embedding_retry",
                attempt=attempt + 1,
                delay=delay,
                error=str(e),
            )
            time.sleep(delay)
    raise last_err  # type: ignore[misc]


async def _embed_single_fallback(
    client: AsyncOpenAI, texts: list[str]
) -> list[list[float] | None]:
    """Fallback: embed one-by-one when batch fails."""
    results: list[list[float] | None] = []
    for text in texts:
        try:
            response = await client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=[text],
                dimensions=EMBEDDING_DIM,
            )
            results.append(response.data[0].embedding)
        except Exception as e:
            logger.error("single_embed_failed", error=str(e))
            results.append(None)
    return results


async def batch_embed_pending_posts() -> dict[str, int]:
    """Embed all pending raw_posts within the 48h window.

    Flow:
    1. Query pending posts (published_at > NOW() - 48h)
    2. Build normalized_text for each
    3. Batch call OpenAI embedding API
    4. Write back: embedding, normalized_text, processing_status='embedded'

    Returns stats dict: {embedded, failed, skipped}.
    """
    supabase = get_supabase_client()

    # Fetch pending posts within 48h window
    result = (
        supabase.table("raw_posts")
        .select("id, title, description")
        .eq("processing_status", "pending")
        .gte("published_at", "now() - interval '48 hours'")
        .limit(2000)
        .execute()
    )

    posts = result.data
    if not posts:
        logger.info("no_pending_posts")
        return {"embedded": 0, "failed": 0, "skipped": 0}

    logger.info("embedding_start", pending_count=len(posts))

    # Build normalized texts
    texts: list[str] = []
    post_ids: list[str] = []
    for post in posts:
        normalized = build_normalized_text(post["title"], post.get("description"))
        texts.append(normalized)
        post_ids.append(post["id"])

    # Batch embed (split into chunks of BATCH_MAX)
    client = _get_openai_client()
    all_embeddings: list[list[float] | None] = []
    embedded_count = 0
    failed_count = 0

    for i in range(0, len(texts), BATCH_MAX):
        chunk_texts = texts[i : i + BATCH_MAX]
        chunk_ids = post_ids[i : i + BATCH_MAX]

        try:
            embeddings = await _embed_with_retry(client, chunk_texts)
            all_embeddings.extend(embeddings)  # type: ignore[arg-type]
        except Exception as e:
            logger.warning("batch_embed_failed_fallback_single", error=str(e))
            # Fallback: embed one by one
            fallback = await _embed_single_fallback(client, chunk_texts)
            all_embeddings.extend(fallback)

    # Write results back to DB
    for idx, (post_id, embedding) in enumerate(zip(post_ids, all_embeddings)):
        normalized = texts[idx]
        if embedding is not None:
            try:
                supabase.table("raw_posts").update(
                    {
                        "embedding": embedding,
                        "normalized_text": normalized,
                        "processing_status": "embedded",
                    }
                ).eq("id", post_id).execute()
                embedded_count += 1
            except Exception as e:
                logger.error("embedding_write_failed", post_id=post_id, error=str(e))
                failed_count += 1
        else:
            # All embedding attempts failed for this post
            supabase.table("raw_posts").update(
                {
                    "data_quality": "no_ai",
                    "processing_status": "noise",
                }
            ).eq("id", post_id).execute()
            failed_count += 1

    stats = {
        "embedded": embedded_count,
        "failed": failed_count,
        "skipped": 0,
    }
    logger.info("embedding_complete", **stats)
    return stats
