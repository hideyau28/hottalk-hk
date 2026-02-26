"""Redis-based monitoring counters for collectors and jobs.

Key format:
  hottalk:ok:{collector}:{YYYY-MM-DD}   — success count
  hottalk:err:{collector}:{YYYY-MM-DD}  — error count
  hottalk:consecutive_err:{collector}    — consecutive failure streak
"""

from __future__ import annotations

from datetime import datetime, timezone

import structlog

logger = structlog.get_logger()

OK_PREFIX = "hottalk:ok"
ERR_PREFIX = "hottalk:err"
CONSECUTIVE_ERR_PREFIX = "hottalk:consecutive_err"
COUNTER_TTL = 86400 * 3  # 3 days
CONSECUTIVE_TTL = 86400  # 1 day

ALL_COLLECTORS = [
    "youtube_collector",
    "news_collector",
    "lihkg_collector",
    "google_trends_collector",
    "incremental_assign",
    "nightly_recluster",
    "summarize",
]


def _get_redis():  # type: ignore[no-untyped-def]
    from upstash_redis import Redis
    return Redis.from_env()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def record_ok(collector: str) -> None:
    """Increment daily success counter and reset consecutive failures."""
    try:
        redis = _get_redis()
        key = f"{OK_PREFIX}:{collector}:{_today()}"
        redis.incr(key)
        redis.expire(key, COUNTER_TTL)
        # Reset consecutive failures on success
        redis.delete(f"{CONSECUTIVE_ERR_PREFIX}:{collector}")
    except Exception as e:
        logger.warning("monitoring_record_ok_failed", collector=collector, error=str(e))


async def record_error(collector: str, error_msg: str = "") -> None:
    """Increment daily error counter and consecutive failure streak."""
    try:
        redis = _get_redis()
        date = _today()

        # Daily error counter
        err_key = f"{ERR_PREFIX}:{collector}:{date}"
        redis.incr(err_key)
        redis.expire(err_key, COUNTER_TTL)

        # Consecutive failure streak
        consec_key = f"{CONSECUTIVE_ERR_PREFIX}:{collector}"
        redis.incr(consec_key)
        redis.expire(consec_key, CONSECUTIVE_TTL)

        logger.info(
            "monitoring_error_recorded",
            collector=collector,
            error_msg=error_msg[:200],
        )
    except Exception as e:
        logger.warning("monitoring_record_error_failed", collector=collector, error=str(e))


async def get_consecutive_failures(collector: str) -> int:
    """Get current consecutive failure count for a collector."""
    try:
        redis = _get_redis()
        val = redis.get(f"{CONSECUTIVE_ERR_PREFIX}:{collector}")
        return int(val) if val else 0
    except Exception:
        return 0


async def get_counters(collector: str, date: str | None = None) -> dict[str, int]:
    """Get ok/err counts for a collector on a given date."""
    date = date or _today()
    try:
        redis = _get_redis()
        ok_val = redis.get(f"{OK_PREFIX}:{collector}:{date}")
        err_val = redis.get(f"{ERR_PREFIX}:{collector}:{date}")
        return {
            "ok": int(ok_val) if ok_val else 0,
            "err": int(err_val) if err_val else 0,
        }
    except Exception:
        return {"ok": 0, "err": 0}


async def get_all_counters_today() -> dict[str, dict[str, int]]:
    """Get today's ok/err counts for all known collectors."""
    result: dict[str, dict[str, int]] = {}
    for collector in ALL_COLLECTORS:
        result[collector] = await get_counters(collector)
    return result
