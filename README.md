# Public Desk

A local-first, user-friendly client for MCP servers and Open OSINT workflows.

## Run

For a fresh checkout, install the pinned local dependencies once:

```bash
npm run setup
```

The setup script checks out the exact Open OSINT revision named in `config/open-osint.env`, installs its locked Node and Python dependencies under `work/dependencies/`, and applies Public Desk's reviewed patches. It requires Node 22 or newer, Git, npm, and `uv`.

### Menu-bar controller (recommended)

Build and install the menu-bar app once (it needs only Apple's free command line tools, `xcode-select --install`;
no Apple developer account):

```bash
npm run menu-bar
```

This puts **Public Desk.app** in `~/Applications` and opens it. Its icon is the "P" brand mark from the app's sidebar,
drawn from code in `macos/Icon/DrawIcon.swift` when the app is built; a test keeps it in step with the mark's styles. A magnifying-glass icon appears in the menu bar:

| Icon | Meaning |
|---|---|
| Green | All five services are ready |
| Yellow | Starting, stopping, restarting, or only some services are ready |
| Red | Stopped, or a start, stop or service failed |

Its menu has **Open Public Desk** (starts anything missing, then opens it), **Start**, **Stop**, **Restart**,
**Status** (each service's state), **Diagnostics** (opens the logs folder), **Start at Login**, and **Quit Controller**.
Quitting the controller leaves the services running. It checks status every 10 seconds without starting or restarting
anything, and sends a notification when Public Desk is ready, when a start fails, or when a ready service stops.
If notifications for Public Desk are off in System Settings, its menu shows **Turn On Notifications…**, which opens
that setting; the controller's log (`work/logs/menu-bar.log`) records whether macOS accepted each notification.

Opening the **Public Desk** app (from Finder, Spotlight or the Dock) opens Public Desk, starting anything that is
not running, just like **Open Public Desk** in its menu; when it starts at login it only appears in the menu bar.

Only one copy of each runs: opening the app again opens Public Desk in the running copy, and opening Public Desk again brings its
open tab to the front in Safari, Chrome, Brave or Edge (macOS asks once whether Public Desk may control the browser;
if you decline, a new tab opens instead). Stopping Public Desk closes its open tabs, since they could no longer do anything; Restart keeps them
and reconnects them. Start, stop and restart run one at a time whichever launcher asked; a lock
left behind by a crash is cleared automatically. The app remembers this folder, so run `npm run menu-bar` again if you
move the folder.

The controller keeps itself up to date: when it opens, and every 15 minutes, it checks whether the app's code in
this folder has changed (after a `git pull`, say). If so it rebuilds, reinstalls and reopens itself, leaving the
services running. It never updates while Public Desk is starting or stopping. If a rebuild fails, it notifies you
once, shows **Retry Controller Update** in its menu, and logs the details to `work/logs/menu-bar.log`. Changes to
`scripts/public-desk-control.zsh` need no rebuild, because the app runs that script straight from this folder.
Copies installed before this feature need one more `npm run menu-bar`.

Keep the Public Desk folder outside **Desktop**, **Documents** and **Downloads** (for example `~/Public Desk`). macOS
asks before an app reads those folders, and because the controller is signed on this Mac rather than by a developer
account, it would ask again after every rebuild. Until the question is answered, the controller's status checks wait.

### Finder launchers

The `.command` files still work and use the same controller. Double-click **Public Desk.command**. It starts any missing
services, waits until all five are ready, opens Public Desk, and does not need its Terminal window to remain open;
opening it again reuses the running services and browser tab. When finished, double-click **Stop Public Desk.command**.
The older **Start Public Desk.command** remains as a compatible shortcut.

Every service is bound to `127.0.0.1`, so it is available only on this computer:

| Service | Address |
|---|---|
| Open OSINT data service | `http://127.0.0.1:8080` |
| Open OSINT MCP server | `http://127.0.0.1:8892/mcp` |
| OSINT Toolbox MCP bridge | `http://127.0.0.1:8893/mcp` |
| Omega MCP bridge | `http://127.0.0.1:8894/mcp` |
| Public Desk (the app) | `http://127.0.0.1:4173` |

If one MCP bridge restarts on its own, Public Desk opens a new session with it automatically.

For status, restart, or diagnostics from Terminal, use the shared controller:

```bash
zsh scripts/public-desk-control.zsh status
zsh scripts/public-desk-control.zsh status --json
zsh scripts/public-desk-control.zsh restart --open
zsh scripts/public-desk-control.zsh diagnostics --open
```

Stopping waits for each verified Public Desk process to exit. If one ignores a normal stop request, the controller
force-stops only that verified process; it never stops an unrelated process using the same port.

For a terminal launch of the interface only:

```bash
npm start
```

Use the private access address printed by `npm start`. The Mac launcher opens this address automatically. The access token remains in the URL fragment only long enough for the page to move it into tab-scoped session storage; it is never sent in a URL request or saved in localStorage.

To see why the main search chose each tool, open <http://127.0.0.1:4173/?diagnostics>. Each search then adds a
**Planner Diagnostics** section: the detected target, the words matched, the selected tools with scores, the
closest misses, and how many tools were skipped for each reason (active, too slow, wrong target type, no match).

## Connect Open OSINT

The local launcher starts the pinned `osint-mcp` data and MCP services automatically.
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

Each finding has a **status** (Unverified, Confirmed or Ruled out; new findings start Unverified, because OSINT results
are leads until checked) and a **note** for why you trust or doubt it. Both are saved in the case and shown in reports.

**Report (Markdown)** and **Report (HTML / PDF)** download a readable report of the open case: a summary table, each
finding with its source, collection and save times, full SHA-256 fingerprint and result, the search log, and how to
re-check a fingerprint. To make a PDF, open the HTML report and choose File > Print > Save as PDF.

## Security notes

- The UI is served only on `127.0.0.1` by default.
- The launcher creates an owner-only access token and requires it on every app API and bundled local-service request.
- Temporary uploads are limited to eight active files, 200 MB in aggregate, and two simultaneous requests. Deep Search audit history rotates at 1 MB.
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
