/**
 * Assessment, Formative Evaluation, and Mastery Gate Domain Types and Interfaces
 * (`UI-015`, `PED-001`..`PED-007`, `ADAPT-002`..`ADAPT-005`, `ADAPT-008`, `ADAPT-010`,
 * `@S13`..`@S19`, `@S45`, `@S46`, `@S49`, `@S51`, `@S55`, `@S58`, `@S76`, `@S77`, `@S81`).
 */

import type {
  AppearancePreferences,
  EnvironmentMediaPreferences,
  ResolvedSurfaceStyle,
} from "./theme.ts";
import type { AccessibleMathFormulaView } from "./SafeActivityRenderer.ts";
import type {
  ActivityExecutionStatus,
  ObjectiveProficiencyBadgeStatus,
} from "./planMapTokens.ts";

export const UNVERIFIED_PREREQUISITE_NOTICE =
  "Prerequisite unverified — no reviewed anchor available" as const;

export const WORKED_SOLUTION_ASSISTANCE_WARNING =
  "Warning: revealing the worked solution records assisted study (in_progress) rather than demonstrated competence." as const;

export type AssessmentPurpose =
  | "practice"
  | "independent_probe"
  | "delayed_probe"
  | "transfer_probe"
  | "diagnostic";

export type AssessmentContentReviewStatus =
  | "curator_reviewed"
  | "automated_checks_only";

export type AssessmentGradingMethod =
  | "deterministic"
  | "human"
  | "model_assisted"
  | "ungraded";

export type DeclaredAssistanceKind =
  | "none"
  | "hints"
  | "solution_viewed"
  | "ai"
  | "human"
  | "mixed"
  | "unknown";

export type AssistanceEvidenceKind =
  | "observed_unassisted_in_app"
  | "observed_assisted"
  | "observed_solution_viewed"
  | "self_reported_only"
  | "unknown";

export interface AssessmentOptionInput {
  readonly option_id?: string;
  readonly optionId?: string;
  readonly text?: string;
}

export interface AssessmentQuestionInput {
  readonly question_id?: string;
  readonly questionId?: string;
  readonly prompt?: string;
  readonly math_formula?: string;
  readonly mathFormula?: string;
  readonly objective_ids?: readonly string[];
  readonly objectiveIds?: readonly string[];
  readonly type?: "single_choice" | "multiple_choice" | "short_answer";
  readonly options?: readonly AssessmentOptionInput[];
  readonly max_characters?: number;
  readonly maxCharacters?: number;
  readonly hints?: readonly string[];
  readonly worked_solution?: string;
  readonly workedSolution?: string;
}

export interface AssessmentQuestionOptionView {
  readonly optionId: string;
  readonly text: string;
}

export interface AssessmentQuestionView {
  readonly questionId: string;
  readonly prompt: string;
  readonly mathFormula: AccessibleMathFormulaView | null;
  readonly objectiveIds: readonly string[];
  readonly type: "single_choice" | "multiple_choice" | "short_answer";
  readonly options: readonly AssessmentQuestionOptionView[];
  readonly maxCharacters: number | null;
  readonly availableHintCount: number;
}

export type AssessmentSelectedAnswer =
  | { readonly question_id: string; readonly type: "single_choice"; readonly selected_option_id: string }
  | { readonly question_id: string; readonly type: "multiple_choice"; readonly selected_option_ids: readonly string[] }
  | { readonly question_id: string; readonly type: "short_answer"; readonly text: string };

export interface AssessmentChoiceSelectionOutcome {
  readonly questionId: string;
  readonly selectedOptionId: string | null;
  readonly selectedOptionIds: readonly string[];
  readonly text: string | null;
  readonly submitted: false;
  readonly autoSubmitted: false;
  readonly advancedToNextQuestion: false;
  readonly requiresExplicitSubmitCall: true;
}

export interface AssistanceEventRequestDescriptor {
  readonly operationId: "recordAssessmentAssistanceEvent";
  readonly method: "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly event_id: string;
    readonly assistance_kind: "staged_hint" | "worked_solution_study";
  };
}

export interface RecordedAssistanceEvent {
  readonly eventId: string;
  readonly questionId: string;
  readonly assistanceKind: "staged_hint" | "worked_solution_study";
  readonly hintStage: number;
  readonly content: string;
  readonly countsAsIndependentAttempt: false;
  readonly resultingCompetenceStatus: "in_progress";
  readonly request: AssistanceEventRequestDescriptor;
}

export interface StagedHintOutcome {
  readonly eventId: string;
  readonly questionId: string;
  readonly assistanceKind: "staged_hint";
  readonly hintStage: number;
  readonly totalHintsForQuestion: number;
  readonly hintText: string;
  readonly declaredAssistance: DeclaredAssistanceKind;
  readonly assistanceEvidence: AssistanceEvidenceKind;
  readonly countsAsIndependentAttempt: false;
  readonly canEstablishDemonstratedCompetence: false;
  readonly resultingCompetenceStatus: "in_progress";
  readonly request: AssistanceEventRequestDescriptor;
}

