/**
 * Slice 6 (`T05`) — Practice, Reviewed Anchor Assessments, Mastery Gates & Honest Progress UI
 * (`UI-015`, `PED-001`..`PED-007`, `ADAPT-002`..`ADAPT-005`, `ADAPT-008`, `ADAPT-010`,
 * `@S13`..`@S19`, `@S45`, `@S46`, `@S49`, `@S51`, `@S55`, `@S58`, `@S76`, `@S77`, `@S81`).
 */

const buildOperationHeaders = (_operationId: string): Record<string, string> => ({
  Accept: "application/json",
  "Content-Type": "application/json",
});
import {
  resolveSurfaceStyle,
  type AppearancePreferences,
  type EnvironmentMediaPreferences,
  type ResolvedSurfaceStyle,
} from "./theme.ts";
import {
  renderAccessibleMathFormula,
  sanitizeText,
  type AccessibleMathFormulaView,
} from "./SafeActivityRenderer.ts";
import type {
  ActivityExecutionStatus,
  ObjectiveProficiencyBadgeStatus,
} from "./PlanMapAndOutline.ts";

export const UNVERIFIED_PREREQUISITE_NOTICE =
  "Prerequisite unverified — no reviewed anchor available" as const;

export const WORKED_SOLUTION_ASSISTANCE_WARNING =
  "Warning: revealing the worked solution records assisted study (in_progress) rather than demonstrated competence." as const;

export type AssessmentPurpose = "practice" | "independent_probe" | "delayed_probe" | "transfer_probe" | "diagnostic";
export type AssessmentContentReviewStatus = "curator_reviewed" | "automated_checks_only";
export type AssessmentGradingMethod = "deterministic" | "human" | "model_assisted" | "ungraded";
export type DeclaredAssistanceKind = "none" | "hints" | "solution_viewed" | "ai" | "human" | "mixed" | "unknown";
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

const DEFAULT_QUESTIONS: readonly AssessmentQuestionInput[] = [
  {
    question_id: "question-tokenization-tradeoff-1",
    prompt: "How does a smaller subword vocabulary affect token sequence length and out-of-vocabulary handling?",
    math_formula: "\\text{tokens}(x) \\propto \\frac{1}{|V|}",
    objective_ids: ["objective-tokenization"],
    type: "single_choice",
    options: [
      { option_id: "opt-longer-sequences", text: "It increases average token sequence length while reducing unknown-token fallbacks." },
      { option_id: "opt-shorter-sequences", text: "It decreases average token sequence length while eliminating all subword splits." },
    ],
    hints: [
      "Hint 1: Consider what happens to rare words when fewer merged subword units exist in the vocabulary.",
      "Hint 2: Smaller vocabularies decompose rare words into more granular pieces, increasing sequence length.",
    ],
    worked_solution:
      "Worked solution: A smaller subword vocabulary splits rare words into shorter subword/character units, increasing sequence length while avoiding whole-word OOV tokens.",
  },
];

const clean = (raw: unknown, fallback = "") => sanitizeText(raw, fallback, 2000);

