import { buildOperationHeaders } from "../../../packages/api-client/src/index.ts";
import {
  MANUAL_WCAG_22_AA_EVALUATION_MATRIX,
  UI_TOKENS,
  resolveSurfaceStyle,
  runAutomatedAccessibilityRegressionCheck,
  type AutomatedAccessibilityAuditReport,
  type ScreenAccessibilityDescriptor,
  type StudySurfaceKind,
  type ThemeMode,
} from "../../../packages/ui/src/index.ts";

export type PlatformRole = "Learner" | "Curator" | "Moderator" | "Operator";

export interface LaunchScreenInventoryEntry extends ScreenAccessibilityDescriptor {
  readonly sliceId: string;
  readonly routePattern: string;
  readonly allowedRoles: readonly PlatformRole[];
  readonly isInternalOperationalRoute: boolean;
}

const SCREEN_SPECS: ReadonlyArray<
  readonly [
    screenId: string,
    sliceId: string,
    routePattern: string,
    allowedRoles: readonly PlatformRole[],
    isInternalOperationalRoute: boolean,
    headingText: string,
    surfaceKind: StudySurfaceKind,
  ]
> = [
  ["onboarding_and_goal_intake", "T04", "/onboarding", ["Learner"], false, "Design Your Learning Plan", "study_card"],
  ["diagnostic_session_runner", "T06", "/diagnostics/:diagnosticSessionId", ["Learner"], false, "Placement Diagnostic", "assessment"],
  ["curriculum_map_and_outline", "T04/T05", "/plans/:planId/map", ["Learner"], false, "Curriculum Map & Accessible Outline", "study_card"],
  ["today_study_runner", "T04", "/plans/:planId/study", ["Learner"], false, "Today's Study Session", "reading"],
  ["assessment_and_mastery_gate", "T05", "/assessments/:assessmentId", ["Learner"], false, "Formative Assessment & Mastery Gate", "assessment"],
  ["schedule_and_offline_pack", "T06", "/plans/:planId/schedule", ["Learner"], false, "Study Schedule & Offline Study Pack", "study_card"],
  ["plan_adaptation_diff_viewer", "T06", "/plans/:planId/adaptations", ["Learner"], false, "Bounded Plan Adaptation & Provenance Diff", "study_card"],
  ["byok_vault_and_reminders", "T07A/T07C", "/settings/keys-and-notifications", ["Learner"], false, "BYOK API Keys & Study Reminders", "study_card"],
  ["hosted_wallet_and_billing_ledger", "T07B/T07D", "/settings/billing", ["Learner"], false, "Hosted Credit Wallet, Quotes & Billing Ledger", "pricing"],
  ["public_discovery_and_adoption", "T13", "/discover", ["Learner"], false, "Public Curriculum Discovery & Adoption", "study_card"],
  ["publication_preview_and_owner_management", "T13", "/me/publications", ["Learner"], false, "Publication Preview & Owned Publications", "consent"],
  ["account_privacy_export_and_deletion", "T09", "/settings/privacy", ["Learner"], false, "Account Data Export & Deletion", "destructive_confirmation"],
  ["curator_template_governance", "T12", "/internal/curator/templates", ["Curator"], true, "Curator Template & License Governance", "study_card"],
  ["moderator_publication_quarantine_queue", "T13", "/internal/moderator/publications", ["Moderator"], true, "Moderator Publication Quarantine Queue", "study_card"],
  ["operator_release_and_incident_console", "T09", "/internal/operator/release-readiness", ["Operator"], true, "Operator Release Readiness & Incident Console", "study_card"],
];

export const COMPLETE_SCREEN_INVENTORY: readonly LaunchScreenInventoryEntry[] = SCREEN_SPECS.map(
  ([screenId, sliceId, routePattern, allowedRoles, isInternalOperationalRoute, headingText, surfaceKind]) => ({
    screenId,
    sliceId,
    routePattern,
    allowedRoles,
    isInternalOperationalRoute,
    landmarkRole: "main",
    headingText,
    surfaceKind,
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  }),
);

export function evaluateScreenRoleAccess(
  screenId: string,
  viewerRoles: readonly PlatformRole[],
): {
  readonly allowed: boolean;
  readonly screen: LaunchScreenInventoryEntry;
  readonly statusCode: 200 | 403;
  readonly denialReason: string | null;
} {
  const screen = COMPLETE_SCREEN_INVENTORY.find((s) => s.screenId === screenId);
  if (!screen) {
    throw new Error(`Unknown launch screen '${screenId}'.`);
  }
  const allowed = screen.allowedRoles.some((role) => viewerRoles.includes(role));
  return {
    allowed,
    screen,
    statusCode: allowed ? 200 : 403,
    denialReason: allowed
      ? null
      : `Role boundary violation (@S88): route '${screen.routePattern}' requires one of [${screen.allowedRoles.join(", ")}].`,
  };
}

export function getVisibleNavigationScreens(
  viewerRoles: readonly PlatformRole[],
): readonly LaunchScreenInventoryEntry[] {
  return COMPLETE_SCREEN_INVENTORY.filter((screen) =>
    screen.allowedRoles.some((role) => viewerRoles.includes(role)),
  );
}

export function auditCompleteScreenInventory(): AutomatedAccessibilityAuditReport {
  return runAutomatedAccessibilityRegressionCheck(COMPLETE_SCREEN_INVENTORY);
}

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
              "curriculum_plans_and_versions",
              "study_sessions_and_attempt_history",
              "mastery_and_review_schedule",
              "hosted_billing_ledger_and_usage",
              "owned_publications_and_revisions",
            ],
            excludedRecords: ["raw_byok_secret_material (never exported in plaintext)"],
          },
          byokDeletionVsProviderRevocation:
            "Deleting your account or stored BYOK key immediately destroys our encrypted copy and per-credential DEK, but does NOT revoke the API key at your external AI provider. Rotate or revoke the key in your provider console to invalidate it externally.",
          publicPublicationsImpact:
            "Deleting your account withdraws your owned public publications from app-controlled discovery. Previously adopted plans in other learners' private workspaces remain intact.",
          financialAuditRetention:
            "Personal learning data and credentials are purged. De-identified billing ledger records are retained strictly as required for financial audit compliance.",
        },
        manualWcagEvaluationMatrix: MANUAL_WCAG_22_AA_EVALUATION_MATRIX,
      };
    },
  };
}
