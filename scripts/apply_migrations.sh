#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/crates/persistence/migrations"
DATABASE_URL="${DATABASE_URL:-postgres://syllabus:syllabus@127.0.0.1:5432/syllabus_dev}"

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql client is required to apply migrations" >&2
  exit 1
fi

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "error: migrations directory not found at ${MIGRATIONS_DIR}" >&2
  exit 1
fi

echo "==> Applying PostgreSQL migrations from ${MIGRATIONS_DIR}"
shopt -s nullglob
migrations=("${MIGRATIONS_DIR}"/*.sql)
shopt -u nullglob

if [[ "${#migrations[@]}" -eq 0 ]]; then
  echo "error: no SQL migration files found in ${MIGRATIONS_DIR}" >&2
  exit 1
fi

IFS=$'\n' sorted_migrations=($(printf '%s\n' "${migrations[@]}" | sort))
unset IFS

for migration in "${sorted_migrations[@]}"; do
  echo "  -> Applying $(basename "${migration}")"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${migration}"
done

EXPECTED_TABLES=(
  "accounts"
  "auth_sessions"
  "learner_profiles"
  "syllabus_revisions"
  "public_template_revisions"
  "schedule_revisions"
  "progress_events"
  "idempotency_keys"
  "outbox_jobs"
  "deletion_tombstones"
  "catalog_resources"
  "resource_versions"
  "acquisition_permissions"
  "resource_review_records"
  "resource_freshness_checks"
  "objective_catalog_anchors"
  "resource_quarantine_overlays"
  "reviewed_assessments"
  "assessment_attempts"
  "review_schedule_items"
  "diagnostic_sessions"
  "objective_waivers"
  "adaptation_proposals"
  "provider_credentials"
  "inference_usage_records"
  "notification_preferences"
  "push_subscriptions"
  "reminder_occurrences"
  "hosted_credit_wallets"
  "usage_quotes"
  "credit_reservations"
  "ledger_entries"
  "checkout_sessions"
  "payment_webhook_events"
  "publication_previews"
  "publications"
  "publication_revisions"
  "publication_upvotes"
  "publication_reports"
  "moderation_actions"
  "account_export_jobs"
  "account_deletion_requests"
  "catalog_resource_tfidf_terms"
  "catalog_resource_segments"
  "catalog_changes"
  "oauth_identities"
  "oauth_authorization_states"
  "runtime_store_snapshots"
  "open_catalog_resources"
  "web_account_workspaces"
  "web_passkey_credentials"
  "web_auth_recovery_tokens"
  "worker_dispatch_receipts"
)

echo "==> Verifying schema tables in PostgreSQL"
for table_name in "${EXPECTED_TABLES[@]}"; do
  exists="$(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('public.${table_name}') IS NOT NULL;")"
  if [[ "${exists}" != "t" ]]; then
    echo "error: expected table public.${table_name} was not created" >&2
    exit 1
  fi
done

echo "==> All ${#sorted_migrations[@]} migrations applied and ${#EXPECTED_TABLES[@]} core tables verified."
