"""Internal-auth dependency (Worker -> AI Engine boundary).

Service tokens, compared in constant time. Only `X-Internal-Token` requests
reach generation endpoints.
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Request

from app.api.container import Container


def require_internal_token(request: Request, x_internal_token: str = Header(default="")) -> None:
    container: Container = request.app.state.container
    expected = container.settings.internal_token
    if not expected or not hmac.compare_digest(x_internal_token.strip(), expected):
        raise HTTPException(status_code=401, detail="invalid or missing internal token")