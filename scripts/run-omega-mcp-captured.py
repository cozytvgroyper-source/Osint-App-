"""Start omega-mcp with each tool's printed output captured and returned as its result.

omega-mcp runs omega-cli modules in its own process and talks MCP over stdio. Most modules print their findings
(Rich tables) and return nothing, so two things go wrong: the printed lines land on stdout, where the bridge
rejects them as invalid JSON-RPC, and the tool result is only {"status": "ok", "result": "completed"}.

Every omega-mcp tool calls server._run_omega_module, so this wrapper replaces that one helper: it redirects
stdout while the module runs and, when the module returned nothing, returns the printed text instead of
"completed". Structured results and errors pass through unchanged; printed output never reaches stdout.

Some modules report a failed lookup (a rate limit, an HTTP error, a timeout) only by printing it, then return an
empty result, which would read as "nothing found". For example, omega_cve returns an empty list when the NVD refuses
a request it has rate-limited. When a result is empty and the printed output has a failure line, the wrapper returns
that line as an error instead, so a failed lookup is never mistaken for a clean one.

A few tools need a key the user keeps on Public Desk's data-sources page (work/api-keys.env): Have I Been Pwned for
omega_breach and omega_leaked, Shodan for omega_shodan. omega-mcp passes them no key and omega-cli does not read its
own settings when run this way, so without help they report "no breaches" from a check that never ran. The wrapper
reads the file on every call (so Connect and Disconnect apply at once) and passes connected keys in. Without one, a
tool that has no other source says "Not checked" instead of running, and omega_leaked lists HIBP as not checked
beside its other findings. A key the service refuses is reported the same way. Key values never appear in results.

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


# A printed line that says a lookup failed rather than found nothing.
_FAILURE = re.compile(
    r"\b(?:error|errors|rate[- ]limit(?:ed)?|failed|failure|timed out|timeout|unauthori[sz]ed|forbidden|"
    r"access denied|unavailable|exceeded)\b", re.IGNORECASE)
# omega-cli's advice to run one of its own commands (such as "omega config set nvd_api_key KEY"), which does not
# apply here: Public Desk runs the MCP tools, which do not read omega-cli's settings. It follows a dash ("NVD rate
# limit — add API key with: omega config ...") or "Set:" ("HIBP requires API key.  Set: omega config ...").
_CLI_ADVICE = re.compile(r"(?:\s+[—–-]\s+|\s+Set:\s+).*\bomega config\b.*$")


def _is_email(target):
    """leaked.py's own test for an email address: it asks Have I Been Pwned only about those."""
    return "@" in str(target)


# Omega modules that need a key from the data-sources page: the run() argument that takes it, the key's name in
# work/api-keys.env, its data source id (PUBLIC_DESK_DISABLED lists disconnected ones), whether the module has
# other sources to fall back on, and which targets the key is used for (None: every target). Keep in step with
# scripts/api-keys.mjs (a test checks).
KEYED_MODULES = {
    "omega_cli.modules.breachcheck": [("hibp_key", "HIBP_API_KEY", "hibp", False, None)],
    "omega_cli.modules.leaked": [("hibp_key", "HIBP_API_KEY", "hibp", True, _is_email)],
    "omega_cli.modules.shodan_lookup": [("api_key", "SHODAN_API_KEY", "shodan", False, None)],
}
SOURCE_NAMES = {"hibp": "Have I Been Pwned", "shodan": "Shodan"}
_KEY_LINE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
# A service that refused or never got a key, said in omega-cli's words ("HIBP requires API key", "Invalid Shodan API
# key", "Shodan API key required").
_KEY_REFUSED = re.compile(r"\b(?:requires?|required|invalid|missing)\b[^.\n]{0,30}\bAPI key\b|"
                          r"\bAPI key\b[^.\n]{0,20}\b(?:required|invalid|missing)\b", re.IGNORECASE)
# A service that gave no usable answer at all (a rate limit, a server error, a network failure), which the module
# then reports as "nothing found". breachcheck prints this line when HIBP did not answer, then says the address is in
# no known breach.
NO_ANSWER = {
    "omega_cli.modules.breachcheck": (re.compile(r"\bTrying without API key\b", re.IGNORECASE), "hibp"),
}