export interface WorkedSolutionWarningPreview {
  readonly warningShownBeforeReveal: true;
  readonly warningMessage: string;
  readonly recordsCompetenceStatus: "in_progress";
  readonly canEstablishDemonstratedCompetence: false;
  readonly countsAsIndependentAttempt: false;
}

export interface WorkedSolutionRevealOutcome {
  readonly eventId: string;
  readonly questionId: string;
  readonly assistanceKind: "worked_solution_study";
  readonly warningShownBeforeReveal: true;
  readonly warningMessage: string;
  readonly solutionRevealed: boolean;
  readonly workedSolutionText: string | null;
  readonly declaredAssistance: "solution_viewed";
  readonly assistanceEvidence: "observed_solution_viewed";
  readonly countsAsIndependentAttempt: false;
  readonly canEstablishDemonstratedCompetence: false;
  readonly resultingCompetenceStatus: "in_progress";
  readonly resultingProficiencyStatus: "in_progress";
  readonly request: AssistanceEventRequestDescriptor;
}

export interface DefectiveItemReportRequestDescriptor {
  readonly operationId: "reportDefectiveAssessmentItem";
  readonly method: "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: { readonly reason: string };
}

export interface DefectiveItemReportRecord {
  readonly reportId: string;
  readonly assessmentId: string;
  readonly itemId: string;
  readonly reason: string;
  readonly reportedAt: string;
  readonly status: "queued";
  readonly preservesAttemptHistory: true;
  readonly request: DefectiveItemReportRequestDescriptor;
}

export interface SubmitAssessmentAttemptRequestDescriptor {
  readonly operationId: "submitAssessmentAttempt";
  readonly method: "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly attempt_id: string;
    readonly assessment_version_id: string;
    readonly syllabus_revision_id: string;
    readonly activity_id: string;
    readonly answers: readonly AssessmentSelectedAnswer[];
    readonly declared_assistance: DeclaredAssistanceKind;
    readonly client_elapsed_seconds: number | null;
  };
}

export interface AssessmentQuestionFeedbackView {
  readonly questionId: string;
  readonly prompt: string;
  readonly learnerResponseSummary: string;
  readonly message: string;
  readonly correctiveNextAction: string;
  readonly sourceResourceVersionIds: readonly string[];
  readonly assuranceLevel: "reviewed_deterministic" | "advisory_model_assisted" | "formative_practice";
  readonly uncertaintyDisclosure: string;
}

export interface AssessmentAttemptSubmissionOutcome {
  readonly attemptId: string;
  readonly status: "scored" | "pending" | "requires_review" | "invalidated" | "corrected";
  readonly evaluationRevisionId: string;
  readonly previousEvaluationRevisionId: string | null;
  readonly invalidationReason: string | null;
  readonly scoreFraction: number | null;
  readonly gradingMethod: AssessmentGradingMethod;
  readonly evidenceStatus: "formative_only" | "needs_review" | "reviewed_anchor_evidence";
  readonly assessmentPurpose: AssessmentPurpose;
  readonly declaredAssistance: DeclaredAssistanceKind;
  readonly assistanceEvidence: AssistanceEvidenceKind;
  readonly resultingExecutionStatus: ActivityExecutionStatus;
  readonly resultingProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly canEstablishDemonstratedCompetence: boolean;
  readonly feedback: readonly AssessmentQuestionFeedbackView[];
  readonly preservesQuestionResponseAssuranceAndUncertainty: true;
  readonly request: SubmitAssessmentAttemptRequestDescriptor;
}

export interface KeyCorrectionProjectionOutcome {
  readonly correctionId: string;
  readonly assessmentId: string;
  readonly assessmentVersionId: string;
  readonly correctionReason: string;
  readonly originalAttemptRetainedAndInspectable: true;
  readonly previousEvaluationRevisionId: string;
  readonly newEvaluationRevisionId: string;
  readonly resultingAttemptStatus: "invalidated" | "corrected";
  readonly recomputedProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly dependentWaiversInvalidated: boolean;
  readonly activeSyllabusSilentlyReplaced: false;
  readonly explanation: string;
  readonly request: {
    readonly operationId: "applyAssessmentKeyCorrection";
    readonly method: "POST";
    readonly path: string;
    readonly headers: Record<string, string>;
    readonly body: {
      readonly assessment_version_id: string;
      readonly correction_reason: string;
      readonly invalidate_prior_demonstrations: boolean;
    };
  };
}

