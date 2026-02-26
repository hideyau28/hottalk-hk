"""Telegram alerting for HotTalk HK monitoring.

Alert conditions:
- Collector consecutive failures >= 5
- LIHKG degraded to L3
- LLM daily cost > $0.08 (warning) / > $0.15 (hard stop)
- AI Worker healthcheck fail
- 0 new topics in 6h
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
import structlog

from worker.utils.monitoring import get_consecutive_failures
from worker.utils.supabase_client import get_supabase_client

logger = structlog.get_logger()

CONSECUTIVE_FAIL_THRESHOLD = 5
LLM_COST_WARNING_USD = 0.08
LLM_COST_HARD_STOP_USD = 0.15
# Conservative avg: Haiku input $0.25/1M + output $1.25/1M, blended ~$0.80/1M
LLM_COST_PER_TOKEN = 0.80 / 1_000_000
ZERO_TOPICS_HOURS = 6

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"
REDIS_TOKEN_KEY_PREFIX = "hottalk:llm_tokens"
REDIS_LIHKG_LEVEL_KEY = "hottalk:lihkg:degradation_level"

# Dedup: prevent same alert firing more than once per hour
ALERT_DEDUP_PREFIX = "hottalk:alert_sent"
ALERT_DEDUP_TTL = 3600  # 1 hour


def _get_redis():  # type: ignore[no-untyped-def]
    from upstash_redis import Redis
    return Redis.from_env()


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
    """Check dedup: only send same alert once per hour."""
    try:
        redis = _get_redis()
        key = f"{ALERT_DEDUP_PREFIX}:{alert_key}"
        if redis.get(key):
            return False
        redis.set(key, "1")
        redis.expire(key, ALERT_DEDUP_TTL)
        return True
    except Exception:
        return True  # On Redis error, send the alert anyway


async def check_and_alert_collector(collector: str, success: bool) -> None:
    """Check consecutive failures for a collector and alert if threshold met."""
    if success:
        return

    count = await get_consecutive_failures(collector)
    if count >= CONSECUTIVE_FAIL_THRESHOLD:
        if await _should_send(f"collector_fail:{collector}"):
            await send_telegram_alert(
                f"Collector <b>{collector}</b> 連續失敗 {count} 次"
            )


async def check_lihkg_degradation() -> None:
    """Alert if LIHKG is degraded to L3."""
    try:
        redis = _get_redis()
        level = redis.get(REDIS_LIHKG_LEVEL_KEY)
        if level == "L3":
            if await _should_send("lihkg_l3"):
                await send_telegram_alert(
                    "LIHKG 降級到 <b>L3</b>（HTML fallback 模式）"
                )
    except Exception as e:
        logger.warning("check_lihkg_degradation_failed", error=str(e))


async def check_llm_cost() -> str | None:
    """Check LLM daily cost. Returns 'hard_stop', 'warning', or None.

    Caller should stop summarization when 'hard_stop' is returned.
    """
    try:
        redis = _get_redis()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"{REDIS_TOKEN_KEY_PREFIX}:{today}"
        val = redis.get(key)
        tokens = int(val) if val else 0
        cost = tokens * LLM_COST_PER_TOKEN

        if cost > LLM_COST_HARD_STOP_USD:
            if await _should_send("llm_hard_stop"):
                await send_telegram_alert(
                    f"LLM 日費用超過 hard stop！"
                    f"Tokens: {tokens:,} | 估算: ${cost:.4f}"
                )
            return "hard_stop"

        if cost > LLM_COST_WARNING_USD:
            if await _should_send("llm_warning"):
                await send_telegram_alert(
                    f"LLM 日費用超過 warning 閾值\n"
                    f"Tokens: {tokens:,} | 估算: ${cost:.4f}"
                )
            return "warning"

        return None
    except Exception as e:
        logger.warning("check_llm_cost_failed", error=str(e))
        return None


async def check_zero_topics(hours: int = ZERO_TOPICS_HOURS) -> None:
    """Alert if no new topics in the specified number of hours."""
    try:
        supabase = get_supabase_client()
        result = (
            supabase.table("topics")
            .select("id", count="exact")
            .gte(
                "first_detected_at",
                datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", f"-{hours:02d}:00:00"),
            )
            .execute()
        )
        # Use the count from the response
        count = result.count if result.count is not None else len(result.data)
        if count == 0:
            if await _should_send("zero_topics"):
                await send_telegram_alert(
                    f"過去 {hours} 小時冇新 topics 產生"
                )
    except Exception as e:
        logger.warning("check_zero_topics_failed", error=str(e))


async def check_worker_health(health_url: str) -> None:
    """Alert if AI Worker health endpoint fails."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(health_url)
            if resp.status_code != 200:
                if await _should_send("worker_health"):
                    await send_telegram_alert(
                        f"AI Worker healthcheck 失敗 (status {resp.status_code})"
                    )
    except Exception as e:
        if await _should_send("worker_health"):
            await send_telegram_alert(
                f"AI Worker healthcheck 失敗: {str(e)[:100]}"
            )
