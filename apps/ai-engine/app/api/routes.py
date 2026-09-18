"""Internal HTTP routes for the AI Engine service.

- GET  /healthz                        public liveness + readiness probes
- POST /internal/v1/generate           run the generation pipeline (authenticated)
- POST /internal/v1/regenerate-section run ONE-section regeneration (authenticated)
- GET  /internal/v1/assets/{job_id}/{ref}  generated raster bytes, ephemeral (authenticated)
- GET  /internal/v1/ledger/{job_id}    job report incl. per-stage attempts/cost (authenticated)
- GET  /internal/v1/prompts            registered prompt assets (authenticated)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.api.container import Container
from app.api.deps import require_internal_token
from app.core.errors import BriefValidationError

router = APIRouter()


class JobRequest(BaseModel):
    brief: str = Field(min_length=1, max_length=4_000)
    locale: str | None = Field(default=None, pattern="^(ar|fr|en)$")
    tone: str | None = None
    job_id: str | None = Field(default=None, pattern="^[a-zA-Z0-9-_]{1,64}$")
    budget_usd: float | None = Field(default=None, gt=0)
    # Stage 6 asset-renderer opt-in. The engine feature itself stays OFF until
    # AI_IMAGE_PROVIDER + credentials are configured (asset_renderer.enabled()).
    generate_images: bool = False


class RegenerateSectionRequest(BaseModel):
    """Phase 8 / §11.3 section-level regeneration (J2). Carries the CURRENT
    Page Schema from the web DB; only the target section is regenerated."""

    brief: str = Field(min_length=1, max_length=4_000)
    target_section_id: str = Field(min_length=1, max_length=64)
    page: dict
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
            generate_images=body.generate_images,
        )
    except BriefValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc
    payload = job.to_dict()
    container.jobs.put(job.job_id, payload)
    return {"job": payload}


@router.post("/internal/v1/regenerate-section", dependencies=[Depends(require_internal_token)])
async def regenerate_section(request: Request, body: RegenerateSectionRequest) -> dict:
    container = _container(request)
    job = await container.regenerator.run(
        job_id=body.job_id,
        brief=body.brief,
        page=body.page,
        target_section_id=body.target_section_id,
        locale=body.locale,
        tone=body.tone,
        budget_usd=body.budget_usd,
    )
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


@router.get("/internal/v1/assets/{job_id}/{ref}", dependencies=[Depends(require_internal_token)])
async def asset(request: Request, job_id: str, ref: str) -> Response:
    """Generated raster bytes for a Stage 6 asset (ephemeral in-memory store).

    The web/worker fetch these once on job completion and cache them locally;
    any ref missing here (instance restarted / evicted) falls back to the
    deterministic placeholder — honest, never a broken <img>.
    """
    container = _container(request)
    entry = container.assets.get(job_id, ref)
    if entry is None:
        raise HTTPException(status_code=404, detail="asset not found in the ephemeral store")
    return Response(
        content=entry["data"],
        media_type=entry["mime"],
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/internal/v1/prompts", dependencies=[Depends(require_internal_token)])
async def prompts(request: Request) -> dict:
    container = _container(request)
    return {"refs": container.prompts.refs()}


@router.get("/internal/v1/skills", dependencies=[Depends(require_internal_token)])
async def skills(request: Request) -> dict:
    container = _container(request)
    return {
        "skills": [
            {
                "id": skill.id,
                "name": skill.name,
                "description": skill.description,
                "stages": list(skill.stages),
                "prompts": list(skill.prompts),
            }
            for skill in container.skills.all()
        ]
    }