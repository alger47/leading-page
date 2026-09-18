"""Stage 6 asset-renderer + image providers tests.

Covers: feature gating (off / stub), deterministic manifest+blobs, bounded
per-image failure that NEVER fails the job (E-IMG-001 → placeholder), manifest
exposure in the job envelope, and Hugging Face HTTP behavior via MockTransport.
"""

from __future__ import annotations

import asyncio

import httpx

from app.providers.image_providers import HuggingFaceImageProvider
from app.providers.protocol import ImageResult
from app.providers.stub import StubImageProvider
from app.services.asset_renderer import IMAGE_ISSUE_RULE, IMAGE_STAGE

PNG_BYTES = b"\x89PNG\r\n\x1a\nfakepngdata"
REQS = [
    {"id": "hero-saas", "kind": "image", "subject": "modern saas dashboard", "orientation": "landscape"},
    {"id": "feat-illustration", "kind": "illustration", "subject": "onboarding illustration", "orientation": "square"},
    {"id": "icon-close", "kind": "icon", "subject": "close icon", "orientation": "square"},
]


class FailingImageProvider:
    name = "failing"

    async def generate(self, *, prompt: str, size: str) -> ImageResult:
        return ImageResult(ok=False, message="vendor down (simulated)", model="fake-model", latency_ms=1.0)


def _stub_settings():
    from app.config import Settings

    settings = Settings()
    settings.image_provider = "stub"
    return settings


def test_stub_image_provider_small_deterministic_png():
    provider = StubImageProvider()
    res = asyncio.run(provider.generate(prompt="x", size="1024x1024"))
    assert res.ok is True
    assert res.data and res.data.startswith(b"\x89PNG")
    assert res.mime == "image/png"


def test_asset_renderer_off_by_default_and_images_section_declared():
    from app.config import Settings
    from app.routing.config import RoutingConfig
    from app.services.asset_renderer import AssetRenderer

    settings = Settings()  # image_provider defaults to "off"
    routing_cfg = RoutingConfig.from_path(settings.routing_config_path)
    renderer = AssetRenderer(routing=routing_cfg, settings=settings, providers=None)  # type: ignore[arg-type]
    assert renderer.enabled() is False
    assert routing_cfg.images  # the images: section IS declared (config parity)


def test_asset_renderer_stub_generates_manifest_and_blobs():
    from app.api.container import build_container
    from app.cost.ledger import JobLedger

    container = build_container(settings=_stub_settings())
    ledger = JobLedger(container.routing, container.settings, 1.0)
    stage, blobs = asyncio.run(container.images.render(requirements=REQS, tone="warm-professional", ledger=ledger))

    assert stage.ok is True
    assert stage.stage == IMAGE_STAGE
    assert stage.issues == []
    images = (stage.data or {}).get("images") or []
    assert len(images) == 2  # hero + illustration; the icon requirement is skipped
    assert all(e["ref"].startswith("asset:") for e in images)
    assert len(blobs) == 2
    for blob in blobs:
        assert blob["data"].startswith(b"\x89PNG")
        assert blob["mime"] == "image/png"
        container.assets.put("job-x", blob["ref"], blob["mime"], blob["data"])
    assert container.assets.get("job-x", "asset:hero-saas") is not None
    assert len(stage.attempts) == 2
    assert all(a.outcome.value == "ok" for a in stage.attempts)


def test_asset_renderer_image_failure_keeps_stage_ok_and_issues():
    from app.api.container import build_container
    from app.cost.ledger import JobLedger

    container = build_container(settings=_stub_settings())
    container.providers.force_image_for_tests(FailingImageProvider())
    ledger = JobLedger(container.routing, container.settings, 1.0)
    stage, blobs = asyncio.run(container.images.render(requirements=REQS, tone=None, ledger=ledger))

    assert stage.ok is True  # bounded failure never fails the stage/job
    assert stage.draft is True
    assert blobs == []
    assert (stage.data or {}).get("images") == []
    assert len(stage.issues) == 2
    assert all(i["ruleId"] == IMAGE_ISSUE_RULE for i in stage.issues)
    assert all(a.outcome.value == "provider_error" for a in stage.attempts)
    assert all(a.cost_usd == 0.0 for a in stage.attempts)


def test_pipeline_completes_with_generated_images():
    from fastapi.testclient import TestClient

    from app.api.container import build_container
    from app.main import create_app

    container = build_container(settings=_stub_settings())
    app = create_app(container=container)
    with TestClient(app) as client:
        res = client.post(
            "/internal/v1/generate",
            headers={"X-Internal-Token": "dev-internal-token"},
            json={"brief": "Boutique hotel near the old town. Target: couples for a relaxing weekend.", "generate_images": True},
        )
    assert res.status_code == 200, res.text
    job = res.json()["job"]
    assert job["status"] == "COMPLETED"
    stage_names = [s["stage"] for s in job["stages"]]
    assert IMAGE_STAGE in stage_names
    renderer_stage = next(s for s in job["stages"] if s["stage"] == IMAGE_STAGE)
    assert renderer_stage["ok"] is True
    assert job["assets"] and all(a["ref"].startswith("asset:") for a in job["assets"])
    # Generated bytes landed in the ephemeral engine store.
    assert container.assets.get(job["job_id"], job["assets"][0]["ref"]) is not None


def test_generate_images_opt_out_skips_stage():
    from fastapi.testclient import TestClient

    from app.api.container import build_container
    from app.main import create_app

    container = build_container(settings=_stub_settings())
    app = create_app(container=container)
    with TestClient(app) as client:
        res = client.post(
            "/internal/v1/generate",
            headers={"X-Internal-Token": "dev-internal-token"},
            json={"brief": "Boutique hotel near the old town. Target: couples for a relaxing weekend."},
        )
    job = res.json()["job"]
    assert job["status"] == "COMPLETED"
    assert IMAGE_STAGE not in [s["stage"] for s in job["stages"]]
    assert job["assets"] == []


def test_hf_image_provider_ok_bytes():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/FLUX-test")
        assert request.headers.get("x-wait-for-model") == "true"
        assert request.headers.get("authorization") == "Bearer tok"
        return httpx.Response(200, content=PNG_BYTES, headers={"content-type": "image/png"})

    provider = HuggingFaceImageProvider(token="tok", model="FLUX-test", transport=httpx.MockTransport(handler))
    res = asyncio.run(provider.generate(prompt="a cat", size="512x512"))
    assert res.ok is True
    assert res.data == PNG_BYTES
    assert res.mime == "image/png"
    assert res.latency_ms >= 0.0


def test_hf_image_provider_error_message():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "Model loading, wait a bit"})

    provider = HuggingFaceImageProvider(token="tok", model="FLUX-test", transport=httpx.MockTransport(handler))
    res = asyncio.run(provider.generate(prompt="a cat", size="512x512"))
    assert res.ok is False
    assert res.data is None
    assert "Model loading" in res.message


def test_hf_image_provider_network_failure_is_bounded():
    def handler(_request: httpx.Request) -> httpx.Response:
        raise RuntimeError("connection refused")

    provider = HuggingFaceImageProvider(token="tok", model="FLUX-test", transport=httpx.MockTransport(handler))
    res = asyncio.run(provider.generate(prompt="a cat", size="512x512"))
    assert res.ok is False
    assert res.data is None
