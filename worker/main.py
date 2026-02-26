from __future__ import annotations

import traceback

import structlog
from fastapi import FastAPI, Request, Response

from worker.collectors.google_trends import collect_google_trends
from worker.jobs.incremental_assign import run_incremental_assign
from worker.jobs.nightly_recluster import run_nightly_recluster
from worker.utils.heat_score import update_platform_daily_stats
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

    result = await collect_google_trends()
    logger.info("job_completed", job="collect-google-trends", result=result)
    return result


@app.post("/jobs/incremental-assign")
async def job_incremental_assign(request: Request) -> dict | Response:
    """Incremental topic assignment — triggered every 10 min by QStash."""
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    try:
        result = await run_incremental_assign()
        logger.info("job_completed", job="incremental-assign", result=result)
        return result
    except Exception as e:
        logger.error("job_failed", job="incremental-assign", error=str(e), tb=traceback.format_exc())
        return Response(
            content=f"Internal error: {e}",
            status_code=500,
        )


@app.post("/jobs/nightly-recluster")
async def job_nightly_recluster(request: Request) -> dict | Response:
    """Nightly HDBSCAN recluster — triggered daily at 02:00 HKT by QStash."""
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    try:
        result = await run_nightly_recluster()
        logger.info("job_completed", job="nightly-recluster", result=result)
        return result
    except Exception as e:
        logger.error("job_failed", job="nightly-recluster", error=str(e), tb=traceback.format_exc())
        return Response(
            content=f"Internal error: {e}",
            status_code=500,
        )


@app.post("/jobs/update-daily-stats")
async def job_update_daily_stats(request: Request) -> dict | Response:
    """Update platform daily stats — triggered daily at 04:00 HKT by QStash."""
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    try:
        result = await update_platform_daily_stats()
        logger.info("job_completed", job="update-daily-stats", result=result)
        return result
    except Exception as e:
        logger.error("job_failed", job="update-daily-stats", error=str(e), tb=traceback.format_exc())
        return Response(
            content=f"Internal error: {e}",
            status_code=500,
        )
