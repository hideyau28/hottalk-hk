from __future__ import annotations

import asyncio
import traceback
from datetime import datetime, timezone

import structlog
from fastapi import FastAPI, Request, Response

from collectors.google_trends import collect_google_trends
from jobs.incremental_assign import run_incremental_assign
from jobs.daily_brief import generate_daily_brief
from jobs.nightly_recluster import run_nightly_recluster
from utils.supabase_client import get_supabase_client

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger()

app = FastAPI(title="HotTalk HK AI Worker", version="2.1.0")

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
async def job_collect_google_trends() -> dict | Response:
    collector = "google_trends_collector"
    try:
        result = await asyncio.wait_for(
            collect_google_trends(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        logger.info("job_completed", job="collect-google-trends", result=result)
        return result
    except asyncio.TimeoutError:
        logger.error("job_timeout", job="collect-google-trends")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        logger.error("job_failed", job="collect-google-trends", error=str(e))
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/incremental-assign")
async def job_incremental_assign() -> dict | Response:
    """Incremental topic assignment — triggered every 10 min by Vercel Cron."""
    collector = "incremental_assign"
    start_time = datetime.now(timezone.utc)
    run_id = _create_job_run(collector)

    try:
        result = await asyncio.wait_for(
            run_incremental_assign(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        _finalize_job_run(run_id, start_time, "success", extra={
            "posts_fetched": result.get("posts_processed", 0),
            "posts_new": result.get("new_topics", 0),
        })
        logger.info("job_completed", job="incremental-assign", result=result)
        return result
    except asyncio.TimeoutError:
        _finalize_job_run(run_id, start_time, "failed", error_message="Timeout after 5 minutes")
        logger.error("job_timeout", job="incremental-assign")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        _finalize_job_run(run_id, start_time, "failed", error_message=str(e))
        logger.error("job_failed", job="incremental-assign", error=str(e), tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/nightly-recluster")
async def job_nightly_recluster() -> dict | Response:
    """Nightly HDBSCAN recluster — triggered daily at 02:00 HKT."""
    collector = "nightly_recluster"
    start_time = datetime.now(timezone.utc)
    run_id = _create_job_run(collector)

    try:
        result = await asyncio.wait_for(
            run_nightly_recluster(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        _finalize_job_run(run_id, start_time, "success", extra={
            "posts_fetched": result.get("total_posts", 0),
        })
        logger.info("job_completed", job="nightly-recluster", result=result)
        return result
    except asyncio.TimeoutError:
        _finalize_job_run(run_id, start_time, "failed", error_message="Timeout after 5 minutes")
        logger.error("job_timeout", job="nightly-recluster")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        _finalize_job_run(run_id, start_time, "failed", error_message=str(e))
        logger.error("job_failed", job="nightly-recluster", error=str(e), tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/daily-brief")
async def job_daily_brief() -> dict | Response:
    """Generate daily brief — triggered daily at 12:00 HKT."""
    collector = "daily_brief"
    try:
        result = await asyncio.wait_for(
            generate_daily_brief(),
            timeout=JOB_TIMEOUT_SECONDS,
        )
        logger.info("job_completed", job="daily-brief", result=result)
        return result
    except asyncio.TimeoutError:
        logger.error("job_timeout", job="daily-brief")
        return Response(content="Job timed out", status_code=504)
    except Exception as e:
        logger.error("job_failed", job="daily-brief", error=str(e), tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)
