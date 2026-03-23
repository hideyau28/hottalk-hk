from __future__ import annotations

import asyncio
import importlib
import traceback
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import FastAPI, Response

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger()

# ---------------------------------------------------------------------------
# Lazy imports — if a job module has a broken dependency the other routes
# still load and /debug/imports surfaces the exact error.
# ---------------------------------------------------------------------------
_LAZY_MODULES: dict[str, str] = {
    "collect_google_trends": "collectors.google_trends",
    "incremental_assign": "jobs.incremental_assign",
    "daily_brief": "jobs.daily_brief",
    "nightly_recluster": "jobs.nightly_recluster",
}

_import_errors: dict[str, str] = {}


def _lazy_import(module_key: str, attr: str) -> Any:
    """Import *attr* from the module registered under *module_key*.

    Raises RuntimeError with the original traceback if the import failed.
    """
    mod_path = _LAZY_MODULES[module_key]
    try:
        mod = importlib.import_module(mod_path)
        return getattr(mod, attr)
    except Exception as e:
        tb = traceback.format_exc()
        _import_errors[module_key] = tb
        logger.error("lazy_import_failed", module=mod_path, error=str(e))
        raise RuntimeError(f"Failed to import {mod_path}.{attr}: {e}") from e


# Eagerly try imports at startup so errors are logged immediately,
# but don't let failures prevent the app from starting.
for _key, _mod_path in _LAZY_MODULES.items():
    try:
        importlib.import_module(_mod_path)
    except Exception as _e:
        _import_errors[_key] = traceback.format_exc()
        logger.error("startup_import_failed", module=_mod_path, error=str(_e),
                      tb=traceback.format_exc())

from utils.supabase_client import get_supabase_client  # noqa: E402 — always needed

app = FastAPI(title="HotTalk HK AI Worker", version="2.2.0")

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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

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


@app.get("/debug/imports")
async def debug_imports() -> dict[str, Any]:
    """Show import status for every job module — surfaces hidden errors."""
    results: dict[str, Any] = {}
    for key, mod_path in _LAZY_MODULES.items():
        if key in _import_errors:
            results[key] = {"status": "error", "module": mod_path,
                            "traceback": _import_errors[key]}
        else:
            try:
                importlib.import_module(mod_path)
                results[key] = {"status": "ok", "module": mod_path}
            except Exception as e:
                results[key] = {"status": "error", "module": mod_path,
                                "traceback": traceback.format_exc()}
    return {"import_errors_at_startup": len(_import_errors), "modules": results}


@app.get("/debug/embed-test")
async def debug_embed_test() -> dict[str, Any]:
    """Test embedding API with a single string — returns result or exact error."""
    try:
        import os
        from google import genai

        client = genai.Client(api_key=os.environ.get("GOOGLE_AI_API_KEY", "NOT_SET"))
        response = client.models.embed_content(
            model="embedding-001",
            contents="Hello world test",
        )
        vec = response.embeddings[0].values
        return {
            "status": "ok",
            "vector_dim": len(vec),
            "first_5": vec[:5],
            "sdk_version": getattr(genai, "__version__", "unknown"),
        }
    except Exception as e:
        return {
            "status": "error",
            "error_type": type(e).__name__,
            "error_message": str(e),
            "traceback": traceback.format_exc(),
        }


@app.get("/debug/list-models")
async def debug_list_models():
    """List all available Gemini model names."""
    from google import genai
    import os

    client = genai.Client(api_key=os.environ["GOOGLE_AI_API_KEY"])
    models = []
    for model in client.models.list():
        models.append(model.name)
    return {"models": models}


@app.post("/jobs/collect-google-trends")
async def job_collect_google_trends():
    try:
        collect_google_trends = _lazy_import("collect_google_trends", "collect_google_trends")
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
        logger.error("job_failed", job="collect-google-trends", error=str(e),
                      tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/incremental-assign")
async def job_incremental_assign():
    """Incremental topic assignment — triggered every 10 min by Vercel Cron."""
    collector = "incremental_assign"
    start_time = datetime.now(timezone.utc)
    run_id = _create_job_run(collector)

    try:
        run_incremental_assign = _lazy_import("incremental_assign", "run_incremental_assign")
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
        logger.error("job_failed", job="incremental-assign", error=str(e),
                      tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/nightly-recluster")
async def job_nightly_recluster():
    """Nightly HDBSCAN recluster — triggered daily at 02:00 HKT."""
    collector = "nightly_recluster"
    start_time = datetime.now(timezone.utc)
    run_id = _create_job_run(collector)

    try:
        run_nightly_recluster = _lazy_import("nightly_recluster", "run_nightly_recluster")
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
        logger.error("job_failed", job="nightly-recluster", error=str(e),
                      tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)


@app.post("/jobs/daily-brief")
async def job_daily_brief():
    """Generate daily brief — triggered daily at 12:00 HKT."""
    try:
        generate_daily_brief = _lazy_import("daily_brief", "generate_daily_brief")
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
        logger.error("job_failed", job="daily-brief", error=str(e),
                      tb=traceback.format_exc())
        return Response(content=f"Internal error: {e}", status_code=500)
