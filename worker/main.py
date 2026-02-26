from __future__ import annotations

import asyncio
import traceback
from datetime import datetime, timezone

import structlog
from fastapi import FastAPI, Request, Response

from worker.collectors.google_trends import collect_google_trends
from worker.jobs.incremental_assign import run_incremental_assign
from worker.jobs.nightly_recluster import run_nightly_recluster
from worker.utils.alerting import (
    check_and_alert_collector,
    check_lihkg_degradation,
    check_zero_topics,
)
from worker.utils.heat_score import update_platform_daily_stats
from worker.utils.monitoring import record_error, record_ok
from worker.utils.qstash_verify import verify_qstash_signature
from worker.utils.supabase_client import get_supabase_client

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger()

app = FastAPI(title="HotTalk HK AI Worker", version="2.0.0")

# Timeout for all jobs: 5 minutes
JOB_TIMEOUT_SECONDS = 300


def _create_job_run(collector_name: str, platform: str = "all") -> str | None:
    """Create a scrape_runs record for a job. Returns run_id or None."""
    try:
        supabase = get_supabase_client()
        result = supabase.table("scrape_runs").insert({
            "collector_name": collector_name,
            "platform": platform,
            "status": "running",
        }).execute()
        return result.data[0]["id"] if result.data else None
    except Exception as e:
        logger.warning("create_job_run_failed", collector=collector_name, error=str(e))
        return None


def _finalize_job_run(
    run_id: str | None,
    start_time: datetime,
    status: str,
    error_message: str | None = None,
    extra: dict | None = None,
) -> None:
    """Update a scrape_runs record with completion status."""
    if not run_id:
        return
    try:
        supabase = get_supabase_client()
        duration = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        fields: dict = {
            "status": status,
            "duration_ms": duration,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if error_message:
            fields["error_message"] = error_message[:1000]
        if extra:
            fields.update(extra)
        supabase.table("scrape_runs").update(fields).eq("id", run_id).execute()
    except Exception as e:
        logger.warning("finalize_job_run_failed", run_id=run_id, error=str(e))


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check with DB connectivity test."""
    try:
        supabase = get_supabase_client()
        supabase.table("scrape_runs").select("id").limit(1).execute()
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        logger.error("health_check_db_failed", error=str(e))
        return {"status": "degraded", "db": "disconnected"}


@app.post("/jobs/collect-google-trends")
async def job_collect_google_trends(request: Request) -> dict | Response:
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    collector = "google_trends_collector"
    try:
        result = await asyncio.wait_for(
            collect_google_trends(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        await record_ok(collector)
        await check_and_alert_collector(collector, success=True)
        logger.info("job_completed", job="collect-google-trends", result=result)
        return result
    except asyncio.TimeoutError:
        await record_error(collector, "Job timed out after 5 minutes")
        await check_and_alert_collector(collector, success=False)
        logger.error("job_timeout", job="collect-google-trends")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        await record_error(collector, str(e))
        await check_and_alert_collector(collector, success=False)
        logger.error("job_failed", job="collect-google-trends", error=str(e))
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/incremental-assign")
async def job_incremental_assign(request: Request) -> dict | Response:
    """Incremental topic assignment — triggered every 10 min by QStash."""
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    collector = "incremental_assign"
    start_time = datetime.now(timezone.utc)
    run_id = _create_job_run(collector)

    try:
        result = await asyncio.wait_for(
            run_incremental_assign(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        await record_ok(collector)
        await check_and_alert_collector(collector, success=True)
        _finalize_job_run(run_id, start_time, "success", extra={
            "posts_fetched": result.get("posts_processed", 0),
            "posts_new": result.get("new_topics", 0),
        })
        logger.info("job_completed", job="incremental-assign", result=result)

        # Periodic checks after incremental assign
        await check_zero_topics()
        await check_lihkg_degradation()

        return result
    except asyncio.TimeoutError:
        await record_error(collector, "Job timed out after 5 minutes")
        await check_and_alert_collector(collector, success=False)
        _finalize_job_run(run_id, start_time, "failed", error_message="Timeout after 5 minutes")
        logger.error("job_timeout", job="incremental-assign")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        await record_error(collector, str(e))
        await check_and_alert_collector(collector, success=False)
        _finalize_job_run(run_id, start_time, "failed", error_message=str(e))
        logger.error("job_failed", job="incremental-assign", error=str(e), tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/nightly-recluster")
async def job_nightly_recluster(request: Request) -> dict | Response:
    """Nightly HDBSCAN recluster — triggered daily at 02:00 HKT by QStash."""
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    collector = "nightly_recluster"
    start_time = datetime.now(timezone.utc)
    run_id = _create_job_run(collector)

    try:
        result = await asyncio.wait_for(
            run_nightly_recluster(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        await record_ok(collector)
        await check_and_alert_collector(collector, success=True)
        _finalize_job_run(run_id, start_time, "success", extra={
            "posts_fetched": result.get("total_posts", 0),
            "posts_new": result.get("new_topics", 0),
        })
        logger.info("job_completed", job="nightly-recluster", result=result)
        return result
    except asyncio.TimeoutError:
        await record_error(collector, "Job timed out after 5 minutes")
        await check_and_alert_collector(collector, success=False)
        _finalize_job_run(run_id, start_time, "failed", error_message="Timeout after 5 minutes")
        logger.error("job_timeout", job="nightly-recluster")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        await record_error(collector, str(e))
        await check_and_alert_collector(collector, success=False)
        _finalize_job_run(run_id, start_time, "failed", error_message=str(e))
        logger.error("job_failed", job="nightly-recluster", error=str(e), tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/update-daily-stats")
async def job_update_daily_stats(request: Request) -> dict | Response:
    """Update platform daily stats — triggered daily at 04:00 HKT by QStash."""
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    try:
        result = await asyncio.wait_for(
            update_platform_daily_stats(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        logger.info("job_completed", job="update-daily-stats", result=result)
        return result
    except asyncio.TimeoutError:
        logger.error("job_timeout", job="update-daily-stats")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        logger.error("job_failed", job="update-daily-stats", error=str(e), tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)
