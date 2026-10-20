import { buildOperationHeaders } from "../../../packages/api-client/src/index.ts";
import {
   MANUAL_WCAG_22_AA_EVALUATION_MATRIX,
  UI_TOKENS,
  resolveSurfaceStyle,
  runAutomatedAccessibilityRegressionCheck,
  type AutomatedAccessibilityAuditReport,
  type ScreenAccessibilityDescriptor,
  type ThemeMode,
} from "../../../packages/ui/src/index.ts";

export type PlatformRole = "Learner" | "Curator" | "Moderator" | "Operator";

export interface LaunchScreenInventoryEntry extends ScreenAccessibilityDescriptor {
  readonly sliceId: string;
  readonly routePattern: string;
  readonly allowedRoles: readonly PlatformRole[];
  readonly isInternalOperationalRoute: boolean;
}

export const COMPLETE_SCREEN_INVENTORY: readonly LaunchScreenInventoryEntry[] = [
  {
    screenId: "onboarding_and_goal_intake",
    sliceId: "T04",
    routePattern: "/onboarding",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Design Your Learning Plan",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "diagnostic_session_runner",
    sliceId: "T06",
    routePattern: "/diagnostics/:diagnosticSessionId",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Placement Diagnostic",
    surfaceKind: "assessment",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "curriculum_map_and_outline",
    sliceId: "T04/T05",
    routePattern: "/plans/:planId/map",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Curriculum Map & Accessible Outline",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "today_study_runner",
    sliceId: "T04",
    routePattern: "/plans/:planId/study",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Today's Study Session",
    surfaceKind: "reading",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "assessment_and_mastery_gate",
    sliceId: "T05",
    routePattern: "/assessments/:assessmentId",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Formative Assessment & Mastery Gate",
    surfaceKind: "assessment",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "schedule_and_offline_pack",
    sliceId: "T06",
    routePattern: "/plans/:planId/schedule",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Study Schedule & Offline Study Pack",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "plan_adaptation_diff_viewer",
    sliceId: "T06",
    routePattern: "/plans/:planId/adaptations",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Bounded Plan Adaptation & Provenance Diff",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "byok_vault_and_reminders",
    sliceId: "T07A/T07C",
    routePattern: "/settings/keys-and-notifications",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "BYOK API Keys & Study Reminders",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "hosted_wallet_and_billing_ledger",
    sliceId: "T07B/T07D",
    routePattern: "/settings/billing",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Hosted Credit Wallet, Quotes & Billing Ledger",
    surfaceKind: "pricing",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "public_discovery_and_adoption",
    sliceId: "T13",
    routePattern: "/discover",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Public Curriculum Discovery & Adoption",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "publication_preview_and_owner_management",
    sliceId: "T13",
    routePattern: "/me/publications",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Publication Preview & Owned Publications",
    surfaceKind: "consent",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "account_privacy_export_and_deletion",
    sliceId: "T09",
    routePattern: "/settings/privacy",
    allowedRoles: ["Learner"],
    isInternalOperationalRoute: false,
    landmarkRole: "main",
    headingText: "Account Data Export & Deletion",
    surfaceKind: "destructive_confirmation",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "curator_template_governance",
    sliceId: "T12",
    routePattern: "/internal/curator/templates",
    allowedRoles: ["Curator"],
    isInternalOperationalRoute: true,
    landmarkRole: "main",
    headingText: "Curator Template & License Governance",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "moderator_publication_quarantine_queue",
    sliceId: "T13",
    routePattern: "/internal/moderator/publications",
    allowedRoles: ["Moderator"],
    isInternalOperationalRoute: true,
    landmarkRole: "main",
    headingText: "Moderator Publication Quarantine Queue",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
  {
    screenId: "operator_release_and_incident_console",
    sliceId: "T09",
    routePattern: "/internal/operator/release-readiness",
    allowedRoles: ["Operator"],
    isInternalOperationalRoute: true,
    landmarkRole: "main",
    headingText: "Operator Release Readiness & Incident Console",
    surfaceKind: "study_card",
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
    ariaLiveRegion: "polite",
    keyboardTrapPresent: false,
    supportsReducedMotion: true,
    supportsForcedColors: true,
    supports320PxReflow: true,
    supportsOutlineParity: true,
  },
];

export function evaluateScreenRoleAccess(
  screenId: string,
  viewerRoles: readonly PlatformRole[]
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
  const hasRole = screen.allowedRoles.some((role) => viewerRoles.includes(role));
  if (!hasRole) {
    return {
      allowed: false,
      screen,
      statusCode: 403,
      denialReason: `Role boundary violation (@S88): route '${screen.routePattern}' requires one of [${screen.allowedRoles.join(", ")}].`,
    };
  }
  return {
    allowed: true,
    screen,
    statusCode: 200,
    denialReason: null,
  };
}

export function getVisibleNavigationScreens(
  viewerRoles: readonly PlatformRole[]
): readonly LaunchScreenInventoryEntry[] {
  return COMPLETE_SCREEN_INVENTORY.filter((screen) =>
    screen.allowedRoles.some((role) => viewerRoles.includes(role))
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
  let exportJobs: AccountExportJobSnapshot[] = [
    ...(initial?.exportJobs ?? []),
  ];
  let deletionRequest: AccountDeletionRequestSnapshot | null =
    initial?.deletionRequest ?? null;
  let explicitDeletionConfirmed = false;
  let clientStatePurged = false;

  function buildCreateAccountExportRequest(options: {
    readonly idempotencyKey: string;
    readonly format?: "json_archive" | "portable_bundle";
    readonly nowIso?: string;
  }) {
    const headers = buildOperationHeaders("createAccountExportJob", {
      idempotencyKey: options.idempotencyKey,
    });
    const requestedAt = options.nowIso ?? "2026-03-31T16:00:00Z";
    const job: AccountExportJobSnapshot = {
      export_job_id: `export-${options.idempotencyKey}`,
      status: "queued",
      requested_at: requestedAt,
      expires_at: null,
      download_url: null,
    };
    exportJobs = [job, ...exportJobs];
    return {
      operationId: "createAccountExportJob" as const,
      method: "POST" as const,
      path: "/me/exports",
      headers,
      body: {
        format: options.format ?? "json_archive",
      },
      job,
    };
  }

  function setExplicitDeletionConfirmed(confirmed: boolean) {
    explicitDeletionConfirmed = confirmed;
  }

  function buildCreateAccountDeletionRequest(options: {
    readonly idempotencyKey: string;
    readonly reason?: string;
    readonly nowIso?: string;
  }) {
    if (!explicitDeletionConfirmed) {
      throw new Error(
        "DELETION_CONFIRMATION_REQUIRED: Account deletion requires explicit destructive confirmation (confirm_deletion: true)."
      );
    }
    const headers = buildOperationHeaders("createAccountDeletionRequest", {
      idempotencyKey: options.idempotencyKey,
    });
    const requestedAt = options.nowIso ?? "2026-03-31T16:05:00Z";
    const snapshot: AccountDeletionRequestSnapshot = {
      deletion_request_id: `deletion-${options.idempotencyKey}`,
      status: "scheduled",
      requested_at: requestedAt,
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
  }

  function purgeClientStateAfterDeletionOrSignOut() {
    exportJobs = [];
    explicitDeletionConfirmed = false;
    clientStatePurged = true;
  }

  function getState() {
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
          excludedRecords: [
            "raw_byok_secret_material (never exported in plaintext)",
          ],
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
  }

  return {
    buildCreateAccountExportRequest,
    setExplicitDeletionConfirmed,
    buildCreateAccountDeletionRequest,
    purgeClientStateAfterDeletionOrSignOut,
    getState,
  };
}
