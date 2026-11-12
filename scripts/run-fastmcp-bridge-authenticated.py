"""Run FastMCP's config bridge with a per-launch bearer token on every HTTP route."""

import hmac
import os

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.responses import JSONResponse


class LocalBearerAuthMiddleware:
    def __init__(self, app, token):
        self.app = app
        self.token = token.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = {key.lower(): value for key, value in scope.get("headers", [])}
            supplied = headers.get(b"authorization", b"")
            expected = b"Bearer " + self.token
            if not hmac.compare_digest(supplied, expected):
                await JSONResponse({"error": "Authentication required"}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


token = os.environ.get("PUBLIC_DESK_TOKEN", "")
if len(token) < 32:
    raise RuntimeError("PUBLIC_DESK_TOKEN must be set to a strong per-launch token")

original_http_app = FastMCP.http_app


def authenticated_http_app(self, *args, middleware=None, **kwargs):
    protected = [Middleware(LocalBearerAuthMiddleware, token=token), *(middleware or [])]
    return original_http_app(self, *args, middleware=protected, **kwargs)


FastMCP.http_app = authenticated_http_app

from fastmcp.cli import app  # noqa: E402

app()
