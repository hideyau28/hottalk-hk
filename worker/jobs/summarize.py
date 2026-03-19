"""Gemini Flash topic summarization job.

Triggers:
- New topic created
- Existing topic gained ≥5 new posts

Output: title, summary, sentiment, keywords, slug
Hard cap: 500K tokens/day.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import structlog
from google import genai

from worker.utils.monitoring import record_error, record_ok
from worker.utils.sensitive_filter import check_sensitive
from worker.utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

DAILY_TOKEN_CAP = 500_000
MODEL = "gemini-2.0-flash"

PROMPT_TEMPLATE = """你是香港社交媒體熱話分析師。以下是來自不同平台嘅帖文，全部講緊同一件事。

帖文列表：
{posts_text}

請用繁體中文（香港用語）回覆，**嚴格按以下 JSON 格式**輸出：

{{
  "title": "（10-20字，簡潔概括事件）",
  "summary": "（50字以內，用香港人嘅語氣，唔好直接抄任何原文）",
  "sentiment": {{"positive": 0.08, "negative": 0.72, "neutral": 0.15, "controversial": 0.05}},
  "keywords": ["港鐵", "觀塘線", "故障"],
  "slug_suggestion": "mtr-kwun-tong-line-delay"
}}

注意：
- summary 必須係你自己嘅概括，唔好複製原文句子
- sentiment 四個值加起來必須等於 1.0
- keywords 最多 5 個
- slug 用英文，全小寫，dash 分隔，唔加日期"""


def _get_genai_client() -> genai.Client:
    return genai.Client(api_key=os.environ["GOOGLE_AI_API_KEY"])


_daily_tokens_used: int = 0
_daily_tokens_date: str = ""


async def _get_daily_token_usage() -> int:
    """Get today's token usage from in-memory counter."""
    global _daily_tokens_used, _daily_tokens_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _daily_tokens_date != today:
        _daily_tokens_used = 0
        _daily_tokens_date = today
    return _daily_tokens_used


async def _increment_token_usage(tokens: int) -> None:
    """Increment today's token counter in memory."""
    global _daily_tokens_used, _daily_tokens_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _daily_tokens_date != today:
        _daily_tokens_used = 0
        _daily_tokens_date = today
    _daily_tokens_used += tokens


def _build_posts_text(posts: list[dict[str, Any]]) -> str:
    """Format posts for the prompt."""
    lines: list[str] = []
    for i, p in enumerate(posts[:20], 1):  # Max 20 posts in prompt
        platform = p.get("platform", "unknown")
        title = p.get("title", "")
        desc = (p.get("description") or "")[:150]
        lines.append(f"{i}. [{platform}] {title}")
        if desc:
            lines.append(f"   {desc}")
    return "\n".join(lines)


def _parse_llm_response(text: str) -> dict[str, Any] | None:
    """Extract JSON from LLM response. Handles markdown code blocks."""
    # Try direct JSON parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding JSON object pattern
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return None


def _normalize_sentiment(sentiment: dict[str, float]) -> dict[str, float]:
    """Ensure sentiment values sum to 1.0."""
    keys = ["positive", "negative", "neutral", "controversial"]
    values = [max(0, sentiment.get(k, 0)) for k in keys]
    total = sum(values)
    if total == 0:
        return {"positive": 0.0, "negative": 0.0, "neutral": 1.0, "controversial": 0.0}
    return {k: v / total for k, v in zip(keys, values)}


def _fallback_keywords(posts: list[dict[str, Any]]) -> list[str]:
    """Fallback: word frequency top 3 from titles + descriptions."""
    text = " ".join(
        (p.get("title", "") + " " + (p.get("description") or "")[:100])
        for p in posts
    )
    # Simple tokenization: CJK chars as individual tokens, latin words
    tokens: list[str] = []
    # CJK bigrams
    cjk_chars = re.findall(r"[\u4e00-\u9fff\u3400-\u4dbf]+", text)
    for segment in cjk_chars:
        for i in range(len(segment) - 1):
            tokens.append(segment[i : i + 2])
    # Latin words (3+ chars)
    latin_words = re.findall(r"[a-zA-Z]{3,}", text)
    tokens.extend(w.lower() for w in latin_words)

    # Filter stopwords
    stopwords = {"the", "and", "for", "are", "was", "has", "have", "been", "this", "that", "with"}
    counter = Counter(t for t in tokens if t not in stopwords)
    return [word for word, _ in counter.most_common(3)]


