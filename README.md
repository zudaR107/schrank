# Schrank

[![Test](https://github.com/zudaR107/schrank/actions/workflows/test.yml/badge.svg)](https://github.com/zudaR107/schrank/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Part of the [Hof platform](https://github.com/zudaR107/Hof) — a suite of
self-hosted personal services:

- [`schloss`](https://github.com/zudaR107/schloss) — home page / launcher
- [`schlussel`](https://github.com/zudaR107/schlussel) — auth: accounts, login, tokens
- [`kuvert`](https://github.com/zudaR107/kuvert) — envelope budgeting
- [`tafel`](https://github.com/zudaR107/tafel) — task/project tracking
- [`zettel`](https://github.com/zudaR107/zettel) — fast markdown note-taking
- [`glocke`](https://github.com/zudaR107/glocke) — in-app notification center and delivery foundation
- **`schrank`** (this repo) — file storage with nested folders
- [`tor`](https://github.com/zudaR107/tor) — reverse-proxy gateway
- [`schloss-ui`](https://github.com/zudaR107/schloss-ui) — shared frontend components
- [`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) — shared backend auth/CORS kit

Schrank ("wardrobe/cabinet" in German) is a personal file storage
service: real nested folders and browser-native preview for images and
PDFs. No sharing/permissions, no office/video preview - a private,
single-owner cabinet, not a collaboration tool.

## How it fits into the platform

Schrank has no login form of its own. An unauthenticated visitor is
redirected to Schlüssel's hosted login page and back; the backend
verifies the resulting token itself against Schlüssel's public key
(JWKS) rather than calling back to Schlüssel on every request. Shared
logic (JWKS verification, CORS, PKCE login redirect, the API client,
and the resizable sidebar) comes from
[`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) and
[`schloss-ui`](https://github.com/zudaR107/schloss-ui), not duplicated here.

This repo is a pnpm workspace with two packages:

- `backend/` — the Hono + Drizzle/SQLite backend
- `frontend/` — the React frontend

## Status

Bootstrap only: authentication, the shared layout/sidebar, and CI/Docker/
gateway wiring are in place, reachable at `https://schrank.localhost`. The
file storage feature itself (folders, upload, download, preview, quota)
has not landed yet - the `/files` page is a placeholder until it does.

## Local development

```sh
git submodule update --init
pnpm install
pnpm --filter @zudar107/schloss-server-kit build
pnpm --filter @zudar107/schloss-ui build
pnpm dev:backend   # backend on http://localhost:3005
pnpm dev:frontend  # frontend on http://localhost:5178
```

```sh
pnpm --filter backend test
pnpm --filter backend lint
pnpm --filter frontend test
pnpm --filter frontend lint
```

### Environment variables

`.env.example` contains Docker Compose substitutions. Direct backend runs
use the defaults shown below unless the variables are exported in the shell;
the backend does not load `.env` itself. Vite does load `.env`, but only
exposes variables prefixed with `VITE_` to frontend code.

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite file path when running the backend directly |
| `SCHLUSSEL_JWKS_URL` | Where the backend fetches Schlüssel's public key to verify tokens |
| `JWT_ISSUER` | Must match Schlüssel's own issuer, or every token gets rejected |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist when running the backend directly |
| `SCHRANK_ALLOWED_ORIGINS` | CORS allowlist passed to the backend by Docker Compose |
| `SCHLUSSEL_WEB_URL` | Schlüssel browser URL baked into the frontend by Docker Compose |
| `SCHLOSS_URL` | Schloss home URL baked into the frontend by Docker Compose |

For a direct Vite build, the corresponding build-time variables are
`VITE_SCHLUSSEL_URL` and `VITE_SCHLOSS_URL`; their local defaults are
`http://localhost:4001` and `http://localhost:3000`, respectively. The
shared notification bell (`VITE_GLOCKE_URL`) isn't wired up yet - see
"Status" above.

Authenticated `GET /users/me` responses also carry the regional profile
claims from the verified Schlüssel token: `weekStart` is `monday`, `sunday`,
or `null`; `dateFormat` is `dmy`, `mdy`, `ymd`, or `null`; and `timezone` is
a valid IANA identifier or `null`. Missing claims are normalized to `null`.
A malformed regional claim invalidates the token and returns `401`.

## Running with Docker

```sh
docker network create schloss-net   # one-time, shared with the other repos
cp .env.example .env
docker compose up -d
```

Neither service publishes a host port — both are reached through the
[tor](https://github.com/zudaR107/tor) gateway (`https://schrank.localhost` in local dev
- tor's Caddy auto-upgrades everything to HTTPS with its own locally-trusted CA), on the
same `schloss-net` network as every other service.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
