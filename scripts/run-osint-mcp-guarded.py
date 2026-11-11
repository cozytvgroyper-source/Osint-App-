"""Start the bundled Open OSINT MCP server with Host-header checking.

The server (osint-mcp, built on FastMCP 3.x) accepts any Host header, so a DNS-rebinding website could
pose as 127.0.0.1 and call its tools from the browser. FastMCP 3.x has no setting for this, so this wrapper
adds Starlette's TrustedHostMiddleware to the HTTP app before handing over to osint-mcp's own command line.
Requests must name this Mac (127.0.0.1 or localhost); anything else gets HTTP 400.

Usage, from the osint-mcp project folder: uv run python run-osint-mcp-guarded.py --transport http ...
"""

import sys

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
_original_http_app = FastMCP.http_app


def _http_app_with_host_check(self, *args, middleware=None, **kwargs):
    guarded = [Middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS), *(middleware or [])]
    return _original_http_app(self, *args, middleware=guarded, **kwargs)


FastMCP.http_app = _http_app_with_host_check

from osint_mcp.server import main  # noqa: E402  (must be imported after the patch)

if __name__ == "__main__":
    sys.exit(main())
