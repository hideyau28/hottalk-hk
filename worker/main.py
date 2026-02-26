from __future__ import annotations

import structlog
from fastapi import FastAPI, Request, Response

from worker.collectors.google_trends import collect_google_trends
from worker.utils.qstash_verify import verify_qstash_signature

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger()

app = FastAPI(title="HotTalk HK AI Worker", version="1.0.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/jobs/collect-google-trends")
async def job_collect_google_trends(request: Request) -> dict:
    is_valid = await verify_qstash_signature(request)
    if not is_valid:
        return Response(content="Unauthorized", status_code=401)

    result = await collect_google_trends()
    logger.info("job_completed", job="collect-google-trends", result=result)
    return result