export function createAssessmentSessionController(
  options: AssessmentSessionControllerOptions = {},
): AssessmentSessionController {
  const sessionId = clean(options.sessionId, "assessment-session-1");
  const assessmentId = clean(options.assessmentId ?? options.assessment_id, "synthetic-assessment-1");
  const assessmentVersionId = clean(options.assessmentVersionId ?? options.assessment_version_id, `${assessmentId}-v1`);
  const syllabusRevisionId = clean(options.syllabusRevisionId ?? options.syllabus_revision_id, "synthetic-revision-1");
  const activityId = clean(options.activityId ?? options.activity_id, "activity-quiz");
  const title = clean(options.title, "Explain a tradeoff");
  const purpose: AssessmentPurpose = options.purpose ?? "independent_probe";
  const contentReviewStatus: AssessmentContentReviewStatus =
    options.contentReviewStatus ?? options.content_review_status ?? "curator_reviewed";
  const gradingMethod: AssessmentGradingMethod =
    options.gradingMethod ?? options.grading_method ?? (contentReviewStatus === "curator_reviewed" ? "deterministic" : "model_assisted");
  const sourceResourceVersionIds = (
    options.sourceResourceVersionIds ?? options.source_resource_version_ids ?? ["synthetic-resource-tokenization-v1"]
  ).map((id) => clean(id));
  const attemptPolicyRef = clean(options.attemptPolicyRef ?? options.attempt_policy_ref, "synthetic-attempt-policy");

  const rawQuestions = options.questions && options.questions.length > 0 ? options.questions : DEFAULT_QUESTIONS;
  const hintsByQuestionId = new Map<string, readonly string[]>();
  const workedSolutionByQuestionId = new Map<string, string>();

  const questions: AssessmentQuestionView[] = rawQuestions.map((q, idx) => {
    const qId = clean(q.questionId ?? q.question_id, `question-${idx + 1}`);
    const rawMath = q.mathFormula ?? q.math_formula;
    const qType = q.type ?? "single_choice";
    const hints =
      Array.isArray(q.hints) && q.hints.length > 0
        ? q.hints.map((h) => clean(h))
        : [
            "Hint 1: Review the primary concept definition and compare boundary cases.",
            "Hint 2: Trace how the input representation changes the output sequence step by step.",
          ];
    hintsByQuestionId.set(qId, hints);
    workedSolutionByQuestionId.set(
      qId,
      clean(
        q.workedSolution ?? q.worked_solution ?? options.workedSolution ?? options.worked_solution,
        "Worked solution: Inspect how each representation choice trades vocabulary size against sequence length.",
      ),
    );

    return {
      questionId: qId,
      prompt: clean(q.prompt, `Question ${idx + 1}`),
      mathFormula: typeof rawMath === "string" && rawMath.trim().length > 0 ? renderAccessibleMathFormula(rawMath, { displayMode: "block" }) : null,
      objectiveIds: (q.objectiveIds ?? q.objective_ids ?? ["objective-tokenization"]).map((id) => clean(id)),
      type: qType,
      options: Array.isArray(q.options)
        ? q.options.map((o, oIdx) => ({
            optionId: clean(o.optionId ?? o.option_id, `option-${oIdx + 1}`),
            text: clean(o.text, `Option ${oIdx + 1}`),
          }))
        : [],
      maxCharacters: qType === "short_answer" ? (q.maxCharacters ?? q.max_characters ?? 2000) : null,
      availableHintCount: hints.length,
    };
  });

  const currentQuestionIndex = 0;
  const currentQuestionId = questions[0]?.questionId ?? null;
  const selectedAnswers: Record<string, AssessmentSelectedAnswer> = {};
  const hintStageByQuestionId: Record<string, number> = Object.fromEntries(questions.map((q) => [q.questionId, 0]));

  let submitted = false;
  let hintRequested = false;
  let solutionWarningAcknowledged = false;
  let solutionRevealed = false;
  let revealedWorkedSolution: string | null = null;
  let declaredAssistance: DeclaredAssistanceKind = "none";
  let assistanceEvidence: AssistanceEvidenceKind = "observed_unassisted_in_app";
  const assistanceEvents: RecordedAssistanceEvent[] = [];
  const reportedDefectiveItems: DefectiveItemReportRecord[] = [];
  let attemptResult: AssessmentAttemptSubmissionOutcome | null = null;
  const historicalEvaluations: AssessmentAttemptSubmissionOutcome[] = [];
  let assistSeq = 1;
  let reportSeq = 1;
  let evaluationSeq = 1;

  const isReviewedAnchor =
    contentReviewStatus === "curator_reviewed" &&
    gradingMethod !== "model_assisted" &&
    gradingMethod !== "ungraded" &&
    purpose !== "practice";
  const isFormativeOnly = !isReviewedAnchor;
  const surfaceStyle = resolveSurfaceStyle("assessment", options.appearance ?? {}, options.env ?? {});

  const getState = (): AssessmentSessionModel => ({
    sessionId,
    assessmentId,
    assessmentVersionId,
    syllabusRevisionId,
    activityId,
    title,
    purpose,
    contentReviewStatus,
    gradingMethod,
    sourceResourceVersionIds,
    attemptPolicyRef,
    isReviewedAnchor,
    isFormativeOnly,
    questions,
    currentQuestionIndex,
    currentQuestionId,
    selectedAnswers: { ...selectedAnswers },
    submitted,
    autoSubmitOnSelect: false,
    hintStageByQuestionId: { ...hintStageByQuestionId },
    hintRequested,
    solutionWarningAcknowledged,
    solutionWarningMessage: WORKED_SOLUTION_ASSISTANCE_WARNING,
    solutionRevealed,
    revealedWorkedSolution: solutionRevealed ? revealedWorkedSolution : null,
    declaredAssistance,
    assistanceEvidence,
    assistanceEvents: [...assistanceEvents],
    reportedDefectiveItems: [...reportedDefectiveItems],
    attemptResult,
    historicalEvaluations: [...historicalEvaluations],
    resultingExecutionStatus: attemptResult
      ? attemptResult.resultingExecutionStatus
      : Object.keys(selectedAnswers).length > 0 || hintRequested || solutionRevealed
        ? "in_progress"
        : "not_started",
    resultingProficiencyStatus: attemptResult
      ? attemptResult.resultingProficiencyStatus
      : solutionRevealed || hintRequested
        ? "in_progress"
        : "unassessed",
    canEstablishDemonstratedCompetence: isReviewedAnchor && !solutionRevealed && !hintRequested && declaredAssistance === "none",
    excludesPrivateAnswerKeyBeforeReveal: true,
    codingExecutionMode: "not_applicable",
    impliesUnimplementedInBrowserCodeRunner: false,
    surfaceStyle,
  });

  function selectAnswer(
    questionIdOrOptionId: string,
    optionOrOptions?: string | readonly string[],
  ): AssessmentChoiceSelectionOutcome {
    const targetQuestionId = optionOrOptions === undefined ? (currentQuestionId ?? "question-1") : questionIdOrOptionId;
    const chosenValue = optionOrOptions === undefined ? questionIdOrOptionId : optionOrOptions;
    const question = questions.find((q) => q.questionId === targetQuestionId) ?? questions[0];
    const qId = question?.questionId ?? targetQuestionId;
    const qType = question?.type ?? "single_choice";

    const makeSelectionOutcome = (
      selectedOptionId: string | null,
      selectedOptionIds: readonly string[],
      text: string | null,
    ): AssessmentChoiceSelectionOutcome => ({
      questionId: qId,
      selectedOptionId,
      selectedOptionIds,
      text,
      submitted: false,
      autoSubmitted: false,
      advancedToNextQuestion: false,
      requiresExplicitSubmitCall: true,
    });

    if (qType === "multiple_choice" || Array.isArray(chosenValue)) {
      const optionIds = (Array.isArray(chosenValue) ? chosenValue : [chosenValue]).map((v) => clean(v));
      selectedAnswers[qId] = { question_id: qId, type: "multiple_choice", selected_option_ids: optionIds };
      return makeSelectionOutcome(optionIds[0] ?? null, optionIds, null);
    }

    if (qType === "short_answer") {
      const cleanText = clean(chosenValue);
      selectedAnswers[qId] = { question_id: qId, type: "short_answer", text: cleanText };
      return makeSelectionOutcome(null, [], cleanText);
    }

    const singleOptionId = clean(chosenValue);
    selectedAnswers[qId] = { question_id: qId, type: "single_choice", selected_option_id: singleOptionId };
    return makeSelectionOutcome(singleOptionId, [singleOptionId], null);
  }

  function buildAssistanceRequest(eventId: string, assistance_kind: "staged_hint" | "worked_solution_study"): AssistanceEventRequestDescriptor {
    return {
      operationId: "recordAssessmentAssistanceEvent",
      method: "POST",
      path: `/assessments/${assessmentId}/assistance-events`,
      headers: buildOperationHeaders("recordAssessmentAssistanceEvent"),
      body: { event_id: eventId, assistance_kind },
    };
  }

  function requestHint(
    questionIdOrOptions?: string | { readonly questionId?: string; readonly eventId?: string },
  ): StagedHintOutcome {
    const qId =
      typeof questionIdOrOptions === "string"
        ? questionIdOrOptions
        : (questionIdOrOptions?.questionId ?? currentQuestionId ?? "question-1");
    const eventId =
      typeof questionIdOrOptions === "object" && questionIdOrOptions?.eventId
        ? questionIdOrOptions.eventId
        : `assist-hint-${assistSeq++}`;

    const hints = hintsByQuestionId.get(qId) ?? ["Hint 1: Re-examine the objective criterion and definitions."];
    const nextStage = Math.min(hints.length, (hintStageByQuestionId[qId] ?? 0) + 1);
    hintStageByQuestionId[qId] = nextStage;
    hintRequested = true;
    if (declaredAssistance === "none") {
      declaredAssistance = "hints";
      assistanceEvidence = "observed_assisted";
    }

    const hintText = hints[Math.max(0, nextStage - 1)] ?? hints[0]!;
    const request = buildAssistanceRequest(eventId, "staged_hint");
    assistanceEvents.push({
      eventId,
      questionId: qId,
      assistanceKind: "staged_hint",
      hintStage: nextStage,
      content: hintText,
      countsAsIndependentAttempt: false,
      resultingCompetenceStatus: "in_progress",
      request,
    });

    return {
      eventId,
      questionId: qId,
      assistanceKind: "staged_hint",
      hintStage: nextStage,
      totalHintsForQuestion: hints.length,
      hintText,
      declaredAssistance,
      assistanceEvidence,
      countsAsIndependentAttempt: false,
      canEstablishDemonstratedCompetence: false,
      resultingCompetenceStatus: "in_progress",
      request,
    };
  }

  function previewWorkedSolutionWarning(): WorkedSolutionWarningPreview {
    solutionWarningAcknowledged = true;
    return {
      warningShownBeforeReveal: true,
      warningMessage: WORKED_SOLUTION_ASSISTANCE_WARNING,
      recordsCompetenceStatus: "in_progress",
      canEstablishDemonstratedCompetence: false,
      countsAsIndependentAttempt: false,
    };
  }

  function revealWorkedSolution(revealOptions?: {
    readonly questionId?: string;
    readonly eventId?: string;
    readonly confirmed?: boolean;
  }): WorkedSolutionRevealOutcome {
    const qId = revealOptions?.questionId ?? currentQuestionId ?? "question-1";
    const eventId = revealOptions?.eventId ?? `assist-solution-${assistSeq++}`;
    const request = buildAssistanceRequest(eventId, "worked_solution_study");
    solutionWarningAcknowledged = true;

    if (options.requireConfirmationBeforeSolutionReveal === true && revealOptions?.confirmed === false) {
      return {
        eventId,
        questionId: qId,
        assistanceKind: "worked_solution_study",
        warningShownBeforeReveal: true,
        warningMessage: WORKED_SOLUTION_ASSISTANCE_WARNING,
        solutionRevealed: false,
        workedSolutionText: null,
        declaredAssistance: "solution_viewed",
        assistanceEvidence: "observed_solution_viewed",
        countsAsIndependentAttempt: false,
        canEstablishDemonstratedCompetence: false,
        resultingCompetenceStatus: "in_progress",
        resultingProficiencyStatus: "in_progress",
        request,
      };
    }

    solutionRevealed = true;
    declaredAssistance = "solution_viewed";
    assistanceEvidence = "observed_solution_viewed";
    revealedWorkedSolution = workedSolutionByQuestionId.get(qId) ?? "Worked solution: Step-by-step derivation and explanation.";

    assistanceEvents.push({
      eventId,
      questionId: qId,
      assistanceKind: "worked_solution_study",
      hintStage: hintStageByQuestionId[qId] ?? 0,
      content: revealedWorkedSolution,
      countsAsIndependentAttempt: false,
      resultingCompetenceStatus: "in_progress",
      request,
    });

    return {
      eventId,
      questionId: qId,
      assistanceKind: "worked_solution_study",
      warningShownBeforeReveal: true,
      warningMessage: WORKED_SOLUTION_ASSISTANCE_WARNING,
      solutionRevealed: true,
      workedSolutionText: revealedWorkedSolution,
      declaredAssistance: "solution_viewed",
      assistanceEvidence: "observed_solution_viewed",
      countsAsIndependentAttempt: false,
      canEstablishDemonstratedCompetence: false,
      resultingCompetenceStatus: "in_progress",
      resultingProficiencyStatus: "in_progress",
      request,
    };
  }

  function submitAttempt(submitOptions?: {
    readonly attemptId?: string;
    readonly clientElapsedSeconds?: number | null;
    readonly scoreFraction?: number | null;
  }): AssessmentAttemptSubmissionOutcome {
    const answersList = Object.values(selectedAnswers);
    if (answersList.length === 0) {
      throw new Error("Cannot submit assessment attempt before selecting or entering at least one answer (@S14, @S77).");
    }

    const attemptId = clean(submitOptions?.attemptId, `attempt-${evaluationSeq}`);
    const clientElapsedSeconds = submitOptions?.clientElapsedSeconds !== undefined ? submitOptions.clientElapsedSeconds : 45;
    const scoreFraction = submitOptions?.scoreFraction !== undefined ? submitOptions.scoreFraction : 1.0;

    const request: SubmitAssessmentAttemptRequestDescriptor = {
      operationId: "submitAssessmentAttempt",
      method: "POST",
      path: `/assessments/${assessmentId}/attempts`,
      headers: buildOperationHeaders("submitAssessmentAttempt"),
      body: {
        attempt_id: attemptId,
        assessment_version_id: assessmentVersionId,
        syllabus_revision_id: syllabusRevisionId,
        activity_id: activityId,
        answers: answersList,
        declared_assistance: declaredAssistance,
        client_elapsed_seconds: clientElapsedSeconds,
      },
    };

    const unassistedPass =
      isReviewedAnchor && declaredAssistance === "none" && !hintRequested && !solutionRevealed &&
      scoreFraction !== null && scoreFraction >= 0.8;

    const resultingProficiencyStatus: ObjectiveProficiencyBadgeStatus = unassistedPass ? "demonstrated" : "in_progress";
    const resultingExecutionStatus: ActivityExecutionStatus = solutionRevealed || hintRequested ? "in_progress" : "completed";
    const evidenceStatus: "formative_only" | "needs_review" | "reviewed_anchor_evidence" = unassistedPass
      ? "reviewed_anchor_evidence"
      : isFormativeOnly || solutionRevealed || hintRequested
        ? "formative_only"
        : "needs_review";

    const assuranceLevel: "reviewed_deterministic" | "advisory_model_assisted" | "formative_practice" =
      contentReviewStatus === "curator_reviewed" && gradingMethod === "deterministic"
        ? "reviewed_deterministic"
        : gradingMethod === "model_assisted"
          ? "advisory_model_assisted"
          : "formative_practice";

    const uncertaintyDisclosure = unassistedPass
      ? "Reviewed anchor item; no in-app assistance observed. Outside assistance cannot be guaranteed absent."
      : solutionRevealed
        ? "Worked solution was revealed; recorded as solution-assisted study (in_progress) rather than demonstrated competence."
        : hintRequested
          ? "Staged hints were used; recorded as assisted practice (in_progress) rather than independent demonstration."
          : isFormativeOnly
            ? "Formative or unreviewed AI item: advisory feedback only; cannot independently establish demonstrated competence."
            : "Additional independent practice or review is recommended to satisfy the objective criterion.";

    const feedback: AssessmentQuestionFeedbackView[] = answersList.map((ans) => {
      const q = questions.find((item) => item.questionId === ans.question_id);
      const learnerResponseSummary =
        ans.type === "single_choice"
          ? ans.selected_option_id
          : ans.type === "multiple_choice"
            ? ans.selected_option_ids.join(", ")
            : ans.text;
      return {
        questionId: ans.question_id,
        prompt: q?.prompt ?? ans.question_id,
        learnerResponseSummary,
        message:
          scoreFraction !== null && scoreFraction >= 0.8
            ? "Response aligns with the expected tradeoff explanation."
            : "Response misses a key condition in the objective criterion.",
        correctiveNextAction: unassistedPass
          ? "Proceed to the scheduled spaced review session to consolidate retention."
          : "Inspect the source segment and complete an unassisted follow-up anchor check.",
        sourceResourceVersionIds,
        assuranceLevel,
        uncertaintyDisclosure,
      };
    });

    submitted = true;
    const outcome: AssessmentAttemptSubmissionOutcome = {
      attemptId,
      status: gradingMethod === "model_assisted" ? "requires_review" : "scored",
      evaluationRevisionId: `eval-rev-${evaluationSeq++}`,
      previousEvaluationRevisionId: null,
      invalidationReason: null,
      scoreFraction,
      gradingMethod,
      evidenceStatus,
      assessmentPurpose: purpose,
      declaredAssistance,
      assistanceEvidence,
      resultingExecutionStatus,
      resultingProficiencyStatus,
      canEstablishDemonstratedCompetence: unassistedPass,
      feedback,
      preservesQuestionResponseAssuranceAndUncertainty: true,
      request,
    };

    attemptResult = outcome;
    historicalEvaluations.push(outcome);
    return outcome;
  }

  function reportDefectiveItem(
    itemIdOrReason: string | { readonly itemId?: string; readonly reason: string },
    explicitReason?: string,
  ): DefectiveItemReportRecord {
    const defaultItemId = currentQuestionId ?? assessmentId;
    const itemId =
      typeof itemIdOrReason === "object" && itemIdOrReason !== null
        ? clean(itemIdOrReason.itemId, defaultItemId)
        : explicitReason !== undefined
          ? clean(itemIdOrReason, defaultItemId)
          : defaultItemId;
    const rawReason =
      typeof itemIdOrReason === "object" && itemIdOrReason !== null
        ? clean(itemIdOrReason.reason)
        : clean(explicitReason ?? itemIdOrReason);

    if (!rawReason || rawReason.trim().length < 5) {
      throw new Error("A defective assessment item report requires a reason of at least 5 characters (PED-005).");
    }

    const record: DefectiveItemReportRecord = {
      reportId: `defect-report-${reportSeq++}`,
      assessmentId,
      itemId,
      reason: rawReason,
      reportedAt: "2026-10-20T16:30:00Z",
      status: "queued",
      preservesAttemptHistory: true,
      request: {
        operationId: "reportDefectiveAssessmentItem",
        method: "POST",
        path: `/assessments/${assessmentId}/reports`,
        headers: buildOperationHeaders("reportDefectiveAssessmentItem"),
        body: { reason: rawReason },
      },
    };
    reportedDefectiveItems.push(record);
    return record;
  }

  function applyKeyCorrection(correctionOptions: {
    readonly correctionId?: string;
    readonly correctionReason: string;
    readonly invalidatePriorDemonstrations?: boolean;
  }): KeyCorrectionProjectionOutcome {
    const correctionReason = clean(correctionOptions.correctionReason);
    if (!correctionReason) {
      throw new Error("A correction reason is required to apply an assessment key correction.");
    }
    const invalidatePrior = correctionOptions.invalidatePriorDemonstrations !== false;
    const prevEvalId = attemptResult?.evaluationRevisionId ?? "eval-rev-0";
    const newEvalId = `eval-rev-${evaluationSeq++}`;
    const newStatus: "invalidated" | "corrected" = invalidatePrior ? "invalidated" : "corrected";
    const recomputedProficiencyStatus: ObjectiveProficiencyBadgeStatus = invalidatePrior
      ? "needs_review"
      : (attemptResult?.resultingProficiencyStatus ?? "in_progress");

    if (attemptResult) {
      attemptResult = {
        ...attemptResult,
        status: newStatus,
        evaluationRevisionId: newEvalId,
        previousEvaluationRevisionId: prevEvalId,
        invalidationReason: correctionReason,
        evidenceStatus: "needs_review",
        resultingProficiencyStatus: recomputedProficiencyStatus,
        canEstablishDemonstratedCompetence: false,
      };
      historicalEvaluations.push(attemptResult);
    }

    return {
      correctionId: clean(correctionOptions.correctionId, `correction-${evaluationSeq}`),
      assessmentId,
      assessmentVersionId,
      correctionReason,
      originalAttemptRetainedAndInspectable: true,
      previousEvaluationRevisionId: prevEvalId,
      newEvaluationRevisionId: newEvalId,
      resultingAttemptStatus: newStatus,
      recomputedProficiencyStatus,
      dependentWaiversInvalidated: invalidatePrior,
      activeSyllabusSilentlyReplaced: false,
      explanation: `Answer-key correction applied (${correctionReason}). Original attempt and evaluation ${prevEvalId} remain inspectable; dependent proficiency and waivers were recomputed without silently replacing the active plan (@S46, @S55).`,
      request: {
        operationId: "applyAssessmentKeyCorrection",
        method: "POST",
        path: `/admin/assessments/${assessmentId}/key-corrections`,
        headers: buildOperationHeaders("applyAssessmentKeyCorrection"),
        body: {
          assessment_version_id: assessmentVersionId,
          correction_reason: correctionReason,
          invalidate_prior_demonstrations: invalidatePrior,
        },
      },
    };
  }

  return {
    getState,
    getModel: getState,
    selectChoice: selectAnswer,
    selectOption: selectAnswer,
    selectAnswer,
    setShortAnswer: (qOrText: string, text?: string) =>
      text === undefined ? selectAnswer(currentQuestionId ?? "question-1", qOrText) : selectAnswer(qOrText, text),
    requestHint,
    previewWorkedSolutionWarning,
    revealWorkedSolution,
    submitAttempt,
    reportDefectiveItem,
    applyKeyCorrection,
  };
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
    rawSupport !== "none" && rawSupport !== "" &&
    input.hasQualifyingReviewedEvidence !== true && input.has_qualifying_reviewed_evidence !== true;

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
