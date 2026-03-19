"""Monitoring stubs — Redis removed for MVP.

Counters are tracked via scrape_runs table instead.
These functions are kept as no-ops so callers don't break.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger()


async def record_ok(collector: str) -> None:
    """Log success. Actual tracking is via scrape_runs table."""
    logger.info("collector_ok", collector=collector)


async def record_error(collector: str, error_msg: str = "") -> None:
    """Log error. Actual tracking is via scrape_runs table."""
    logger.warning("collector_error", collector=collector, error_msg=error_msg[:200])


async def get_consecutive_failures(collector: str) -> int:
    """No longer tracked in Redis. Returns 0."""
    return 0