export interface AssessmentSessionModel {
  readonly sessionId: string;
  readonly assessmentId: string;
  readonly assessmentVersionId: string;
  readonly syllabusRevisionId: string;
  readonly activityId: string;
  readonly title: string;
  readonly purpose: AssessmentPurpose;
  readonly contentReviewStatus: AssessmentContentReviewStatus;
  readonly gradingMethod: AssessmentGradingMethod;
  readonly sourceResourceVersionIds: readonly string[];
  readonly attemptPolicyRef: string;
  readonly isReviewedAnchor: boolean;
  readonly isFormativeOnly: boolean;
  readonly questions: readonly AssessmentQuestionView[];
  readonly currentQuestionIndex: number;
  readonly currentQuestionId: string | null;
  readonly selectedAnswers: Readonly<Record<string, AssessmentSelectedAnswer>>;
  readonly submitted: boolean;
  readonly autoSubmitOnSelect: false;
  readonly hintStageByQuestionId: Readonly<Record<string, number>>;
  readonly hintRequested: boolean;
  readonly solutionWarningAcknowledged: boolean;
  readonly solutionWarningMessage: string;
  readonly solutionRevealed: boolean;
  readonly revealedWorkedSolution: string | null;
  readonly declaredAssistance: DeclaredAssistanceKind;
  readonly assistanceEvidence: AssistanceEvidenceKind;
  readonly assistanceEvents: readonly RecordedAssistanceEvent[];
  readonly reportedDefectiveItems: readonly DefectiveItemReportRecord[];
  readonly attemptResult: AssessmentAttemptSubmissionOutcome | null;
  readonly historicalEvaluations: readonly AssessmentAttemptSubmissionOutcome[];
  readonly resultingExecutionStatus: ActivityExecutionStatus;
  readonly resultingProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly canEstablishDemonstratedCompetence: boolean;
  readonly excludesPrivateAnswerKeyBeforeReveal: true;
  readonly codingExecutionMode: "external_only" | "not_applicable";
  readonly impliesUnimplementedInBrowserCodeRunner: false;
  readonly surfaceStyle: ResolvedSurfaceStyle;
}

export interface AssessmentSessionControllerOptions {
  readonly sessionId?: string;
  readonly assessment_id?: string;
  readonly assessmentId?: string;
  readonly assessment_version_id?: string;
  readonly assessmentVersionId?: string;
  readonly syllabus_revision_id?: string;
  readonly syllabusRevisionId?: string;
  readonly activity_id?: string;
  readonly activityId?: string;
  readonly title?: string;
  readonly purpose?: AssessmentPurpose;
  readonly content_review_status?: AssessmentContentReviewStatus;
  readonly contentReviewStatus?: AssessmentContentReviewStatus;
  readonly grading_method?: AssessmentGradingMethod;
  readonly gradingMethod?: AssessmentGradingMethod;
  readonly source_resource_version_ids?: readonly string[];
  readonly sourceResourceVersionIds?: readonly string[];
  readonly attempt_policy_ref?: string;
  readonly attemptPolicyRef?: string;
  readonly questions?: readonly AssessmentQuestionInput[];
  readonly workedSolution?: string;
  readonly worked_solution?: string;
  readonly requireConfirmationBeforeSolutionReveal?: boolean;
  readonly appearance?: AppearancePreferences;
  readonly env?: EnvironmentMediaPreferences;
}

export interface AssessmentSessionController {
  getState(): AssessmentSessionModel;
  getModel(): AssessmentSessionModel;
  selectChoice(questionIdOrOptionId: string, optionId?: string): AssessmentChoiceSelectionOutcome;
  selectOption(questionIdOrOptionId: string, optionId?: string): AssessmentChoiceSelectionOutcome;
  selectAnswer(questionIdOrOptionId: string, optionOrOptions?: string | readonly string[]): AssessmentChoiceSelectionOutcome;
  setShortAnswer(questionIdOrText: string, text?: string): AssessmentChoiceSelectionOutcome;
  requestHint(questionIdOrOptions?: string | { readonly questionId?: string; readonly eventId?: string }): StagedHintOutcome;
  previewWorkedSolutionWarning(): WorkedSolutionWarningPreview;
  revealWorkedSolution(options?: {
    readonly questionId?: string;
    readonly eventId?: string;
    readonly confirmed?: boolean;
  }): WorkedSolutionRevealOutcome;
  submitAttempt(options?: {
    readonly attemptId?: string;
    readonly clientElapsedSeconds?: number | null;
    readonly scoreFraction?: number | null;
  }): AssessmentAttemptSubmissionOutcome;
  reportDefectiveItem(
    itemIdOrReason: string | { readonly itemId?: string; readonly reason: string },
    reason?: string,
  ): DefectiveItemReportRecord;
  applyKeyCorrection(options: {
    readonly correctionId?: string;
    readonly correctionReason: string;
    readonly invalidatePriorDemonstrations?: boolean;
  }): KeyCorrectionProjectionOutcome;
}