def key_file(app_dir):
    """work/api-keys.env, or its place under PUBLIC_DESK_WORK_DIR, resolved from the Public Desk folder as server.mjs does."""
    work = os.environ.get("PUBLIC_DESK_WORK_DIR")
    folder = pathlib.Path(work) if work else pathlib.Path(app_dir) / "work"
    if not folder.is_absolute():
        folder = pathlib.Path(app_dir) / folder
    return folder / "api-keys.env"


def connected_keys(path):
    """The keys this wrapper uses that are saved and not disconnected, read like scripts/api-keys.mjs reads them."""
    names = {env: source for entries in KEYED_MODULES.values() for _, env, source, *_ in entries}
    values, disabled = {}, set()
    try:
        text = pathlib.Path(path).read_text(encoding="utf-8")
    except OSError:
        return {}
    for line in text.splitlines():
        match = _KEY_LINE.match(line)
        if not match or line.lstrip().startswith("#"):
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        if match.group(1) == "PUBLIC_DESK_DISABLED":
            disabled.update(item.strip() for item in value.split(","))
        elif match.group(1) in names and value:
            values[match.group(1)] = value
    return {env: value for env, value in values.items() if names[env] not in disabled}


def _not_checked(source):
    return f"Not checked: {SOURCE_NAMES[source]} needs an API key. Add one under Data sources on the MCP servers page."


def _has_findings(result):
    """Whether a structured result holds anything beyond echoing its target back."""
    if isinstance(result, dict):
        return any(not _is_empty(value) and value is not False and value != 0
                   for key, value in result.items() if key not in ("target", "query", "status"))
    return not _is_empty(result)


def _is_empty(value):
    return value is None or value in ([], {}, "")


def _failure_message(output):
    lines = [_CLI_ADVICE.sub("", line).strip() for line in output.splitlines() if _FAILURE.search(line)]
    return " ".join(line for line in lines if line)[:500]


def capture_module_output(run_module, read_keys=dict):
    def run_captured(module_path, func_name, *args, **kwargs):
        keys = read_keys()
        not_checked = []
        target = args[0] if args else kwargs.get("target", "")
        for argument, env, source, has_other_sources, used_for in KEYED_MODULES.get(module_path, []):
            if used_for and not used_for(target):
                continue  # this target never needs the key, so nothing goes unchecked without it
            if keys.get(env):
                kwargs.setdefault(argument, keys[env])
            elif has_other_sources:
                not_checked.append(source)
            else:
                return {"status": "error", "error": _not_checked(source)}
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            result = run_module(module_path, func_name, *args, **kwargs)
        output = _clean(printed.getvalue())
        refused = [line.strip() for line in output.splitlines() if _KEY_REFUSED.search(line)]
        if refused and isinstance(result, dict) and result.get("status") == "ok":
            reason = "Not checked: " + _CLI_ADVICE.sub("", refused[0]).strip().rstrip(".") + "."
            if not _has_findings(result.get("result")):
                return {"status": "error", "error": reason}
            not_checked.append(reason)
        no_answer = NO_ANSWER.get(module_path)
        if (not refused and no_answer and no_answer[0].search(output)
                and isinstance(result, dict) and result.get("status") == "ok"):
            reason = (f"Not checked: {SOURCE_NAMES[no_answer[1]]} did not answer (often a rate limit). "
                      "Try again in a minute.")
            if not _has_findings(result.get("result")):
                return {"status": "error", "error": reason}
            not_checked.append(reason)
        if not_checked and isinstance(result, dict) and result.get("status") == "ok" and isinstance(result.get("result"), dict):
            result = {**result, "result": {**result["result"], "not_checked": [
                item if item.startswith("Not checked") else _not_checked(item) for item in not_checked]}}
        if output and result == {"status": "ok", "result": "completed"}:
            return {"status": "ok", "result": output}
        if isinstance(result, dict) and result.get("status") == "ok" and _is_empty(result.get("result")):
            failure = _failure_message(output)
            if failure:
                return {"status": "error", "error": failure}
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

    app_dir = pathlib.Path(__file__).resolve().parent.parent
    server._run_omega_module = capture_module_output(server._run_omega_module,
                                                    read_keys=lambda: connected_keys(key_file(app_dir)))
    return server.main()


if __name__ == "__main__":
    sys.exit(main())
