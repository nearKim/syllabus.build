/**
 * Mastery Gate Interstitial Evaluation, Prerequisite Demonstrations,
 * Advisory Warnings, and Auditable Decision Recording.
 */

import { buildOperationHeaders } from "@syllabus/api-client";
import { resolveSurfaceStyle } from "./theme.ts";
import { sanitizeText } from "./SafeActivityRenderer.ts";
import type { ObjectiveProficiencyBadgeStatus } from "./planMapTokens.ts";
import {
  UNVERIFIED_PREREQUISITE_NOTICE,
  type AuditableGateEventType,
  type AuditableGateDecisionProgressEventRequest,
  type MasteryGateEvaluationInput,
  type MasteryGateModalState,
  type MasteryGateStatus,
} from "./assessmentTypes.ts";

const clean = (raw: unknown, fallback = "") => sanitizeText(raw, fallback, 2000);

export function evaluateMasteryGateInterstitial(input: MasteryGateEvaluationInput): MasteryGateModalState {
  const syllabusId = clean(input.syllabusId ?? input.syllabus_id, "synthetic-syllabus-1");
  const syllabusRevisionId = clean(input.syllabusRevisionId ?? input.syllabus_revision_id, "synthetic-revision-1");
  const activityId = clean(input.activityId ?? input.activity_id, "activity-quiz");
  const activityTitle = clean(input.activityTitle, activityId);
  const masteryGated = Boolean(input.masteryGated ?? input.mastery_gated);
  const hasActiveReviewedAnchor =
    input.hasActiveReviewedAnchor ?? input.has_active_reviewed_anchor ?? input.reviewedAnchorAvailable ?? true;

  const prerequisiteObjectiveIds = (
    input.prerequisiteObjectiveIds ?? input.prerequisite_objective_ids ?? ["objective-tokenization"]
  ).map((id) => clean(id));
  const recommendedBridgingActivityIds = (
    input.recommendedBridgingActivityIds ?? input.recommended_bridging_activity_ids ?? ["activity-theory", "activity-example"]
  ).map((id) => clean(id));

  const rawSupport = clean(input.nonqualifyingSupport ?? input.nonqualifying_support, "none");
  const hasNonQualifyingSupportOnly =
    rawSupport !== "none" &&
    rawSupport !== "" &&
    input.hasQualifyingReviewedEvidence !== true &&
    input.has_qualifying_reviewed_evidence !== true;

  const rawProfStatus = input.prerequisiteProficiencyStatus ?? input.prerequisite_proficiency_status ?? "unassessed";
  const normalizedProfStatus: ObjectiveProficiencyBadgeStatus =
    rawProfStatus === "demonstrated" && !hasNonQualifyingSupportOnly
      ? "demonstrated"
      : rawProfStatus === "self_reported" || rawProfStatus === "in_progress" || rawProfStatus === "needs_review"
        ? rawProfStatus
        : "unassessed";

  const prerequisiteSatisfied = normalizedProfStatus === "demonstrated" && !hasNonQualifyingSupportOnly && hasActiveReviewedAnchor;
  const eventId = clean(input.eventId ?? input.event_id, `gate-decision-${activityId}`);
  const occurredAt = clean(input.occurredAt, "2026-10-26T18:15:00-04:00");
  const clientTimezone = clean(input.clientTimezone, "America/New_York");
  const surfaceStyle = resolveSurfaceStyle("assessment");

  const buildAuditRequest = (type: AuditableGateEventType, note: string): AuditableGateDecisionProgressEventRequest => ({
    operationId: "appendProgressEvent",
    method: "POST",
    path: `/syllabi/${syllabusId}/progress-events`,
    headers: buildOperationHeaders("appendProgressEvent"),
    body: {
      event_id: eventId,
      syllabus_revision_id: syllabusRevisionId,
      activity_id: activityId,
      type,
      occurred_at: occurredAt,
      client_timezone: clientTimezone,
      note,
      time_spent_minutes: 0,
    },
  });

  const makeModalState = (params: {
    gateStatus: MasteryGateStatus;
    canProceedImmediately: boolean;
    canProceed: boolean;
    hasPrerequisiteWarning: boolean;
    warningMessage: string | null;
    notice: string;
    unverifiedPrerequisiteNotice?: string | null;
    bridges: readonly string[];
    requiredAuditEventType?: AuditableGateEventType | null;
    requiresLearnerRationale?: boolean;
    auditableDecisionRecorded?: boolean;
    auditableEventType?: AuditableGateEventType | null;
    auditProgressEventRequest?: AuditableGateDecisionProgressEventRequest | null;
    prerequisiteGateRemainsUnsatisfied: boolean;
  }): MasteryGateModalState => ({
    activityId,
    activityTitle,
    masteryGated,
    hasActiveReviewedAnchor,
    prerequisiteObjectiveIds,
    prerequisiteProficiencyStatus: prerequisiteSatisfied ? "demonstrated" : normalizedProfStatus,
    prerequisiteSatisfiedByDemonstratedEvidence: prerequisiteSatisfied,
    nonqualifyingSupportRejected: prerequisiteSatisfied ? false : hasNonQualifyingSupportOnly,
    gateStatus: params.gateStatus,
    canProceedImmediately: params.canProceedImmediately,
    allowedToProceedImmediately: params.canProceedImmediately,
    canProceed: params.canProceed,
    blocking: !params.canProceed,
    hardLocked: false,
    hasPrerequisiteWarning: params.hasPrerequisiteWarning,
    warningMessage: params.warningMessage,
    notice: params.notice,
    unverifiedPrerequisiteNotice: params.unverifiedPrerequisiteNotice ?? null,
    bannerText: params.notice,
    recommendedBridgingActivityIds: params.bridges,
    recommendedBridgeActivities: params.bridges,
    requiredAuditEventType: params.requiredAuditEventType ?? null,
    requiresLearnerRationale: params.requiresLearnerRationale ?? false,
    auditableDecisionRecorded: params.auditableDecisionRecorded ?? false,
    auditableEventType: params.auditableEventType ?? null,
    auditProgressEventRequest: params.auditProgressEventRequest ?? null,
    createsPrerequisiteWaiver: false,
    marksSkippedActivityCompleted: false,
    grantsPrerequisiteProficiency: false,
    prerequisiteGateRemainsUnsatisfied: params.prerequisiteGateRemainsUnsatisfied,
    surfaceStyle,
  });

  if (!masteryGated) {
    const hasWarning = !prerequisiteSatisfied;
    const warningMsg = hasWarning
      ? "Prerequisite objective is not yet demonstrated. You can study ahead now or complete the recommended bridging activities first; studying ahead will not manufacture prerequisite competence."
      : null;
    return makeModalState({
      gateStatus: hasWarning ? "study_ahead_with_warning" : "open",
      canProceedImmediately: true,
      canProceed: true,
      hasPrerequisiteWarning: hasWarning,
      warningMessage: warningMsg,
      notice: warningMsg ?? "Prerequisite satisfied by reviewed evidence; activity ready.",
      bridges: hasWarning ? recommendedBridgingActivityIds : [],
      prerequisiteGateRemainsUnsatisfied: !prerequisiteSatisfied,
    });
  }

  if (!hasActiveReviewedAnchor) {
    const acknowledged = Boolean(
      input.acknowledgedUnverifiedPrerequisite ?? input.acknowledged_unverified_prerequisite ?? input.acknowledged,
    );
    const note = clean(
      input.overrideRationale ?? input.override_rationale ?? input.learnerRationale,
      UNVERIFIED_PREREQUISITE_NOTICE,
    );
    return makeModalState({
      gateStatus: acknowledged ? "unverified_prerequisite_acknowledged" : "requires_unverified_acknowledgement",
      canProceedImmediately: false,
      canProceed: acknowledged,
      hasPrerequisiteWarning: true,
      warningMessage: UNVERIFIED_PREREQUISITE_NOTICE,
      notice: UNVERIFIED_PREREQUISITE_NOTICE,
      unverifiedPrerequisiteNotice: UNVERIFIED_PREREQUISITE_NOTICE,
      bridges: recommendedBridgingActivityIds,
      requiredAuditEventType: "unverified_prerequisite_acknowledged",
      auditableDecisionRecorded: acknowledged,
      auditableEventType: acknowledged ? "unverified_prerequisite_acknowledged" : null,
      auditProgressEventRequest: acknowledged ? buildAuditRequest("unverified_prerequisite_acknowledged", note) : null,
      prerequisiteGateRemainsUnsatisfied: true,
    });
  }

  if (prerequisiteSatisfied) {
    return makeModalState({
      gateStatus: "satisfied_by_demonstrated_evidence",
      canProceedImmediately: true,
      canProceed: true,
      hasPrerequisiteWarning: false,
      warningMessage: null,
      notice: "Prerequisite demonstrated via reviewed anchor assessment.",
      bridges: [],
      prerequisiteGateRemainsUnsatisfied: false,
    });
  }

  const cleanRationale = clean(input.overrideRationale ?? input.override_rationale ?? input.learnerRationale ?? "");
  const hasValidOverride = cleanRationale.trim().length > 0;
  const warningText =
    "Mastery-gated activity: independent prerequisite demonstration on the reviewed anchor or an explicit auditable learner override with rationale is required before continuing.";

  return makeModalState({
    gateStatus: hasValidOverride ? "override_recorded" : "requires_demonstration_or_override",
    canProceedImmediately: false,
    canProceed: hasValidOverride,
    hasPrerequisiteWarning: true,
    warningMessage: warningText,
    notice: warningText,
    bridges: recommendedBridgingActivityIds,
    requiredAuditEventType: "prerequisite_override_recorded",
    requiresLearnerRationale: true,
    auditableDecisionRecorded: hasValidOverride,
    auditableEventType: hasValidOverride ? "prerequisite_override_recorded" : null,
    auditProgressEventRequest: hasValidOverride ? buildAuditRequest("prerequisite_override_recorded", cleanRationale) : null,
    prerequisiteGateRemainsUnsatisfied: true,
  });
}
