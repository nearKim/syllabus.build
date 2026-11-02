# Syllabus.build

**Syllabus.build** is an adaptive self-study syllabus builder, DAG planner, and open learning-resource workspace built with a Rust transactional API + outbox worker (`syllabus-api`, `syllabus-worker`), PostgreSQL 16, and an SSR + signal-hydrated Preact/TypeScript web application (`@syllabus/web`).

---

## Architecture

| Component | Path | Responsibility |
| --- | --- | --- |
| **`syllabus-api`** | `services/api` | Axum HTTP `/v1/*` API: authentication (OAuth 2.0 + PKCE S256 and FIDO2 WebAuthn passkeys), syllabus DAG planning & diagnostics, workspace synchronization, hosted credit wallet & HMAC billing webhooks, community marketplace publishing, and account export/deletion. |
| **`syllabus-worker`** | `services/worker` | Transactional outbox worker claiming `outbox_jobs` via `FOR UPDATE SKIP LOCKED`, dispatching email/webhook/calendar/account-erasure jobs, and recording `worker_dispatch_receipts`. |
| **`crates/*`** | `crates/domain`, `application`, `contracts`, `persistence`, `providers`, `jobs`, `security` | Core Rust domain logic, JSON Schema Draft 2020-12 contract validation (RFC 8785 JCS), PostgreSQL 16 persistence (`crates/persistence/migrations/0001..0010`), and release feature gates. |
| **`@syllabus/web`** | `apps/web` | Node + Preact SSR & signal-hydrated browser workspace (`Today`, `Plan` Map/Outline, `Progress`, `Resources`, `Explore`, `Settings`), RFC 5545 `.ics` calendar export, and AES-256-GCM BYOK envelope custody (OpenAI, Anthropic, Google Gemini). |
| **Open Resource Catalog** | `catalog/resources/**/*.json` | Human-readable, Git-tracked JSON catalog (`catalog/schema/open-resource.schema.json`) allowing contributors to add or curate study resources via pull requests or in-app export while keeping learner workspaces isolated per account. |

---

## Quickstart (Local Development)

### Prerequisites

- **Rust** `>= 1.92` (`cargo`)
- **Node.js** `>= 22` with **pnpm** `10.x` (`corepack enable`)
- **Docker** (for local PostgreSQL 16)

### 1. Start PostgreSQL 16 & Apply Migrations

Supply database values through the process environment: `POSTGRES_PASSWORD`, `DATABASE_URL`, and `DATABASE_URL_CONTAINER`.
`DATABASE_URL` connects host tools to `127.0.0.1`. `DATABASE_URL_CONTAINER` connects containers to `postgres`.

Supply `BYOK_MASTER_KEY`, `BILLING_WEBHOOK_SECRET`, `AUTH_EXCHANGE_SECRET`, and `OAUTH_COOKIE_SECRET` at process launch.
Encode the billing and auth exchange secrets as independent 32-byte random values, each represented by 64 hex characters.
Supply Google, GitHub, or Apple client credentials when using those providers. Do not commit secret values.
For cloud deployments, inject machine-generated deployment secrets from that environment's secret store.

```bash
docker compose --env-file /dev/null up -d postgres
./scripts/apply_migrations.sh
```

### 2. Install Workspace Dependencies

```bash
pnpm install
```

### 3. Run API, Worker, and Web App

Run each command from a shell with the required secret environment values loaded.

```bash
pnpm dev:api
cargo run -p syllabus-worker
pnpm dev:web
```

`@syllabus/web` persists authenticated workspaces, passkeys, BYOK AES-256-GCM sealed envelopes, and wallet state directly through `syllabus-api` into PostgreSQL 16 (`web_account_workspaces`, `web_passkey_credentials`, `web_auth_recovery_tokens`, `accounts`, `hosted_credit_wallets`) — no local JSON state file is required.

New social accounts receive the `User` role. No account receives `Admin` automatically. Shared catalog review and deletion remain unavailable until an Admin account is assigned through a trusted process.

Existing BYOK credentials sealed with the former source-known fallback key cannot be opened with a new `BYOK_MASTER_KEY`. Users must re-enter those provider keys after the key change.

Hosted checkout is unavailable until payment events can be verified against a provider. Synthetic diagnostic answers do not grant mastery or waivers.

---

## Full-Stack Docker Compose Deployment

Run PostgreSQL 16, `syllabus-api`, `syllabus-worker`, and `syllabus-web` together:

Load the required secrets into the environment of the Compose process before starting the stack.
Configure a complete Google, GitHub, or Apple OAuth client pair for production sign-in. Apple requires a registered HTTPS callback at `/auth/oauth/apple/callback` and a signed client secret JWT. Apple client secrets expire and must be renewed.

```bash
docker compose --env-file /dev/null up --build -d
```

- **Web UI**: `http://localhost:3000`
- **API**: `http://localhost:8080/v1/health`

---

## Contributing to the Open Resource Catalog

Community learning resources live as individual formatted JSON files under `catalog/resources/<subject>/<slug>.json` and are indexed into `catalog/index.json`:

```bash
# Validate every catalog resource against catalog/schema/open-resource.schema.json
node scripts/sync_open_catalog.mjs --check

# Regenerate catalog/index.json after adding or editing catalog/resources/**/*.json
node scripts/sync_open_catalog.mjs
```

---

## Verification & Test Suites

```bash
# Rust workspace unit + integration + PostgreSQL persistence tests
cargo test --workspace --locked

# TypeScript strict typecheck + Web SSR/UI/Auth/BYOK/E2E tests
pnpm -r typecheck
pnpm -r test

# Open catalog & OpenAPI/JSON Schema contract checks
node scripts/sync_open_catalog.mjs --check
pnpm verify:t00
```

---

## License

Apache-2.0 — see `LICENSE`.
