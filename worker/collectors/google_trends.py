from __future__ import annotations

import hashlib
import os
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

from utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# Google Trends RSS feed for Hong Kong — no auth required, stable endpoint
_GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=HK"

_RSS_TIMEOUT = 20  # seconds
_SERPAPI_TIMEOUT = 30  # seconds

# Namespace used in Google Trends RSS feed
_HT_NS = "https://trends.google.com/trending/rss"


def _normalize_title(title: str) -> str:
    text = title.lower()
    text = re.sub(r"[^\w\s]", "", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _content_hash(title: str) -> str:
    normalized = _normalize_title(title)
    return hashlib.sha256(normalized.encode()).hexdigest()


async def collect_google_trends() -> dict[str, Any]:
    """Collect Google Trends data for Hong Kong.

    Primary: Google Trends RSS feed (no library dependency)
    Fallback: SerpApi
    """
    supabase = get_supabase_client()
    start_time = datetime.now(timezone.utc)

    # Create scrape_run
    run_result = supabase.table("scrape_runs").insert({
        "collector_name": "google_trends_collector",
        "platform": "google_trends",
        "status": "running",
    }).execute()
    run_id: str = run_result.data[0]["id"]

    errors: list[str] = []

    try:
        trends = await _fetch_rss()
        source_used = "rss"
    except Exception as e:
        rss_error = f"rss: {e}"
        errors.append(rss_error)
        logger.warning("google_trends_rss_failed", error=str(e))
        try:
            trends = await _fetch_serpapi()
            source_used = "serpapi"
        except Exception as fallback_err:
            serpapi_error = f"serpapi: {fallback_err}"
            errors.append(serpapi_error)
            error_msg = " | ".join(errors)
            logger.error("all_trends_sources_failed", error=error_msg)
            _finalize_run(supabase, run_id, start_time, {
                "status": "failed",
                "error_message": error_msg[:1000],
            })
            return {
                "status": "failed",
                "posts_fetched": 0,
                "error": error_msg,
            }

    if not trends:
        _finalize_run(supabase, run_id, start_time, {
            "status": "success",
            "posts_fetched": 0,
            "posts_new": 0,
        })
        return {"status": "success", "posts_fetched": 0, "source": source_used}

    # Prepare rows
    now_iso = datetime.now(timezone.utc).isoformat()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows: list[dict[str, Any]] = []

    for item in trends:
        keyword = item["keyword"]
        traffic = item.get("traffic_volume", 0)
        platform_id = f"gtrends_{_content_hash(keyword)}_{today}"
        search_url = (
            f"https://trends.google.com/trends/explore?geo=HK&q="
            f"{urllib.parse.quote_plus(keyword)}"
        )

        rows.append({
            "platform": "google_trends",
            "platform_id": platform_id,
            "title": keyword,
            "description": ", ".join(item.get("related_queries", []))[:500],
            "url": search_url,
            "view_count": traffic,
            "content_hash": _content_hash(keyword),
            "scrape_run_id": run_id,
            "processing_status": "pending",
            "content_policy": "metadata_only",
            "data_quality": "normal",
            "published_at": now_iso,
            "collected_at": now_iso,
        })

    # Upsert
    result = supabase.table("raw_posts").upsert(
        rows,
        on_conflict="platform,platform_id",
    ).execute()

    posts_new = len(result.data) if result.data else 0

    _finalize_run(supabase, run_id, start_time, {
        "status": "success",
        "status_code": 200,
        "posts_fetched": len(rows),
        "posts_new": posts_new,
    })

    logger.info(
        "google_trends_collected",
        source=source_used,
        posts_fetched=len(rows),
        posts_new=posts_new,
    )

    return {
        "status": "success",
        "source": source_used,
        "posts_fetched": len(rows),
        "posts_new": posts_new,
    }


async def _fetch_rss() -> list[dict[str, Any]]:
    """Fetch trending searches from Google Trends RSS feed.

    Uses the public RSS endpoint which is stable and doesn't require auth.
    Returns up to ~20 trending items for Hong Kong.
    """
    async with httpx.AsyncClient(
        timeout=_RSS_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": "HotTalk-HK/1.0"},
    ) as client:
        resp = await client.get(_GOOGLE_TRENDS_RSS_URL)
        resp.raise_for_status()

    root = ET.fromstring(resp.text)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("RSS feed missing <channel> element")

    results: list[dict[str, Any]] = []

    for item_el in channel.findall("item"):
        title_el = item_el.find("title")
        if title_el is None or not title_el.text:
            continue

        keyword = title_el.text.strip()
        if not keyword:
            continue

        # Parse traffic volume from ht:approx_traffic (e.g. "200,000+")
        traffic = 0
        traffic_el = item_el.find(f"{{{_HT_NS}}}approx_traffic")
        if traffic_el is not None and traffic_el.text:
            traffic_str = traffic_el.text.replace(",", "").replace("+", "").strip()
            try:
                traffic = int(traffic_str)
            except ValueError:
                pass

        # Parse related news titles as "related queries"
        related: list[str] = []
        news_items = item_el.findall(f"{{{_HT_NS}}}news_item")
        for news in news_items:
            news_title = news.find(f"{{{_HT_NS}}}news_item_title")
            if news_title is not None and news_title.text:
                related.append(news_title.text.strip())

        results.append({
            "keyword": keyword,
            "traffic_volume": traffic,
            "related_queries": related[:10],
        })

    if not results:
        raise ValueError("RSS feed returned 0 items — may be geo-blocked or format changed")

    return results


async def _fetch_serpapi() -> list[dict[str, Any]]:
    """Fallback: fetch from SerpApi."""
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        raise ValueError("SERPAPI_KEY not configured")

    async with httpx.AsyncClient(timeout=_SERPAPI_TIMEOUT) as client:
        resp = await client.get(
            "https://serpapi.com/search",
            params={
                "engine": "google_trends_trending_now",
                "geo": "HK",
                "api_key": api_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    trending = data.get("trending_searches", [])
    results: list[dict[str, Any]] = []

    for item in trending:
        query = item.get("query", {})
        keyword = query.get("text", "").strip()
        traffic = int(str(item.get("search_volume", 0)).replace(",", "") or 0)

        if keyword:
            related = [
                r.get("text", "")
                for r in item.get("related_queries", [])
                if r.get("text")
            ]
            results.append({
                "keyword": keyword,
                "traffic_volume": traffic,
                "related_queries": related[:10],
            })

    return results


def _finalize_run(
    supabase: Any,
    run_id: str,
    start_time: datetime,
    fields: dict[str, Any],
) -> None:
    duration = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
    supabase.table("scrape_runs").update({
        **fields,
        "duration_ms": duration,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", run_id).execute()
