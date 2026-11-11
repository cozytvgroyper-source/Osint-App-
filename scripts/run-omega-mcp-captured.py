"""Start omega-mcp with each tool's printed output captured and returned as its result.

omega-mcp runs omega-cli modules in its own process and talks MCP over stdio. Most modules print their findings
(Rich tables) and return nothing, so two things go wrong: the printed lines land on stdout, where the bridge
rejects them as invalid JSON-RPC, and the tool result is only {"status": "ok", "result": "completed"}.

Every omega-mcp tool calls server._run_omega_module, so this wrapper replaces that one helper: it redirects
stdout while the module runs and, when the module returned nothing, returns the printed text instead of
"completed". Structured results and errors pass through unchanged; printed output never reaches stdout.

Usage (see config/omega-mcp.json): uvx --from <omega-mcp-server> --with <omega-cli> ... python run-omega-mcp-captured.py
"""

import contextlib
import io
import os
import re
import sys

MAX_OUTPUT_CHARS = 20000
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _clean(text):
    lines = [line.rstrip() for line in _ANSI.sub("", text).splitlines()]
    cleaned = "\n".join(lines).strip("\n")
    if len(cleaned) > MAX_OUTPUT_CHARS:
        cleaned = cleaned[:MAX_OUTPUT_CHARS] + "\n… (output truncated)"
    return cleaned


def capture_module_output(run_module):
    def run_captured(module_path, func_name, *args, **kwargs):
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            result = run_module(module_path, func_name, *args, **kwargs)
        output = _clean(printed.getvalue())
        if output and result == {"status": "ok", "result": "completed"}:
            return {"status": "ok", "result": output}
        return result

    return run_captured


def main():
    # Rich sizes tables from COLUMNS when output is not a terminal; 80 columns truncates most cells.
    os.environ.setdefault("COLUMNS", "160")
    from omega_mcp_server import server

    server._run_omega_module = capture_module_output(server._run_omega_module)
    return server.main()


if __name__ == "__main__":
    sys.exit(main())
