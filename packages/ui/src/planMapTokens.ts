/**
 * Visual styling tokens, badge data structures, badge label dictionaries,
 * and layout dimension constants for Plan Map and Outline.
 */

export const ACTIVITY_EXECUTION_STATUSES = [
  "not_started",
  "in_progress",
  "self_reported_completed",
  "completed",
  "waived",
] as const;

export type ActivityExecutionStatus = (typeof ACTIVITY_EXECUTION_STATUSES)[number];

export const OBJECTIVE_PROFICIENCY_BADGE_STATUSES = [
  "unassessed",
  "self_reported",
  "in_progress",
  "needs_review",
  "demonstrated",
] as const;

export type ObjectiveProficiencyBadgeStatus = (typeof OBJECTIVE_PROFICIENCY_BADGE_STATUSES)[number];

export const MAP_KEYBOARD_KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Enter"] as const;
export type MapKeyboardKey = (typeof MAP_KEYBOARD_KEYS)[number];

export const SYNCHRONIZED_NODE_ACTIONS = [
  "select_node",
  "open_details",
  "inspect_prerequisites",
  "focus_neighborhood",
  "study_ahead",
] as const;

export type SynchronizedNodeAction = (typeof SYNCHRONIZED_NODE_ACTIONS)[number];

export interface ActivityExecutionBadgeView {
  readonly layer: "activity_execution";
  readonly status: ActivityExecutionStatus;
  readonly label: string;
  readonly nonColorCue: string;
  readonly countsAsDemonstratedProficiency: false;
}

export interface ObjectiveProficiencyBadgeView {
  readonly layer: "objective_proficiency";
  readonly objectiveId: string;
  readonly status: ObjectiveProficiencyBadgeStatus;
  readonly label: string;
  readonly nonColorCue: string;
  readonly evidenceSupport: "none" | "limited" | "corroborated";
  readonly evidenceRefs: readonly string[];
  readonly selfReportedActivityCompleted: boolean;
  readonly conflatedWithActivityCompletion: false;
}

export interface PrerequisiteBadgeView {
  readonly edgeId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly kind: "module_prerequisite" | "objective_prerequisite" | "activity_prerequisite";
  readonly relationshipLabel: string;
  readonly textMeaning: string;
  readonly satisfied: boolean;
}

export interface RightsBadgeView {
  readonly basis: string;
  readonly label: string;
  readonly displayExcerptsAllowed: boolean;
  readonly externalLinkOnly: boolean;
}

export interface OptionalCertificationBadgeView {
  readonly included: boolean;
  readonly relationship: "optional_preparation" | "none";
  readonly label: string;
  readonly rationale: string | null;
  readonly verifiedIssuerUrl: string | null;
  readonly isAccreditedQualificationGuarantee: false;
}

export interface ResourceProvenanceCardView {
  readonly resourceVersionId: string;
  readonly role: "primary" | "supplemental";
  readonly title: string;
  readonly verifiedPublisher: string;
  readonly versionTimestamp: string;
  readonly accessModel: string;
  readonly rightsBadge: RightsBadgeView;
  readonly optionalCertificationBadge: OptionalCertificationBadgeView | null;
  readonly selectionRationale: string;
  readonly verifiedSegments: readonly string[];
  readonly canonicalUrl: string | null;
  readonly omitsUnverifiedPrecision: true;
}

export const EXECUTION_BADGE_LABELS: Readonly<
  Record<ActivityExecutionStatus, { readonly label: string; readonly nonColorCue: string }>
> = {
  not_started: { label: "Not started", nonColorCue: "[ ] Not started" },
  in_progress: { label: "In progress", nonColorCue: "[~] In progress" },
  self_reported_completed: {
    label: "Self-reported complete (unverified)",
    nonColorCue: "[self] Self-reported complete — assessment required for competence",
  },
  completed: { label: "Completed", nonColorCue: "[✓] Completed" },
  waived: { label: "Waived by reviewed evidence", nonColorCue: "[↦] Waived (not completed)" },
};

export const PROFICIENCY_BADGE_LABELS: Readonly<
  Record<ObjectiveProficiencyBadgeStatus, { readonly label: string; readonly nonColorCue: string }>
> = {
  unassessed: { label: "Unassessed", nonColorCue: "○ Unassessed (no reviewed evidence)" },
  self_reported: { label: "Self-reported only", nonColorCue: "◐ Self-reported claim (unverified)" },
  in_progress: { label: "In progress", nonColorCue: "◔ Practice in progress" },
  needs_review: { label: "Needs review", nonColorCue: "◑ Due for spaced review or additional practice" },
  demonstrated: { label: "Demonstrated", nonColorCue: "● Demonstrated via reviewed assessment evidence" },
};

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 88;
export const LAYER_GAP_X = 280;
export const COLUMN_GAP_Y = 136;
export const ORIGIN_X = 48;
export const ORIGIN_Y = 48;

export function normalizeExecutionStatus(raw: unknown, isWaived = false): ActivityExecutionStatus {
  if (isWaived) return "waived";
  if (typeof raw === "string" && (ACTIVITY_EXECUTION_STATUSES as readonly string[]).includes(raw)) {
    return raw as ActivityExecutionStatus;
  }
  return "not_started";
}

export function makeExecutionBadge(status: ActivityExecutionStatus): ActivityExecutionBadgeView {
  const meta = EXECUTION_BADGE_LABELS[status];
  return {
    layer: "activity_execution",
    status,
    label: meta.label,
    nonColorCue: meta.nonColorCue,
    countsAsDemonstratedProficiency: false,
  };
}
