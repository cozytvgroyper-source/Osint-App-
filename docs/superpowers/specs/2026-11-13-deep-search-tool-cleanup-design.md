# Deep Search tool cleanup: design

Date: 2026-11-13 · Status: approved by the owner · Size: small change

## Intent

The Deep Search tool review (`docs/deep-tool-review.md`) recorded four tools that failed. Failed tools make every search slower and fill Search details with errors the owner can't act on. This change deals with each one according to *why* it failed, so that a failure in Search details means something real.

## What was found (checked 2026-11-13)

| Tool | Why it failed | Decision |
|---|---|---|
| `omega_username` | Its code crashes (event-loop error). | **Already removed** from Deep Search during the recording review. Nothing to do. |
| `omega_asn` | It calls `api.bgpview.io`, which no longer exists (DNS lookup returns NXDOMAIN). It will fail on every search. | **Remove from Deep Search.** `get_bgp` (Open OSINT, RIPEstat) already gives network owner, routing and abuse contacts. |
| `get_greynoise` | "HTTP 400" because the recorded IP was a **private** address. GreyNoise only knows public internet addresses. | **Keep, but skip it for private and reserved addresses.** Search details lists it as skipped, with the reason. |
| `ghunt_google_search` | Not signed in: "GHunt has no valid login: run `ghunt login`". | **Keep (owner's decision).** The owner will sign it in later. Until then its failure message already says what to do, so no code change. |

## Goals, non-goals, anti-goals

**Goals**
- `omega_asn` never runs in Deep Search.
- `get_greynoise` never runs on a private or reserved IP, and Search details says why it was skipped.

**Non-goals**
- Main Search (`search-query.js`, `search-planner.js`) is not changed. `omega_asn` may still be offered there; this change is about Deep Search only.
- Signing GHunt in (the owner does that; steps below).
- Fixing the tools' own code (they are outside packages).

**Anti-goals**
- Hiding a tool silently: a skipped tool must be visible in Search details with its reason.
- Treating a public IP as private, which would skip GreyNoise when it should run.

## Approach

There's one sensible way for each:
- **`omega_asn`:** delete its entry from the IP list in `DEEP_TOOLS` (`public/deep-search.js`). Update the tool table and add a row to "Changes approved after recording" in `docs/deep-tool-review.md`, with the NXDOMAIN reason.
- **`get_greynoise`:** mark its entry `publicIpOnly:true` in `DEEP_TOOLS`. The engine (`public/deep-engine.js`), when building tasks for an IP identifier, doesn't call a `publicIpOnly` tool for a private or reserved address. Instead it records a call with outcome `skipped` and the reason "Only covers public internet addresses." Search details shows it like other calls (`tool · server — skipped: reason`). Skipped calls count as finished in progress, so the progress bar still reaches the end.
  - "Private or reserved" means IPv4 `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4` and `240/4`; and IPv6 loopback, unspecified, link-local `fe80::/10`, unique-local `fc00::/7`, documentation `2001:db8::/32` and multicast `ff00::/8`. It's a small browser-side helper in `public/deep-search.js`, because `scripts/endpoint-policy.mjs` is server-only.
  - *Rejected alternative:* dropping GreyNoise silently for private IPs. That hides what happened (anti-goal).
- **GHunt:** no code change.

## GHunt sign-in (for the owner, when ready)

GHunt is already installed at `~/.local/bin/ghunt`. Signing in uses a Google account's session, so a separate, throwaway Google account is recommended. The steps, in Terminal:

```bash
ghunt login
```

GHunt then offers ways to provide the session. The usual one is its "GHunt Companion" browser extension, which exports the signed-in account's cookies. If a saved session was revoked, run `ghunt login --clean` first. After signing in, the next email Deep Search runs GHunt normally.

## Testing

Test first:
- `deepToolsFor` / the IP list no longer includes `omega_asn`, and `get_greynoise` carries `publicIpOnly`.
- The private/reserved helper, at range edges: `10.0.0.1`, `172.16.0.1` and `172.31.255.255` are private; `172.32.0.1` is public; `192.0.2.10` and `198.51.100.1` are reserved; `8.8.8.8` and `1.1.1.1` are public; `::1`, `fe80::1`, `fd00::1` and `2001:db8::1` are private or reserved; `2606:4700::1111` is public.
- The engine, with a fake `callTool`: a private IP run never calls `get_greynoise`, records it as `skipped` with the reason, and progress `done` equals `total`. A public IP run does call it.
- The results view shows `skipped: Only covers public internet addresses.` in Search details, escaped.
- `npm test` with 0 failures.

**Live check (needs the tool servers running):** one Deep Search of a public IP (`8.8.8.8`) to confirm GreyNoise answers. If it doesn't, that becomes a separate finding for the owner.

## Left to the builder

Helper and test names; exact placement of the skip in the engine, as long as skipped calls appear in `run.calls` and in progress.
