# syntax=docker/dockerfile:1
#
# ai-engine — production image (Phase 15).
# Build from the REPO ROOT so the canonical Page Schema can be baked in:
#   docker build -f apps/ai-engine/Dockerfile -t landing-ai-engine .
#
# The engine validates every assembled page against the SAME canonical schema
# used by the TS validators (ADR-0002) — copied to /packages/page-schema/schema
# and pointed at via AI_PAGE_SCHEMA_DIR (otherwise the default relative path
# would only work inside the monorepo checkout).

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY apps/ai-engine/pyproject.toml ./
COPY apps/ai-engine/app ./app
COPY apps/ai-engine/config ./config
COPY apps/ai-engine/evaluation ./evaluation
RUN pip install --no-cache-dir .

ENV AI_PAGE_SCHEMA_DIR=/packages/page-schema/schema
COPY packages/page-schema/schema /packages/page-schema/schema

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
