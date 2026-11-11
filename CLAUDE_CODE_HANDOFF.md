# Public Desk Claude Code Handoff

## Purpose

This handoff covers the next hardening and cleanup pass for Public Desk after the whole-app review on November 11, 2026. The app is fundamentally healthy: all 101 automated tests passed, the successful-search presentation matches the owner's request, and no critical or high-severity security issue was found. The remaining work is primarily dependency safety, state durability, process ownership, response limits, temporary-file cleanup, and smaller interface corrections.

Work from the repository at:

`/Users/randybill/Documents/Codex/2026-11-10/public-desk`

Reviewed revision:

`87aa829925d7f0cc867e2ee5b706058d13c21285`

The worktree was clean when this handoff was written.

## Objective Progress

| Objective | Status | Branch | Verification |
| --- | --- | --- | --- |
| 1 Pin OSINT Toolbox | Completed | `fix/pin-osint-toolbox` | Locally resolved working package was `1.1.0`; configuration pin and regression test added; full suite passes 102 tests. |
| 2 Make browser state recoverable and bounded | Completed | `fix/browser-state-durability` | Safe typed recovery, evidence count and byte limits, quota handling, token stripping, and focused tests added; full suite passes 107 tests. |
| 3 Verify process ownership before reuse or stop | Completed | `fix/service-ownership` | Shared folder and command-marker checks cover all five ports and every saved PID; foreign-process tests added; full suite passes 111 tests. |
| 4 Bound MCP responses | Completed | `fix/mcp-response-limits` | Decoded streaming limit, early length rejection, SSE count and event limits, and boundary tests added; full suite passes 115 tests. |
| 5 Expire abandoned uploads | Completed | `fix/upload-expiration` | Thirty-minute server leases, startup stale-file sweep, private upload directory, and containment tests added; full suite passes 118 tests. |
| 6 Harden custom MCP destinations | Completed | `fix/mcp-destination-policy` | Explicit bundled-local allowlist, HTTPS-only custom servers, DNS address screening, and per-hop redirect validation added; full suite passes 123 tests. |
| Interface and documentation cleanup | Completed | `fix/interface-documentation-cleanup` | Persistent server disabling, Command K, progressive News loading, accurate privacy copy, development diagnostics, confirmations, and documentation updates completed; full suite passes 126 tests. |

## Owner Requirements

- Preserve the current result-only search presentation. When useful findings exist, show the findings and Related Links. Do not restore the search plan, counts, diagnostics, raw output, or unavailable-source errors to the ordinary completed result view.
- Preserve Related Links.
- Keep automatic search passive by default. Never auto-run active reconnaissance, side-effect tools, installers, webhook tools, paid AI calls, or unreviewed Omega tools.
- Keep the app and bundled services local-only.
- Preserve existing work and make targeted changes rather than rebuilding the application.
- Do not spend credits, run active reconnaissance, install new external tools, connect accounts, or expose credentials without explicit owner approval.
- Make changes on a new branch. Do not work directly on `main`.
- Do not commit files under `work/`, credentials, tokens, local logs, uploaded files, or generated runtime state.

## Current Verified Behavior

- `npm test` passes 101 tests with zero failures.
- Successful searches render findings plus Related Links.
- Searches in progress show Still Running.
- If useful findings exist, source errors are not shown in the completed result.
- If no useful findings exist, the actual source failures remain visible.
- Late responses from an older search cannot replace a newer search.
- Automatic search excludes active and side-effect tools.
- The Node server binds to `127.0.0.1` and applies Host, Origin, fetch-metadata, JSON-content, CSP, framing, and MIME protections.
- Consensus OAuth uses expiring state and PKCE. Access tokens remain in memory; the refresh credential is stored in a restricted local file.
- Data-source key responses and logs do not expose saved values.
- Returned tool and news data is escaped before HTML rendering. No exploitable DOM injection was found.
- Normal file analysis deletes its staged upload in a `finally` block.

## Implementation Order

### 1 Pin OSINT Toolbox

Files:

- `config/osint-toolbox-mcp.json:1-7`
- `Start Public Desk.command:50-68`
- `Start Public Desk.command:138-139`

The normal launcher executes the bare registry package `osint-toolbox-mcp` through `uvx`. Pin it to a reviewed exact release or immutable source revision. Use a checked-in lock or hash if the supported resolver provides one. Do not choose a version by guesswork: identify the currently working resolved version first, then pin that exact version.

Acceptance criteria:

- A normal launch resolves the same reviewed OSINT Toolbox implementation every time.
- The existing local bridge still starts on `127.0.0.1:8893`.
- No credentials or user-specific paths are added to version control.

### 2 Make Browser State Recoverable and Bounded

File:

- `public/app.js:15-46`

Current startup uses unguarded `JSON.parse` calls for saved servers, history, evidence, and tool health. One malformed value can stop the whole interface from loading. Evidence is also stored without a count or byte limit, and persistence does not handle storage-quota failures.

Implement a small storage layer that:

- safely parses each entry and validates its expected top-level type;
- falls back without preventing application startup;
- preserves recoverable entries where practical;
- limits evidence retention by a documented count and approximate serialized size;
- handles `QuotaExceededError` with a clear, non-destructive message;
- does not persist MCP bearer tokens;
- keeps the original `signaldesk.*` keys or includes a safe migration so existing owner data survives.

Add tests for malformed JSON, wrong stored types, quota failure, evidence limits, and preservation of valid existing data.

### 3 Verify Process Ownership Before Reuse or Stop

Files:

- `Start Public Desk.command:31-48`
- `Start Public Desk.command:86-97`
- `Start Public Desk.command:105-136`
- `Stop Public Desk.command:7-16`

