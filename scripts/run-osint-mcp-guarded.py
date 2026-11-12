"""Start the bundled Open OSINT MCP server with Host-header and bearer-token checking.

The server (osint-mcp, built on FastMCP 3.x) accepts any Host header, so a DNS-rebinding website could
pose as 127.0.0.1 and call its tools from the browser. FastMCP 3.x has no setting for this, so this wrapper
adds Starlette middleware to the HTTP app before handing over to osint-mcp's own command line. Requests
must name this Mac (127.0.0.1 or localhost) and carry the same launch token as Public Desk. This protects
custom routes such as /health as well as FastMCP's /mcp route.

Usage, from the osint-mcp project folder: uv run python run-osint-mcp-guarded.py --transport http ...
"""

import hmac
import os
import sys

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse

ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
TOKEN = os.environ.get("PUBLIC_DESK_TOKEN") or os.environ.get("OSINT_MCP_API_KEY", "")
if len(TOKEN) < 32:
    raise RuntimeError("PUBLIC_DESK_TOKEN or OSINT_MCP_API_KEY must be set to a strong launch token")


class LocalBearerAuthMiddleware:
    def __init__(self, app, token):
        self.app = app
        self.token = token.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = {key.lower(): value for key, value in scope.get("headers", [])}
            supplied = headers.get(b"authorization", b"")
            if not hmac.compare_digest(supplied, b"Bearer " + self.token):
                await JSONResponse({"error": "Authentication required"}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


_original_http_app = FastMCP.http_app


def _http_app_with_host_check(self, *args, middleware=None, **kwargs):
    guarded = [
        Middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS),
        Middleware(LocalBearerAuthMiddleware, token=TOKEN),
        *(middleware or []),
    ]
    return _original_http_app(self, *args, middleware=guarded, **kwargs)


FastMCP.http_app = _http_app_with_host_check

from osint_mcp.server import main  # noqa: E402  (must be imported after the patch)

if __name__ == "__main__":
    sys.exit(main())
