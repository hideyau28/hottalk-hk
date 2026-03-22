from __future__ import annotations

import hashlib
import re
import urllib.parse
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog
from pytrends.request import TrendReq

from utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

# SerpApi consecutive failure threshold before switching
PYTRENDS_FAIL_THRESHOLD = 2


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

    Primary: pytrends library
    Fallback: SerpApi (after consecutive pytrends failures)
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

    try:
        trends = await _fetch_pytrends()
        source_used = "pytrends"
    except Exception as e:
        logger.warning("pytrends_failed", error=str(e))
        try:
            trends = await _fetch_serpapi()
            source_used = "serpapi"
        except Exception as fallback_err:
            logger.error("all_trends_sources_failed", error=str(fallback_err))
            _finalize_run(supabase, run_id, start_time, {
                "status": "failed",
                "error_message": f"pytrends: {e} | serpapi: {fallback_err}",
            })
            return {"status": "failed", "posts_fetched": 0}

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


async def _fetch_pytrends() -> list[dict[str, Any]]:
    """Fetch trending searches from pytrends."""
    pytrends = TrendReq(hl="zh-HK", geo="HK", timeout=(10, 30))
    df = pytrends.trending_searches(pn="hong_kong")

    results: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        keyword = str(row[0]).strip()
        if keyword:
            results.append({
                "keyword": keyword,
                "traffic_volume": 0,  # trending_searches 唔提供 traffic volume
                "related_queries": [],
            })

    # Try to get traffic volume via realtime trends
    try:
        rt_df = pytrends.realtime_trending_searches(pn="HK")
        if rt_df is not None and not rt_df.empty:
            traffic_map: dict[str, int] = {}
            for _, row in rt_df.iterrows():
                title = str(row.get("title", "")).strip()
                volume = int(row.get("formattedTraffic", "0").replace(",", "").replace("+", "") or 0)
                if title:
                    traffic_map[title.lower()] = volume

            for item in results:
                key = item["keyword"].lower()
                if key in traffic_map:
                    item["traffic_volume"] = traffic_map[key]
    except Exception:
        pass  # realtime trends 唔一定 available

    return results


async def _fetch_serpapi() -> list[dict[str, Any]]:
    """Fallback: fetch from SerpApi."""
    import os

    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        raise ValueError("SERPAPI_KEY not configured")

    async with httpx.AsyncClient(timeout=30) as client:
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
