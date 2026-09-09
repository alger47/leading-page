"""Internal HTTP routes for the AI Engine service.

- GET  /healthz                        public liveness + readiness probes
- POST /internal/v1/generate           run the generation pipeline (authenticated)
- GET  /internal/v1/ledger/{job_id}    job report incl. per-stage attempts/cost (authenticated)
- GET  /internal/v1/prompts            registered prompt assets (authenticated)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.container import Container
from app.api.deps import require_internal_token
from app.core.errors import BriefValidationError

router = APIRouter()


class JobRequest(BaseModel):
    brief: str = Field(min_length=1, max_length=1_000_000)
    locale: str | None = Field(default=None, pattern="^(ar|fr|en)$")
    tone: str | None = None
    job_id: str | None = Field(default=None, pattern="^[a-zA-Z0-9-_]{1,64}$")
    budget_usd: float | None = Field(default=None, gt=0)


def _container(request: Request) -> Container:
    return request.app.state.container


@router.get("/healthz")
async def healthz(request: Request) -> dict:
    container = _container(request)
    return {
        "status": "ok",
        "service": container.settings.service_name,
        "version": container.settings.version,
        "env": container.settings.env,
        "checks": {
            "schemas": container.schemas.count(),
            "prompts": len(container.prompts.names()),
            "stages": len(container.routing.stages),
        },
    }


@router.post("/internal/v1/generate", dependencies=[Depends(require_internal_token)])
async def generate(request: Request, body: JobRequest) -> dict:
    container = _container(request)
    try:
        job = await container.pipeline.run(
            brief=body.brief,
            locale=body.locale,
            tone=body.tone,
            job_id=body.job_id,
            budget_usd=body.budget_usd,
        )
    except BriefValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc
    payload = job.to_dict()
    container.jobs.put(job.job_id, payload)
    return {"job": payload}


@router.get("/internal/v1/ledger/{job_id}", dependencies=[Depends(require_internal_token)])
async def ledger(request: Request, job_id: str) -> dict:
    container = _container(request)
    record = container.jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found in in-memory store")
    return record


@router.get("/internal/v1/pages/{job_id}", dependencies=[Depends(require_internal_token)])
async def page(job_id: str, request: Request) -> dict:
    """Assembled Page Schema for a job (renderer/preview input, Phase 5)."""
    container = _container(request)
    record = container.jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found in in-memory store")
    return {
        "job_id": job_id,
        "status": record.get("status"),
        "page": record.get("page"),
        "page_validation": record.get("page_validation"),
        "build_issues": record.get("build_issues"),
    }


@router.get("/internal/v1/prompts", dependencies=[Depends(require_internal_token)])
async def prompts(request: Request) -> dict:
    container = _container(request)
    return {"refs": container.prompts.refs()}