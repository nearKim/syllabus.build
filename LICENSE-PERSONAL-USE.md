# Custom Personal-Use Source-Available License Policy & Release Operations Guide (`OPS-006`, `@S40`)

> **IMPORTANT RELEASE GATE NOTICE (`D15` / `CTRL-001` / `CTRL-060`):**
> This repository is **source-available for individual personal use only**. It is **NOT** OSI-approved open source software, and it must never be labeled, marketed, or redistributed as "open source" or under an OSI license. Final operative legal text for the custom personal-use license and contributor agreement remains a deferred release gate (`D15`) that blocks public source repository distribution until approved by the project owner and legal counsel.

---

## 1. Permitted Individual Personal Use (`D15`, `OPS-006`)

Subject to the adoption of the final operative license instrument (`D15`):
1. **Individual Personal Use Only:** An individual human user may view, compile, run, and modify the software solely for that individual's own personal, non-organizational learning and self-hosted personal study.
2. **Permitted Contribution Development:** An individual contributor may fork, modify, and test the software solely to develop and submit contributions back to the official repository under the project's contributor grant.
3. **Official Hosted Service Operation:** Only the project owner (and authorized operators acting solely on behalf of the project owner's official service) may operate the software as a multi-user, hosted, or organizational service.

## 2. Prohibited Third-Party Organizational Deployments (`D15`, `@S40`)

**All third-party organizational deployments are strictly prohibited, regardless of whether the organization charges fees or operates noncommercially.** Without limitation, no third party may deploy, host, operate, or provide this software (or modified versions of it) for or within:
- Commercial corporations, partnerships, or business teams
- Internal employee training or onboarding programs
- Schools, universities, bootcamps, or academic institutions
- Nonprofits, foundations, or noncommercial consortia
- Public-research laboratories or government agencies
- Managed hosting, SaaS, or shared multi-tenant deployments for other individuals

Scoped official-service rights and contributor-development rights do **not** grant general organizational deployment rights.

## 3. Contributor License Grant (`OPS-006`, `@S40`)

By submitting a contribution to this repository, each contributor agrees that:
- The contributor grants the project owner the rights necessary to operate, commercialize, sublicense, and distribute the contribution as part of both the source-available personal-use distribution and the project owner's official paid/hosted service.
- Contributions must be the contributor's original work (or properly licensed under compatible permissive terms) and must not include unauthorized third-party course text, proprietary assessment banks, or leaked credentials.

## 4. Separate Scope of Third-Party Dependencies, Catalog Metadata, Public Curricula, and Learning Materials (`OPS-006`, `SHARE-009`, `@S40`)

The custom personal-use software license governs **only** the first-party application source code in this repository. The following categories remain governed by their own distinct legal terms:
1. **Third-Party Software Dependencies:** Open-source Rust crates (`Cargo.toml`) and TypeScript packages (`package.json`) remain governed by their respective upstream licenses (MIT, Apache-2.0, BSD, ISC).
2. **Catalog Resource Metadata & Third-Party Learning Materials (`CAT-001`, `D03`):** External courses, textbooks, videos, documentation, and papers referenced in the catalog remain the property of their respective authors/publishers. The platform stores verified links and approved bibliographic metadata by default; full-text ingestion, embedding, model submission, or derived assessment generation requires explicit recorded permission (`AcquisitionPermission`). Synthetic fixtures (`synthetic_only: true`) are test data only and are ineligible for production catalog use.
3. **Published Public Curricula (`SHARE-009`, `D16`):** Curricula explicitly published by learners to the public discovery gallery are governed by the explicit `publication_terms` version consented to at publication time (`D16`), covering first-party structural graph, objective summaries, and original publisher notes while excluding third-party copyrighted material and private learner state.

## 5. Individual Self-Host Configuration, Secrets, Migrations, Backups & Extension Boundaries (`OPS-006`, `@S40`)

### 5.1 Self-Host Environment & Secrets Setup
- Copy `.env.example` to `.env` for local individual development; **never** commit `.env`, API keys, or KMS secrets to version control.
- Required environment variables:
  - `APP_ENV`: `development` | `test` | `staging` | `production` (`DevFixedIdentityAuthVerifier` is restricted to `development` and `test`).
  - `DATABASE_URL`: PostgreSQL 16+ connection URI (with `pgvector` extension available).
  - `BYOK_KEK_BASE64`: 32-byte key-encryption key for local envelope encryption of BYOK provider credentials (`T07A`).
  - Release-gate flags (all default to `false` until the corresponding owner decision is approved):
    - `FEATURE_PRODUCTION_AUTH_APPROVED` (`D11`)
    - `FEATURE_LIVE_BILLING_ENABLED` (`D07`)
    - `FEATURE_PUBLIC_SHARING_ENABLED` (`D16`)
    - `FEATURE_OPERATIVE_LICENSE_APPROVED` (`D15`)

### 5.2 Database Migrations & Canonical Drift Verification
- Extract and verify canonical specification artifacts before building or migrating:
  ```bash
  python3 scripts/extract_spec.py --check specs/product.md .
  python3 scripts/check_current_spec.py specs/product.md
  python3 scripts/check_contracts.py
  python3 scripts/generate_contracts.py --check
  ```
- SQL migrations reside in `crates/persistence/migrations/` and are applied deterministically in lexical order.

### 5.3 Backup & Restore Hygiene (`NFR-006`, `OPS-004`)
- Transactional PostgreSQL state is authoritative; vector indexes are rebuildable derived data (`CTRL-002`).
- After any point-in-time recovery (PITR) or logical snapshot restore, the post-restore reconciliation job **must** replay the append-only deletion/revocation tombstone log before re-enabling external traffic or worker dispatch so deleted accounts, revoked BYOK keys, and withdrawn public curricula are never resurrected (`@S45`, `@S84`).

### 5.4 Extension Boundaries
- New AI providers must implement the provider-neutral `InferenceProvider` trait and declare explicit `ProviderCapabilities` in `crates/providers` over direct official REST APIs (`reqwest`) without leaking provider SDK types into `crates/domain` (`D12`).
- New UI activity components must be registered in the allowlisted `SafeActivityRenderer` (`packages/ui`) and defined in `curriculum.schema.json` inside `specs/product.md`; unknown major schema versions fail closed (`NFR-002`).
