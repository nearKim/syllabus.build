import {
  UI_TOKENS,
  runAutomatedAccessibilityRegressionCheck,
  type AutomatedAccessibilityAuditReport,
  type ScreenAccessibilityDescriptor,
  type StudySurfaceKind,
} from "@syllabus/ui";

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
  ["syllabus_map_and_outline", "T04/T05", "/plans/:planId/map", ["Learner"], false, "Syllabus Map & Accessible Outline", "study_card"],
  ["today_study_runner", "T04", "/plans/:planId/study", ["Learner"], false, "Today's Study Session", "reading"],
  ["assessment_and_mastery_gate", "T05", "/assessments/:assessmentId", ["Learner"], false, "Formative Assessment & Mastery Gate", "assessment"],
  ["schedule_and_offline_pack", "T06", "/plans/:planId/schedule", ["Learner"], false, "Study Schedule & Offline Study Pack", "study_card"],
  ["plan_adaptation_diff_viewer", "T06", "/plans/:planId/adaptations", ["Learner"], false, "Bounded Plan Adaptation & Provenance Diff", "study_card"],
  ["byok_vault_and_reminders", "T07A/T07C", "/settings/keys-and-notifications", ["Learner"], false, "BYOK API Keys & Study Reminders", "study_card"],
  ["hosted_wallet_and_billing_ledger", "T07B/T07D", "/settings/billing", ["Learner"], false, "Hosted Credit Wallet, Quotes & Billing Ledger", "pricing"],
  ["public_discovery_and_adoption", "T13", "/discover", ["Learner"], false, "Public Syllabus Discovery & Adoption", "study_card"],
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
