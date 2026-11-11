"""Start omega-mcp with each tool's printed output captured and returned as its result.

omega-mcp runs omega-cli modules in its own process and talks MCP over stdio. Most modules print their findings
(Rich tables) and return nothing, so two things go wrong: the printed lines land on stdout, where the bridge
rejects them as invalid JSON-RPC, and the tool result is only {"status": "ok", "result": "completed"}.

Every omega-mcp tool calls server._run_omega_module, so this wrapper replaces that one helper: it redirects
stdout while the module runs and, when the module returned nothing, returns the printed text instead of
"completed". Structured results and errors pass through unchanged; printed output never reaches stdout.

omega-cli also saves a report for most lookups under the home folder (~/.omega/reports, ~/omega-reports and
~/.config/omega-cli). Those name investigation targets, so the wrapper points HOME at work/omega-home (owner-only,
git-ignored with the rest of work/) for this process alone; uvx, which keeps its package cache under HOME, is
unaffected because it started before this script.

Usage (see config/omega-mcp.json): uvx --from <omega-mcp-server> --with <omega-cli> ... python run-omega-mcp-captured.py
"""

import contextlib
import io
import os
import pathlib
import re
import sys

MAX_OUTPUT_CHARS = 20000
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


# Terminal decoration: box-drawing and block characters (the ASCII-art banner, panel edges, rules).
_BOX = "─-╿▀-▟"
_BORDERED = re.compile(r"^\s*[│┃║]\s*(.*?)\s*[│┃║]\s*$")
_TITLED_RULE = re.compile(r"^[\s─━═=]{3,}(\S.*?)[\s─━═=]{3,}$")
_DECORATION_ONLY = re.compile(r"^[\s" + _BOX + r"=\-]*$")
# The version banner, and the report path, which would put this Mac's home folder into results and evidence.
_DROPPED = re.compile(r"^\s*(?:OMEGA-CLI v\S+ |Saved → )")


def _tidy_line(line):
    line = line.rstrip()
    if _DROPPED.match(line):
        return None
    bordered = _BORDERED.match(line)
    if bordered:
        line = bordered.group(1)
    titled = _TITLED_RULE.match(line)
    if titled:
        line = titled.group(1)
    return "" if _DECORATION_ONLY.match(line) else line


def _clean(text):
    lines = []
    for raw in _ANSI.sub("", text).splitlines():
        line = _tidy_line(raw)
        if line is None or (line == "" and (not lines or lines[-1] == "")):
            continue
        lines.append(line)
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


def use_private_home(app_dir):
    home = pathlib.Path(app_dir) / "work" / "omega-home"
    home.mkdir(parents=True, exist_ok=True)
    home.chmod(0o700)
    os.environ["HOME"] = str(home)
    return home


def main():
    use_private_home(pathlib.Path(__file__).resolve().parent.parent)
    # Rich sizes tables from COLUMNS when output is not a terminal; 80 columns truncates most cells.
    os.environ.setdefault("COLUMNS", "160")
    from omega_mcp_server import server

    server._run_omega_module = capture_module_output(server._run_omega_module)
    return server.main()


if __name__ == "__main__":
    sys.exit(main())
