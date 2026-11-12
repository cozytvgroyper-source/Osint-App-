# Security Policy

## Supported version

Security fixes are applied to the current `main` branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for an unpatched vulnerability or include investigation targets, API keys, OAuth tokens, or case data in a report.

Include the affected version or commit, the reachable entry point, expected impact, and a minimal reproduction that does not contact third-party targets without authorization. Reports will be acknowledged as soon as practical and coordinated before public disclosure.

## Local security boundary

Public Desk is designed for a single trusted macOS user. Its launcher binds services to loopback and gives the browser and local services a private per-launch access token. This does not protect a Mac account that is already fully compromised by code running as the same user.
