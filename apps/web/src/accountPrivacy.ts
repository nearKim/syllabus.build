import { buildOperationHeaders } from "@syllabus/api-client";
import {
  MANUAL_WCAG_22_AA_EVALUATION_MATRIX,
  resolveSurfaceStyle,
  type ThemeMode,
} from "@syllabus/ui";

export interface AccountExportJobSnapshot {
  readonly export_job_id: string;
  readonly status: "queued" | "processing" | "completed" | "failed";
  readonly requested_at: string;
  readonly expires_at: string | null;
  readonly download_url: string | null;
}

export interface AccountDeletionRequestSnapshot {
  readonly deletion_request_id: string;
  readonly status: "scheduled" | "processing" | "completed";
  readonly requested_at: string;
  readonly purge_scheduled_at: string;
}

export function createAccountPrivacyController(initial?: {
  readonly theme?: ThemeMode;
  readonly exportJobs?: readonly AccountExportJobSnapshot[];
  readonly deletionRequest?: AccountDeletionRequestSnapshot | null;
}) {
  const theme = initial?.theme ?? "light";
  let exportJobs: AccountExportJobSnapshot[] = [...(initial?.exportJobs ?? [])];
  let deletionRequest: AccountDeletionRequestSnapshot | null = initial?.deletionRequest ?? null;
  let explicitDeletionConfirmed = false;
  let clientStatePurged = false;

  return {
    buildCreateAccountExportRequest(options: {
      readonly idempotencyKey: string;
      readonly format?: "json_archive" | "portable_bundle";
      readonly nowIso?: string;
    }) {
      const headers = buildOperationHeaders("createAccountExportJob", {
        idempotencyKey: options.idempotencyKey,
      });
      const job: AccountExportJobSnapshot = {
        export_job_id: `export-${options.idempotencyKey}`,
        status: "queued",
        requested_at: options.nowIso ?? "2026-03-31T16:00:00Z",
        expires_at: null,
        download_url: null,
      };
      exportJobs = [job, ...exportJobs];
      return {
        operationId: "createAccountExportJob" as const,
        method: "POST" as const,
        path: "/me/exports",
        headers,
        body: { format: options.format ?? "json_archive" },
        job,
      };
    },
    setExplicitDeletionConfirmed(confirmed: boolean) {
      explicitDeletionConfirmed = confirmed;
    },
    buildCreateAccountDeletionRequest(options: {
      readonly idempotencyKey: string;
      readonly reason?: string;
      readonly nowIso?: string;
    }) {
      if (!explicitDeletionConfirmed) {
        throw new Error(
          "DELETION_CONFIRMATION_REQUIRED: Account deletion requires explicit destructive confirmation (confirm_deletion: true).",
        );
      }
      const headers = buildOperationHeaders("createAccountDeletionRequest", {
        idempotencyKey: options.idempotencyKey,
      });
      const snapshot: AccountDeletionRequestSnapshot = {
        deletion_request_id: `deletion-${options.idempotencyKey}`,
        status: "scheduled",
        requested_at: options.nowIso ?? "2026-03-31T16:05:00Z",
        purge_scheduled_at: "2026-04-07T16:05:00Z",
      };
      deletionRequest = snapshot;
      clientStatePurged = true;
      return {
        operationId: "createAccountDeletionRequest" as const,
        method: "POST" as const,
        path: "/me/deletion-requests",
        headers,
        body: {
          confirm_deletion: true as const,
          ...(options.reason ? { reason: options.reason } : {}),
        },
        deletionRequest: snapshot,
      };
    },
    purgeClientStateAfterDeletionOrSignOut() {
      exportJobs = [];
      explicitDeletionConfirmed = false;
      clientStatePurged = true;
    },
    getState() {
      return {
        destructiveSurface: resolveSurfaceStyle("destructive_confirmation", {
          themePreference: theme,
        }),
        cachePolicy: "private, no-store" as const,
        exportJobs: [...exportJobs],
        deletionRequest,
        explicitDeletionConfirmed,
        clientStatePurged,
        disclosures: {
          exportScope: {
            includedRecords: [
              "account profile",
              "syllabi and schedules",
              "study progress",
              "library resources",
              "publications, votes and adoptions",
              "reminder and display preferences",
              "masked API key metadata",
            ],
            excludedRecords: ["API keys and encrypted key copies", "password hashes", "passkey public keys"],
          },
          byokDeletionVsProviderRevocation:
            "Removing a saved key does not revoke the key at your AI provider. Revoke or rotate it with the provider.",
          publicPublicationsImpact:
            "Your public syllabi are withdrawn from app-controlled discovery. Copies already adopted by other learners remain.",
          financialAuditRetention:
            "The account record and some assessment and diagnostic records remain in storage. Billing and deletion audit records may also be retained. Backups may retain data.",
        },
        manualWcagEvaluationMatrix: MANUAL_WCAG_22_AA_EVALUATION_MATRIX,
      };
    },
  };
}