The launcher verifies ownership for some bridge ports but reuses any process that returns a successful health response on ports 8080 and 8892. The stop script trusts saved PID files and can theoretically terminate an unrelated process after a stale PID is reused.

Add ownership checks for all reused services and before every termination. Validate the expected command, configuration path, working directory, or another service-specific identity. If ownership is uncertain, do not kill or reuse the process; present a clear message identifying the port or PID that needs owner attention.

Acceptance criteria:

- A foreign test process on any Public Desk port is not reused as a Public Desk service.
- A stale PID file cannot cause an unrelated process to be killed.
- Valid existing Public Desk processes can still be reused and stopped normally.

### 4 Bound MCP Responses

Files:

- `server.mjs:104-135`
- `public/app.js:252-269`

`response.text()` currently buffers the complete upstream response. Add a decoded-byte limit before the response is parsed, serialized again, sent to the browser, rendered, or saved. Reject an oversized `Content-Length` early, but do not rely on that header alone. Count streamed bytes, abort above the limit, and bound SSE event count and individual event size.

Return a controlled source error that the existing result classifier can display when no findings exist. Do not turn an oversized response into a successful empty result.

Add tests for oversized JSON, oversized or excessive SSE events, compressed or missing-length responses where practical, and a normal response immediately below the limit.

### 5 Expire Abandoned Uploads

Files:

- `server.mjs:351-371`
- `public/app.js:306-323`

Normal browser cleanup is sound, but a crash, abandoned request, or server restart can leave private staged files under `work/uploads`. Restart also loses the in-memory upload ID map.

Keep the current browser `finally` cleanup and add server-side defense in depth:

- give every staged upload a short documented lifetime;
- delete expired files without relying on a browser follow-up;
- sweep stale upload files during startup;
- never follow symlinks or delete outside the exact upload directory;
- preserve exclusive creation, UUID prefixes, the 50 MB limit, and mode `0600`.

Add tests using a temporary directory. Tests must prove that fresh files survive, stale files are removed, and files outside the upload directory cannot be touched.

### 6 Harden Custom MCP Destinations

Files:

- `server.mjs:96-101`
- `server.mjs:113-135`
- `server.mjs:384-390`

The current check blocks two literal cloud-metadata hostnames, but alternate representations and automatic redirects remain unchecked. The app intentionally needs bundled loopback MCP endpoints, so do not apply a blanket private-network prohibition.

Separate destination policy into:

- an explicit allowlist for the known bundled loopback endpoints;
- remote custom endpoints that require HTTPS;
- redirect handling that validates each target before following it;
- resolved-address checks that block metadata, link-local, multicast, and other unintended destinations without breaking the explicit local allowlist.

Retain the existing Origin and Host protections. Add endpoint-policy tests, including redirect and alternate-address cases.

## Interface and Documentation Cleanup

After the hardening work, address these smaller issues without redesigning the app:

1. Bundled server removal is not persistent. `removedBundledEndpoints` is always empty, so a removed bundled server returns after reload. Prefer a clear Disable action or persist an explicit tombstone. Do not accidentally discard custom servers.
2. The header advertises `Command K`, but no keyboard handler exists. Implement the shortcut or remove the keycap claim.
3. The News view shows as many as 120 feed items immediately. Introduce a more manageable initial page or progressive loading while preserving filters and refresh.
4. Change `Tokens stay in memory` to accurately distinguish in-memory MCP bearer tokens from restricted API-key and Consensus refresh files stored on disk.
5. `?diagnostics` is documented in `README.md` and `HANDOFF.md`, and `app.js` still calculates diagnostics, but the current report renderer never displays them. Either restore diagnostics only when the explicit development flag is present or remove the dead calculation and update both documents. Ordinary searches must remain result-only.
6. Add confirmation or undo for evidence deletion and Clear history. Removing saved API keys already has confirmation and should remain unchanged.

## Quality and Security Boundaries

- Treat external OSINT and IntelMap data as leads, not verified facts.
- Do not change the manual Tool Library into an automatic execution path.
- Do not weaken HTML escaping, safe-URL checks, CSP, OAuth state/PKCE, file-size limits, file permissions, key allowlists, or atomic key-file writes.
- Do not broaden any service bind address beyond loopback.
- Do not log bearer tokens, OAuth credentials, API-key values, uploaded content, or full sensitive queries.
- Avoid new dependencies unless they materially reduce risk and are pinned. Prefer the existing dependency-light design.

## Required Verification

Run the focused tests during implementation and the complete suite before handoff:

```sh
npm test
```

Also verify:

- the repository contains no credential values or generated `work/` files;
- the application starts through the full macOS launcher;
- bundled MCP services are recognized only when their ownership checks pass;
- Stop Public Desk stops only its own processes;
- successful searches still show findings and Related Links only;
- no-findings searches still show useful source errors;
- evidence survives a normal reload and malformed storage does not brick startup;
- file-analysis uploads disappear after success, failure, expiration, and restart cleanup;
- the News, Connections, Tool Library, Evidence, light theme, and dark theme screens remain usable.

Do not run paid tools or active reconnaissance as part of verification. Use fixtures or local mock endpoints for failure, redirect, oversized-response, and ownership tests.

## Delivery

When the work is complete:

1. Perform one focused review of the final diff.
2. Confirm the full test count and result.
3. Confirm the working tree contains only intended changes.
4. Commit on the new branch with a clear message.
5. Push the branch to GitHub.
6. Report the branch name, commit, test result, changed files, remaining limitations, and pull-request link if one was opened.

Do not merge into `main` unless the owner explicitly requests it.
