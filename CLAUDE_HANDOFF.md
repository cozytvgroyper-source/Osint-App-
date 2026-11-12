# Claude Handoff — Public Desk

Updated: 2026-11-12 (America/New_York)

## Repository and current state

- Local repository: `/Users/randybill/Documents/Codex/2026-11-10/public-desk`
- GitHub repository: `cozytvgroyper-source/Osint-App-`
- Current local branch: `fix/security-reliability-hardening`
- The working tree was clean before this handoff file was created.
- This handoff is intentionally local and uncommitted. Do not add it to PR 77 unless the owner explicitly changes the request to remove handoff documents from the repository.
- Public Desk is currently running. A fresh local check returned UI `200`; unauthenticated Public Desk API, Open OSINT data health, and Open OSINT MCP health requests all returned `401`.
- The current launcher is using the legacy adjacent Open OSINT checkout because `work/dependencies/osint-mcp` has not been created yet. PR 77 adds `npm run setup` for the managed checkout.

Never print, commit, or place in a PR the launch token in `work/runtime/public-desk-token` or any values from `work/api-keys.env`.

## Open pull-request stack

All three PRs are open, clean, mergeable, and have passing CI on Node 22, 24, and 26.

1. [PR 76 — Harden local service boundaries and resource limits](https://github.com/cozytvgroyper-source/Osint-App-/pull/76)
   - Base: `main`
   - Head: `fix/local-service-boundaries`
   - Commit: `4a7aca2`
2. [PR 77 — Make local setup reproducible and remove handoff docs](https://github.com/cozytvgroyper-source/Osint-App-/pull/77)
   - Base: `fix/local-service-boundaries`
   - Head: `chore/reproducible-local-setup`
   - Commit: `bfaca27`
3. [PR 78 — Harden GitHub security automation](https://github.com/cozytvgroyper-source/Osint-App-/pull/78)
   - Base: `chore/reproducible-local-setup`
   - Head: `ci/github-security-hardening`
   - Commit: `98d06c0`

The owner has not yet authorized a merge. The established workflow is to wait for the owner to say **“send it.”**

## Completed work

### PR 76: application and local-service security

- One private launch token now protects every privileged Public Desk API and all bundled local HTTP/MCP services on ports 8080 and 8892–8894.
- Static UI files remain directly loadable; the token is supplied in the launcher URL fragment, moved to session storage, and immediately removed from the address bar.
- Consensus OAuth initiation is an authenticated POST. The callback keeps its one-time state protection.
- Report downloads use authenticated fetches and preserve server-provided filenames.
- Open OSINT `/health` and `/mcp` both require the exact bearer token.
- The launcher rotates stale tokens unless an allowlisted service passes exact working-directory and command identity verification.
- Uploads are limited by request concurrency, active count, per-file size, and aggregate bytes. Fresh files left by a prior process are restored into quota accounting and retain only their remaining lease.
- Deep Search audit writes are serialized, rotated at a bounded size, owner-only, and read through a bounded tail.
- Open OSINT is pinned to revision `0750ba277d95cd42a79cf0b43e3ba469f08c43ac`; local event-loop and protected-data-service patches are durable and idempotent.

An independent bypass review found two issues during development: an unprotected 8892 `/health` route and stale-token reuse through unrelated PID reuse. Both were fixed and revalidated. Final reviewer disposition: no remaining concrete bypass or regression in those areas.

### PR 77: setup and documentation cleanup

- Adds `npm run setup` through `scripts/setup-local.zsh`.
- Checks required tools and Node 22+, clones the pinned managed Open OSINT dependency, uses `npm ci` and `uv sync --frozen`, and applies the local patches.
- Updates the README with fresh setup, token behavior, and storage limits.
- Deletes the previously tracked handoff documents and removes the stale reference from `docs/search-overhaul.md`.
- This new `CLAUDE_HANDOFF.md` exists only because the owner explicitly requested a fresh Claude handoff after those PRs were prepared.

### PR 78: GitHub hardening

- Pins GitHub Actions to full commit SHAs.
- Adds JavaScript/TypeScript CodeQL analysis for pull requests, `main`, and a weekly schedule.
- Adds `SECURITY.md` with private reporting instructions.

## Verification already completed

- `npm test`: 249 passed, 0 failed.
- Shell syntax: Start, Stop, and setup scripts passed `zsh -n`.
- Python wrappers passed compilation.
- `git diff --check` passed.
- Runtime verification with the real launcher:
  - Public Desk API: unauthenticated `401`, authenticated `200`
  - Open OSINT data health: unauthenticated `401`, authenticated `200`
  - Open OSINT MCP health: unauthenticated `401`, authenticated `200`
  - MCP initialize on 8892, 8893, and 8894: unauthenticated `401`, authenticated `200`
- GitHub CI is green on all three PRs for Node 22, 24, and 26.

## Safe next steps after owner approval

These are stacked PRs. Preserve commit ancestry while unstacking them:

1. Merge PR 76 with a merge commit. Do not delete its branch yet because PR 77 currently uses it as its base.
2. Retarget PR 77 to `main`, confirm its diff contains only setup/documentation cleanup, wait for refreshed checks, then merge it with a merge commit.
3. Retarget PR 78 to `main`, confirm its diff contains only GitHub hardening, wait for CI and CodeQL, then merge it.
4. Confirm post-merge CI on `main` after every merge.
5. Only after PR 78 is merged, inspect repository settings. Preserve existing protection rules while enabling strict required-status-check freshness and Dependabot security updates if they are not already enabled.
6. Delete stacked branches only after all dependent PRs have been retargeted or merged.

Suggested commands, after explicit merge approval:

```sh
gh pr merge 76 --repo cozytvgroyper-source/Osint-App- --merge
gh pr edit 77 --repo cozytvgroyper-source/Osint-App- --base main
gh pr checks 77 --repo cozytvgroyper-source/Osint-App- --watch
gh pr merge 77 --repo cozytvgroyper-source/Osint-App- --merge
gh pr edit 78 --repo cozytvgroyper-source/Osint-App- --base main
gh pr checks 78 --repo cozytvgroyper-source/Osint-App- --watch
gh pr merge 78 --repo cozytvgroyper-source/Osint-App- --merge
```

Before each merge, use `gh pr view <number> --json mergeable,mergeStateStatus,statusCheckRollup` and stop if the PR is not clean or a check fails.

## Operational commands

```sh
cd /Users/randybill/Documents/Codex/2026-11-10/public-desk
npm test
zsh "Stop Public Desk.command"
zsh "Start Public Desk.command"
```

Do not run active or intrusive OSINT tools as part of a smoke test. The completed live verification used only local health and MCP initialization requests.