export type NonQualifyingPrerequisiteSupport =
  | "none"
  | "self_reported"
  | "high_self_rating"
  | "external_course_completion"
  | "elapsed_study_time"
  | "upvotes"
  | "assisted_answer"
  | "advisory_ai_grade"
  | "assessment_gap";

export type MasteryGateStatus =
  | "open"
  | "study_ahead_with_warning"
  | "satisfied_by_demonstrated_evidence"
  | "requires_demonstration_or_override"
  | "override_recorded"
  | "requires_unverified_acknowledgement"
  | "unverified_prerequisite_acknowledged";

export type AuditableGateEventType =
  | "prerequisite_override_recorded"
  | "unverified_prerequisite_acknowledged";

export interface AuditableGateDecisionProgressEventRequest {
  readonly operationId: "appendProgressEvent";
  readonly method: "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly event_id: string;
    readonly syllabus_revision_id: string;
    readonly activity_id: string;
    readonly type: AuditableGateEventType;
    readonly occurred_at: string;
    readonly client_timezone: string;
    readonly note: string;
    readonly time_spent_minutes: 0;
  };
}

export interface MasteryGateEvaluationInput {
  readonly syllabusId?: string;
  readonly syllabus_id?: string;
  readonly syllabusRevisionId?: string;
  readonly syllabus_revision_id?: string;
  readonly activityId?: string;
  readonly activity_id?: string;
  readonly activityTitle?: string;
  readonly masteryGated?: boolean;
  readonly mastery_gated?: boolean;
  readonly prerequisiteObjectiveIds?: readonly string[];
  readonly prerequisite_objective_ids?: readonly string[];
  readonly prerequisiteProficiencyStatus?: ObjectiveProficiencyBadgeStatus | "unknown";
  readonly prerequisite_proficiency_status?: ObjectiveProficiencyBadgeStatus | "unknown";
  readonly hasQualifyingReviewedEvidence?: boolean;
  readonly has_qualifying_reviewed_evidence?: boolean;
  readonly nonqualifyingSupport?: NonQualifyingPrerequisiteSupport | string;
  readonly nonqualifying_support?: NonQualifyingPrerequisiteSupport | string;
  readonly hasActiveReviewedAnchor?: boolean;
  readonly has_active_reviewed_anchor?: boolean;
  readonly reviewedAnchorAvailable?: boolean;
  readonly recommendedBridgingActivityIds?: readonly string[];
  readonly recommended_bridging_activity_ids?: readonly string[];
  readonly overrideRationale?: string | null;
  readonly override_rationale?: string | null;
  readonly learnerRationale?: string | null;
  readonly acknowledgedUnverifiedPrerequisite?: boolean;
  readonly acknowledged_unverified_prerequisite?: boolean;
  readonly acknowledged?: boolean;
  readonly eventId?: string;
  readonly event_id?: string;
  readonly occurredAt?: string;
  readonly clientTimezone?: string;
}

export interface MasteryGateModalState {
  readonly activityId: string;
  readonly activityTitle: string;
  readonly masteryGated: boolean;
  readonly hasActiveReviewedAnchor: boolean;
  readonly prerequisiteObjectiveIds: readonly string[];
  readonly prerequisiteProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly prerequisiteSatisfiedByDemonstratedEvidence: boolean;
  readonly nonqualifyingSupportRejected: boolean;
  readonly gateStatus: MasteryGateStatus;
  readonly canProceedImmediately: boolean;
  readonly allowedToProceedImmediately: boolean;
  readonly canProceed: boolean;
  readonly blocking: boolean;
  readonly hardLocked: false;
  readonly hasPrerequisiteWarning: boolean;
  readonly warningMessage: string | null;
  readonly notice: string;
  readonly unverifiedPrerequisiteNotice: string | null;
  readonly bannerText: string;
  readonly recommendedBridgingActivityIds: readonly string[];
  readonly recommendedBridgeActivities: readonly string[];
  readonly requiredAuditEventType: AuditableGateEventType | null;
  readonly requiresLearnerRationale: boolean;
  readonly auditableDecisionRecorded: boolean;
  readonly auditableEventType: AuditableGateEventType | null;
  readonly auditProgressEventRequest: AuditableGateDecisionProgressEventRequest | null;
  readonly createsPrerequisiteWaiver: false;
  readonly marksSkippedActivityCompleted: false;
  readonly grantsPrerequisiteProficiency: false;
  readonly prerequisiteGateRemainsUnsatisfied: boolean;
  readonly surfaceStyle: ResolvedSurfaceStyle;
}