async def _ensure_unique_slug(supabase: Any, slug: str) -> str:
    """Ensure slug is unique. Append short hash if collision."""
    result = (
        supabase.table("topics")
        .select("id")
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if not result.data:
        return slug

    # Collision — append hash
    hash_suffix = hashlib.md5(
        datetime.now(timezone.utc).isoformat().encode()
    ).hexdigest()[:4]
    return f"{slug}-{hash_suffix}"


async def summarize_topics(topic_ids: list[str]) -> dict[str, int]:
    """Summarize one or more topics using Gemini Flash.

    Returns stats: {summarized, failed, skipped_sensitive, skipped_cap}.
    """
    supabase = get_supabase_client()
    client = _get_genai_client()

    stats = {
        "summarized": 0,
        "failed": 0,
        "skipped_sensitive": 0,
        "skipped_cap": 0,
    }

    for topic_id in topic_ids:
        # Check daily token cap
        usage = await _get_daily_token_usage()
        if usage >= DAILY_TOKEN_CAP:
            logger.warning("daily_token_cap_reached", usage=usage)
            stats["skipped_cap"] += 1
            continue

        # Fetch topic's posts
        posts_result = (
            supabase.table("topic_posts")
            .select(
                "raw_posts!inner(title, description, platform, published_at)"
            )
            .eq("topic_id", topic_id)
            .order("assigned_at", desc=True)
            .limit(20)
            .execute()
        )

        posts = [row["raw_posts"] for row in posts_result.data if row.get("raw_posts")]
        if not posts:
            stats["failed"] += 1
            continue

        # Build text for sensitive check
        all_text = " ".join(
            (p.get("title", "") + " " + (p.get("description") or ""))
            for p in posts
        )

        # Sensitive filter
        sensitive_result = check_sensitive(all_text)
        if sensitive_result.is_sensitive:
            if sensitive_result.action == "block_summary":
                supabase.table("topics").update(
                    {"summary_status": "hidden"}
                ).eq("id", topic_id).execute()
                stats["skipped_sensitive"] += 1
                logger.info(
                    "topic_summary_blocked",
                    topic_id=topic_id,
                    keywords=sensitive_result.matched_keywords,
                )
                continue
            if sensitive_result.action == "block_topic":
                supabase.table("topics").update(
                    {"summary_status": "hidden", "flags": ["sensitive"]}
                ).eq("id", topic_id).execute()
                stats["skipped_sensitive"] += 1
                continue
            # flag_only: continue but add flag
            if sensitive_result.action == "flag_only":
                supabase.table("topics").update(
                    {"flags": ["sensitive"]}
                ).eq("id", topic_id).execute()

        # Build prompt
        posts_text = _build_posts_text(posts)
        prompt = PROMPT_TEMPLATE.format(posts_text=posts_text)

        # Call Gemini Flash
        parsed: dict[str, Any] | None = None
        for attempt in range(2):  # 1 retry
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=MODEL,
                    contents=prompt,
                )
                response_text = response.text
                usage_metadata = response.usage_metadata
                tokens_used = 0
                if usage_metadata:
                    tokens_used = (
                        (usage_metadata.prompt_token_count or 0)
                        + (usage_metadata.candidates_token_count or 0)
                    )
                await _increment_token_usage(tokens_used)

                parsed = _parse_llm_response(response_text)
                if parsed:
                    break
                logger.warning(
                    "llm_json_parse_failed",
                    topic_id=topic_id,
                    attempt=attempt,
                    response=response_text[:200],
                )
            except Exception as e:
                logger.error(
                    "llm_call_failed",
                    topic_id=topic_id,
                    attempt=attempt,
                    error=str(e),
                )

        if not parsed:
            # Fallback: use first post's title
            fallback_title = posts[0].get("title", "未命名話題")
            supabase.table("topics").update(
                {
                    "title": fallback_title,
                    "summary_status": "failed",
                }
            ).eq("id", topic_id).execute()
            stats["failed"] += 1
            continue

        # Validate and write results
        sentiment = _normalize_sentiment(parsed.get("sentiment", {}))
        keywords = parsed.get("keywords") or _fallback_keywords(posts)
        keywords = keywords[:5]  # Max 5

        slug_suggestion = parsed.get("slug_suggestion", "")
        if slug_suggestion:
            # Clean slug
            slug_suggestion = re.sub(r"[^a-z0-9-]", "", slug_suggestion.lower().strip())
            slug_suggestion = re.sub(r"-+", "-", slug_suggestion).strip("-")

        if slug_suggestion:
            slug = await _ensure_unique_slug(supabase, slug_suggestion)
        else:
            slug = None  # Keep existing slug

        update_fields: dict[str, Any] = {
            "title": parsed.get("title", posts[0].get("title", "")),
            "summary": parsed.get("summary", ""),
            "summary_status": "generated",
            "sentiment_positive": sentiment["positive"],
            "sentiment_negative": sentiment["negative"],
            "sentiment_neutral": sentiment["neutral"],
            "sentiment_controversial": sentiment["controversial"],
            "keywords": keywords,
            "meta_description": parsed.get("summary", "")[:160],
        }
        if slug:
            # Store old slug as alias before updating
            old_topic = (
                supabase.table("topics")
                .select("slug")
                .eq("id", topic_id)
                .single()
                .execute()
            )
            old_slug = old_topic.data.get("slug", "")
            if old_slug and old_slug != slug and old_slug.startswith("temp-"):
                update_fields["slug"] = slug
            elif old_slug and old_slug != slug:
                # Non-temp slug changed: create alias for SEO
                try:
                    supabase.table("topic_aliases").insert(
                        {"old_slug": old_slug, "topic_id": topic_id}
                    ).execute()
                except Exception:
                    pass  # Duplicate alias is fine
                update_fields["slug"] = slug

        supabase.table("topics").update(update_fields).eq("id", topic_id).execute()
        stats["summarized"] += 1

        logger.info(
            "topic_summarized",
            topic_id=topic_id,
            title=parsed.get("title", ""),
            keywords=keywords,
        )

    # Record monitoring counters
    if stats["summarized"] > 0:
        await record_ok("summarize")
    if stats["failed"] > 0:
        await record_error("summarize", f"failed={stats['failed']}")

    logger.info("summarize_complete", **stats)
    return stats
