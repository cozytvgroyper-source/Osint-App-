# Public Desk

A local-first, user-friendly client for MCP servers and Open OSINT workflows.

## Run

On this Mac, double-click **Start Public Desk.command**. When finished, double-click
**Stop Public Desk.command**. The launcher starts five services, all bound to `127.0.0.1` so they are
available only on this computer:

| Service | Address |
|---|---|
| Open OSINT data service | `http://127.0.0.1:8080` |
| Open OSINT MCP server | `http://127.0.0.1:8892/mcp` |
| OSINT Toolbox MCP bridge | `http://127.0.0.1:8893/mcp` |
| Omega MCP bridge | `http://127.0.0.1:8894/mcp` |
| Public Desk (the app) | `http://127.0.0.1:4173` |

If one MCP bridge restarts on its own, Public Desk opens a new session with it automatically.

For a terminal launch of the interface only:

```bash
npm start
```

Open <http://127.0.0.1:4173>. No package installation is required.

To see why the main search chose each tool, open <http://127.0.0.1:4173/?diagnostics>. Each search then adds a
**Planner Diagnostics** section: the detected target, the words matched, the selected tools with scores, the
closest misses, and how many tools were skipped for each reason (active, too slow, wrong target type, no match).

## Connect Open OSINT

The local launcher starts the adjacent `osint-mcp` data and MCP services automatically.
Public Desk connects to:

```text
http://127.0.0.1:8892/mcp
```

Public Desk supports MCP Streamable HTTP, tool discovery, JSON-schema-assisted arguments, tool execution, local investigation history, and evidence export. Bearer tokens you enter for a server remain in browser memory and are not persisted.

The main search also accepts photos, videos, PDFs, Office documents, text, CSV, and JSON files up to 50 MB. Files are analyzed locally with the OSINT Toolbox metadata tool and removed from the temporary upload folder after each analysis.

The Mac launcher also starts the bundled OSINT Toolbox and Omega MCP bridges. Omega includes active reconnaissance utilities; run those only against systems you own or have explicit permission to test. Consensus is included as a remote academic-search server and uses its official OAuth sign-in flow. Its paper search
joins research searches automatically; `create_thread` and `add_to_thread` create threads in your Consensus account and
run its AI research agent, so they are marked with side effects and credits and run only from Tool Library. The main
search never runs a tool that its own server annotates as writing (`readOnlyHint: false` or `destructiveHint: true`).

### Omega

`config/omega-mcp.json` runs Omega through `scripts/run-omega-mcp-captured.py` with `uvx` from pinned commits of
[omega-mcp-server](https://github.com/Ekoelogan/omega-mcp-server) and its toolkit
[omega-cli](https://github.com/Ekoelogan/omega-cli), plus `mcp==1.30.0` (the server does not run on mcp 2.x).
The `omega-cli` package on PyPI is an unrelated project; do not install it. The first launch downloads
these packages and can take a minute or two, so Omega may show as offline until it finishes.
Most omega-cli modules print their findings instead of returning them; the wrapper captures that output and
returns it as the tool's result (plain text, with terminal decoration and local report paths removed).
omega-cli's saved reports, agent memory and settings go to `work/omega-home/` (owner-only, git-ignored), not your home
folder.

All Omega tools appear in Tool Library. The main search only runs Omega tools whose source was reviewed
and whose live output was useful: WHOIS, DNS, IP info, crt.sh, Wayback, CVE, ASN, malware hash, SPF/DMARC,
reverse IP, dorks, threat feeds, breach lookup, email validation, public Git repositories, the IP dossier, AlienVault OTX threat intel and CVE ranking (CVSS, EPSS, CISA KEV).
`docs/omega-tool-review.md` lists every Omega tool's tier and the reason for it. Running any other Omega tool from Tool Library can:

- probe the target directly (port scans, crawling, fuzzing, brute forcing, typosquat checks; `omega_recon`
  runs several of these at once);
- write to a public service (`omega_archive` submits the target to the Wayback Machine's Save Page Now);
- call OpenAI and spend credits if `OPENAI_API_KEY` is set (AI summary, analyst, assistant, executive);
- install software on first use (`omega_screenshot` installs Playwright and Chromium);
- send findings to a webhook (`omega_notifier`) or load third-party plugins (`omega_plugin`).

Omega reports some network failures as an empty successful result, so "no results" is not proof that
nothing exists. `omega_monitor` is not implemented in omega-cli and always fails.

## Cases

Saved findings live in **cases** (investigations) on this Mac, not in the browser: one owner-only JSON file per case in
`work/cases/`. Choose or create a case on the Evidence page; while it is open, **Save to evidence** stores results there
and each search is logged to it. Every saved finding keeps its source, time and a SHA-256 fingerprint of the raw result.
Findings saved in the browser before cases existed can be moved into a case with **Import into a new case**.

**Report (Markdown)** and **Report (HTML / PDF)** download a readable report of the open case: a summary table, each
finding with its source, collection and save times, full SHA-256 fingerprint and result, the search log, and how to
re-check a fingerprint. To make a PDF, open the HTML report and choose File > Print > Save as PDF.

## Security notes

- The UI is served only on `127.0.0.1` by default.
- Embedded URL credentials and common cloud metadata endpoints are blocked.
- Remote endpoints receive only requests explicitly initiated through the app.
- Review source terms and legal constraints before collecting or retaining OSINT data.
- The Consensus sign-in is remembered across restarts: after you sign in, its refresh token and app
  registration are saved to `work/consensus-auth.json` (git-ignored, readable only by your user). Access tokens
  stay in memory. Delete that file to sign out; it is also removed automatically if Consensus rejects it.

## License

Copyright (C) 2026 cozytvgroyper-source.

Public Desk is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General
Public License, version 3 only (`AGPL-3.0-only`), as published by the Free Software Foundation. It is distributed
without any warranty. See [LICENSE](LICENSE) for the full text.

The files in `patches/` modify Open OSINT (World Monitor), which is also licensed under `AGPL-3.0-only`. Omega, the
OSINT Toolbox and the other tools Public Desk connects to are downloaded at launch, not included here, and keep their
own licenses.
