# Security Policy

## Supported versions

Schrank is deployed continuously from `main` — there are no maintained
release branches. Security fixes land on `main` and that is the only
supported version.

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities. Instead,
use GitHub's private reporting flow:

1. Go to the [Security tab](../../security) of this repository.
2. Click "Report a vulnerability".
3. Describe the issue, including reproduction steps if you have them.

This is a small, mostly-solo project, so response time is best-effort, not
contractual — but you can expect an initial reply within a few days.

## Scope

Schrank holds personal files and folder structure, so the highest-
priority reports here are anything that could expose one user's files
to another — a missing or incorrect authorization check on any route
(including file content download), or a path-traversal bug that lets a
stored file's name/path escape its owner's on-disk storage directory —
followed by the same token/redirect concerns shared with kuvert/tafel/
zettel/schloss (access token in memory, PKCE verifier in
`sessionStorage`, the auth handoff to/from Schlüssel).
