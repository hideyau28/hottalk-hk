"""Telegram alerting for HotTalk HK monitoring.

Redis removed — dedup uses simple in-memory set (resets on restart).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
import structlog

from worker.utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

CONSECUTIVE_FAIL_THRESHOLD = 5
ZERO_TOPICS_HOURS = 6

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"

# Simple in-memory dedup (good enough for MVP)
_sent_alerts: set[str] = set()


async def send_telegram_alert(message: str) -> bool:
    """Send a message via Telegram Bot API. Returns True on success."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        logger.warning("telegram_not_configured")
        return False

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                TELEGRAM_API.format(token=token),
                json={
                    "chat_id": chat_id,
                    "text": f"[HotTalk HK]\n{message}",
                    "parse_mode": "HTML",
                },
            )
            resp.raise_for_status()
            logger.info("telegram_alert_sent", message=message[:100])
            return True
    except Exception as e:
        logger.error("telegram_alert_failed", error=str(e))
        return False


async def _should_send(alert_key: str) -> bool:
    """Simple in-memory dedup."""
    if alert_key in _sent_alerts:
        return False
    _sent_alerts.add(alert_key)
    return True


async def check_and_alert_collector(collector: str, success: bool) -> None:
    """Check consecutive failures from DB and alert if threshold met."""
    if success:
        return

    try:
        supabase = get_supabase_client()
        result = (
            supabase.table("scrape_runs")
            .select("status")
            .eq("collector_name", collector)
            .order("started_at", desc=True)
            .limit(CONSECUTIVE_FAIL_THRESHOLD)
            .execute()
        )
        runs = result.data or []
        consecutive = sum(1 for r in runs if r["status"] == "failed")

        if consecutive >= CONSECUTIVE_FAIL_THRESHOLD:
            if await _should_send(f"collector_fail:{collector}"):
                await send_telegram_alert(
                    f"Collector <b>{collector}</b> 連續失敗 {consecutive} 次"
                )
    except Exception as e:
        logger.warning("check_alert_failed", collector=collector, error=str(e))


async def check_lihkg_degradation() -> None:
    """Alert if LIHKG is degraded to L3 (check from DB)."""
    try:
        supabase = get_supabase_client()
        result = (
            supabase.table("scrape_runs")
            .select("degradation_level")
            .eq("collector_name", "lihkg_collector")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        runs = result.data or []
        if runs and runs[0].get("degradation_level") == "L3":
            if await _should_send("lihkg_l3"):
                await send_telegram_alert(
                    "LIHKG 降級到 <b>L3</b>（HTML fallback 模式）"
                )
    except Exception as e:
        logger.warning("check_lihkg_degradation_failed", error=str(e))


async def check_zero_topics(hours: int = ZERO_TOPICS_HOURS) -> None:
    """Alert if no new topics in the specified number of hours."""
    try:
        supabase = get_supabase_client()
        since = datetime.now(timezone.utc).isoformat()
        result = (
            supabase.table("topics")
            .select("id", count="exact")
            .gte(
                "first_detected_at",
                since.replace("+00:00", f"-{hours:02d}:00:00"),
            )
            .execute()
        )
        count = result.count if result.count is not None else len(result.data)
        if count == 0:
            if await _should_send("zero_topics"):
                await send_telegram_alert(
                    f"過去 {hours} 小時冇新 topics 產生"
                )
    except Exception as e:
        logger.warning("check_zero_topics_failed", error=str(e))
