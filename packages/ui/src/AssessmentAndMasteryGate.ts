/**
 * Slice 6 (`T05`) — Practice, Reviewed Anchor Assessments, Mastery Gates & Honest Progress UI
 * (`UI-015`, `PED-001`..`PED-007`, `ADAPT-002`..`ADAPT-005`, `ADAPT-008`, `ADAPT-010`,
 * `@S13`..`@S19`, `@S45`, `@S46`, `@S49`, `@S51`, `@S55`, `@S58`, `@S76`, `@S77`, `@S81`).
 */

import { buildOperationHeaders } from "../../api-client/src/index.ts";
import {
  resolveSurfaceStyle,
  type AppearancePreferences,
  type EnvironmentMediaPreferences,
  type ResolvedSurfaceStyle,
} from "./theme.ts";
import {
  renderAccessibleMathFormula,
  renderUntrustedCatalogText,
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
  | {
      readonly question_id: string;
      readonly type: "single_choice";
      readonly selected_option_id: string;
    }
  | {
      readonly question_id: string;
      readonly type: "multiple_choice";
      readonly selected_option_ids: readonly string[];
    }
  | {
      readonly question_id: string;
      readonly type: "short_answer";
      readonly text: string;
    };

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
  readonly body: {
    readonly reason: string;
  };
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
    readonly curriculum_revision_id: string;
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
  readonly activeCurriculumSilentlyReplaced: false;
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
  readonly curriculumRevisionId: string;
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
  readonly curriculum_revision_id?: string;
  readonly curriculumRevisionId?: string;
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
  selectAnswer(
    questionIdOrOptionId: string,
    optionOrOptions?: string | readonly string[]
  ): AssessmentChoiceSelectionOutcome;
  setShortAnswer(questionIdOrText: string, text?: string): AssessmentChoiceSelectionOutcome;
  requestHint(
    questionIdOrOptions?: string | { readonly questionId?: string; readonly eventId?: string }
  ): StagedHintOutcome;
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
    reason?: string
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
      {
        option_id: "opt-longer-sequences",
        text: "It increases average token sequence length while reducing unknown-token fallbacks.",
      },
      {
        option_id: "opt-shorter-sequences",
        text: "It decreases average token sequence length while eliminating all subword splits.",
      },
    ],
    hints: [
      "Hint 1: Consider what happens to rare words when fewer merged subword units exist in the vocabulary.",
      "Hint 2: Smaller vocabularies decompose rare words into more granular pieces, increasing sequence length.",
    ],
    worked_solution:
      "Worked solution: A smaller subword vocabulary splits rare words into shorter subword/character units, increasing sequence length while avoiding whole-word OOV tokens.",
  },
];

function sanitizeText(raw: unknown, fallback = ""): string {
  if (typeof raw !== "string") {
    return fallback;
  }
  const clean = renderUntrustedCatalogText(raw, { maxLength: 2000 }).text;
  return clean || fallback;
}

/**
 * Creates the Practice & Reviewed Anchor Assessment Session Controller
 * (`UI-015`, `PED-002`, `PED-004`..`PED-007`, `@S14`..`@S18`, `@S45`, `@S46`, `@S51`, `@S58`, `@S76`, `@S77`, `@S81`).
 *
 * Key Invariants:
 * 1. Selecting an answer choice NEVER auto-submits (`autoSubmitOnSelect: false`, `@S77`);
 *    requires an explicit `submitAttempt()` call.
 * 2. Tracks staged assistance (`requestHint()`, `revealWorkedSolution()`): warns the learner
 *    before revealing a worked solution that assisted completion records `in_progress`
 *    rather than `demonstrated` competence (`@S14`, `@S16`, `@S45`, `@S77`).
 * 3. Supports reporting a defective item (`reportDefectiveItem(itemId, reason)` `@S58`, `PED-005`)
 *    and attributable answer-key correction invalidation (`@S46`, `@S55`).
 */
export function createAssessmentSessionController(
  options: AssessmentSessionControllerOptions = {}
): AssessmentSessionController {
  const sessionId = sanitizeText(options.sessionId, "assessment-session-1");
  const assessmentId = sanitizeText(
    options.assessmentId ?? options.assessment_id,
    "synthetic-assessment-1"
  );
  const assessmentVersionId = sanitizeText(
    options.assessmentVersionId ?? options.assessment_version_id,
    `${assessmentId}-v1`
  );
  const curriculumRevisionId = sanitizeText(
    options.curriculumRevisionId ?? options.curriculum_revision_id,
    "synthetic-revision-1"
  );
  const activityId = sanitizeText(options.activityId ?? options.activity_id, "activity-quiz");
  const title = sanitizeText(options.title, "Explain a tradeoff");
  const purpose: AssessmentPurpose = options.purpose ?? "independent_probe";
  const contentReviewStatus: AssessmentContentReviewStatus =
    options.contentReviewStatus ?? options.content_review_status ?? "curator_reviewed";
  const gradingMethod: AssessmentGradingMethod =
    options.gradingMethod ??
    options.grading_method ??
    (contentReviewStatus === "curator_reviewed" ? "deterministic" : "model_assisted");
  const sourceResourceVersionIds = (
    options.sourceResourceVersionIds ??
    options.source_resource_version_ids ?? ["synthetic-resource-tokenization-v1"]
  ).map((id) => sanitizeText(id));
  const attemptPolicyRef = sanitizeText(
    options.attemptPolicyRef ?? options.attempt_policy_ref,
    "synthetic-attempt-policy"
  );

  const rawQuestions =
    options.questions && options.questions.length > 0 ? options.questions : DEFAULT_QUESTIONS;

  const hintsByQuestionId = new Map<string, readonly string[]>();
  const workedSolutionByQuestionId = new Map<string, string>();

  const questions: AssessmentQuestionView[] = rawQuestions.map((q, idx) => {
    const qId = sanitizeText(q.questionId ?? q.question_id, `question-${idx + 1}`);
    const prompt = sanitizeText(q.prompt, `Question ${idx + 1}`);
    const rawMath = q.mathFormula ?? q.math_formula;
    const mathFormula =
      typeof rawMath === "string" && rawMath.trim().length > 0
        ? renderAccessibleMathFormula(rawMath, { displayMode: "block" })
        : null;
    const objectiveIds = (q.objectiveIds ?? q.objective_ids ?? ["objective-tokenization"]).map(
      (id) => sanitizeText(id)
    );
    const qType = q.type ?? "single_choice";
    const opts: AssessmentQuestionOptionView[] = Array.isArray(q.options)
      ? q.options.map((o, oIdx) => ({
          optionId: sanitizeText(o.optionId ?? o.option_id, `option-${oIdx + 1}`),
          text: sanitizeText(o.text, `Option ${oIdx + 1}`),
        }))
      : [];

    const hints =
      Array.isArray(q.hints) && q.hints.length > 0
        ? q.hints.map((h) => sanitizeText(h))
        : [
            "Hint 1: Review the primary concept definition and compare boundary cases.",
            "Hint 2: Trace how the input representation changes the output sequence step by step.",
          ];
    hintsByQuestionId.set(qId, hints);

    const workedSol = sanitizeText(
      q.workedSolution ??
        q.worked_solution ??
        options.workedSolution ??
        options.worked_solution,
      "Worked solution: Inspect how each representation choice trades vocabulary size against sequence length."
    );
    workedSolutionByQuestionId.set(qId, workedSol);

    return {
      questionId: qId,
      prompt,
      mathFormula,
      objectiveIds,
      type: qType,
      options: opts,
      maxCharacters:
        qType === "short_answer" ? (q.maxCharacters ?? q.max_characters ?? 2000) : null,
      availableHintCount: hints.length,
    };
  });

  const currentQuestionIndex = 0;
  const currentQuestionId = questions[0]?.questionId ?? null;
  const selectedAnswers: Record<string, AssessmentSelectedAnswer> = {};
  const hintStageByQuestionId: Record<string, number> = {};
  for (const q of questions) {
    hintStageByQuestionId[q.questionId] = 0;
  }

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

  const surfaceStyle = resolveSurfaceStyle(
    "assessment",
    options.appearance ?? {},
    options.env ?? {}
  );

  function computeCanEstablishDemonstratedCompetence(): boolean {
    if (!isReviewedAnchor) {
      return false;
    }
    if (solutionRevealed || hintRequested || declaredAssistance !== "none") {
      return false;
    }
    return true;
  }

  function computeResultingProficiencyStatus(): ObjectiveProficiencyBadgeStatus {
    if (attemptResult) {
      return attemptResult.resultingProficiencyStatus;
    }
    if (solutionRevealed || hintRequested) {
      return "in_progress";
    }
    return "unassessed";
  }

  function computeResultingExecutionStatus(): ActivityExecutionStatus {
    if (attemptResult) {
      return attemptResult.resultingExecutionStatus;
    }
    if (
      Object.keys(selectedAnswers).length > 0 ||
      hintRequested ||
      solutionRevealed
    ) {
      return "in_progress";
    }
    return "not_started";
  }

  function getState(): AssessmentSessionModel {
    return {
      sessionId,
      assessmentId,
      assessmentVersionId,
      curriculumRevisionId,
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
      resultingExecutionStatus: computeResultingExecutionStatus(),
      resultingProficiencyStatus: computeResultingProficiencyStatus(),
      canEstablishDemonstratedCompetence: computeCanEstablishDemonstratedCompetence(),
      excludesPrivateAnswerKeyBeforeReveal: true,
      codingExecutionMode: "not_applicable",
      impliesUnimplementedInBrowserCodeRunner: false,
      surfaceStyle,
    };
  }

  function selectAnswer(
    questionIdOrOptionId: string,
    optionOrOptions?: string | readonly string[]
  ): AssessmentChoiceSelectionOutcome {
    let targetQuestionId: string;
    let chosenValue: string | readonly string[];

    if (optionOrOptions === undefined) {
      targetQuestionId = currentQuestionId ?? "question-1";
      chosenValue = questionIdOrOptionId;
    } else {
      targetQuestionId = questionIdOrOptionId;
      chosenValue = optionOrOptions;
    }

    const question =
      questions.find((q) => q.questionId === targetQuestionId) ?? questions[0];
    const qId = question?.questionId ?? targetQuestionId;
    const qType = question?.type ?? "single_choice";

    if (qType === "multiple_choice" || Array.isArray(chosenValue)) {
      const optionIds = (Array.isArray(chosenValue) ? chosenValue : [chosenValue]).map((v) =>
        sanitizeText(v)
      );
      selectedAnswers[qId] = {
        question_id: qId,
        type: "multiple_choice",
        selected_option_ids: optionIds,
      };
      return {
        questionId: qId,
        selectedOptionId: optionIds[0] ?? null,
        selectedOptionIds: optionIds,
        text: null,
        submitted: false,
        autoSubmitted: false,
        advancedToNextQuestion: false,
        requiresExplicitSubmitCall: true,
      };
    }

    if (qType === "short_answer") {
      const cleanText = sanitizeText(chosenValue);
      selectedAnswers[qId] = {
        question_id: qId,
        type: "short_answer",
        text: cleanText,
      };
      return {
        questionId: qId,
        selectedOptionId: null,
        selectedOptionIds: [],
        text: cleanText,
        submitted: false,
        autoSubmitted: false,
        advancedToNextQuestion: false,
        requiresExplicitSubmitCall: true,
      };
    }

    const singleOptionId = sanitizeText(chosenValue);
    selectedAnswers[qId] = {
      question_id: qId,
      type: "single_choice",
      selected_option_id: singleOptionId,
    };

    // Selecting an answer choice NEVER auto-submits (@S77)
    return {
      questionId: qId,
      selectedOptionId: singleOptionId,
      selectedOptionIds: [singleOptionId],
      text: null,
      submitted: false,
      autoSubmitted: false,
      advancedToNextQuestion: false,
      requiresExplicitSubmitCall: true,
    };
  }

  function requestHint(
    questionIdOrOptions?: string | { readonly questionId?: string; readonly eventId?: string }
  ): StagedHintOutcome {
    const qId =
      typeof questionIdOrOptions === "string"
        ? questionIdOrOptions
        : (questionIdOrOptions?.questionId ?? currentQuestionId ?? "question-1");
    const eventId =
      typeof questionIdOrOptions === "object" && questionIdOrOptions?.eventId
        ? questionIdOrOptions.eventId
        : `assist-hint-${assistSeq++}`;

    const hints = hintsByQuestionId.get(qId) ?? [
      "Hint 1: Re-examine the objective criterion and definitions.",
    ];
    const currentStage = hintStageByQuestionId[qId] ?? 0;
    const nextStage = Math.min(hints.length, currentStage + 1);
    hintStageByQuestionId[qId] = nextStage;
    hintRequested = true;

    if (declaredAssistance === "none") {
      declaredAssistance = "hints";
      assistanceEvidence = "observed_assisted";
    }

    const hintText = hints[Math.max(0, nextStage - 1)] ?? hints[0]!;
    const headers = buildOperationHeaders("recordAssessmentAssistanceEvent");
    const request: AssistanceEventRequestDescriptor = {
      operationId: "recordAssessmentAssistanceEvent",
      method: "POST",
      path: `/assessments/${assessmentId}/assistance-events`,
      headers,
      body: {
        event_id: eventId,
        assistance_kind: "staged_hint",
      },
    };

    const recorded: RecordedAssistanceEvent = {
      eventId,
      questionId: qId,
      assistanceKind: "staged_hint",
      hintStage: nextStage,
      content: hintText,
      countsAsIndependentAttempt: false,
      resultingCompetenceStatus: "in_progress",
      request,
    };
    assistanceEvents.push(recorded);

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
    const headers = buildOperationHeaders("recordAssessmentAssistanceEvent");
    const request: AssistanceEventRequestDescriptor = {
      operationId: "recordAssessmentAssistanceEvent",
      method: "POST",
      path: `/assessments/${assessmentId}/assistance-events`,
      headers,
      body: {
        event_id: eventId,
        assistance_kind: "worked_solution_study",
      },
    };

    solutionWarningAcknowledged = true;

    if (
      options.requireConfirmationBeforeSolutionReveal === true &&
      revealOptions?.confirmed === false
    ) {
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
    revealedWorkedSolution =
      workedSolutionByQuestionId.get(qId) ??
      "Worked solution: Step-by-step derivation and explanation.";

    const recorded: RecordedAssistanceEvent = {
      eventId,
      questionId: qId,
      assistanceKind: "worked_solution_study",
      hintStage: hintStageByQuestionId[qId] ?? 0,
      content: revealedWorkedSolution,
      countsAsIndependentAttempt: false,
      resultingCompetenceStatus: "in_progress",
      request,
    };
    assistanceEvents.push(recorded);

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
      throw new Error(
        "Cannot submit assessment attempt before selecting or entering at least one answer (@S14, @S77)."
      );
    }

    const attemptId = sanitizeText(submitOptions?.attemptId, `attempt-${evaluationSeq}`);
    const clientElapsedSeconds =
      submitOptions?.clientElapsedSeconds !== undefined
        ? submitOptions.clientElapsedSeconds
        : 45;
    const scoreFraction =
      submitOptions?.scoreFraction !== undefined ? submitOptions.scoreFraction : 1.0;

    const headers = buildOperationHeaders("submitAssessmentAttempt");
    const request: SubmitAssessmentAttemptRequestDescriptor = {
      operationId: "submitAssessmentAttempt",
      method: "POST",
      path: `/assessments/${assessmentId}/attempts`,
      headers,
      body: {
        attempt_id: attemptId,
        assessment_version_id: assessmentVersionId,
        curriculum_revision_id: curriculumRevisionId,
        activity_id: activityId,
        answers: answersList,
        declared_assistance: declaredAssistance,
        client_elapsed_seconds: clientElapsedSeconds,
      },
    };

    const unassistedPass =
      isReviewedAnchor &&
      declaredAssistance === "none" &&
      !hintRequested &&
      !solutionRevealed &&
      scoreFraction !== null &&
      scoreFraction >= 0.8;

    const resultingProficiencyStatus: ObjectiveProficiencyBadgeStatus = unassistedPass
      ? "demonstrated"
      : "in_progress";

    const resultingExecutionStatus: ActivityExecutionStatus =
      solutionRevealed || hintRequested ? "in_progress" : "completed";

    const evidenceStatus: "formative_only" | "needs_review" | "reviewed_anchor_evidence" =
      unassistedPass
        ? "reviewed_anchor_evidence"
        : isFormativeOnly || solutionRevealed || hintRequested
          ? "formative_only"
          : "needs_review";

    const assuranceLevel:
      | "reviewed_deterministic"
      | "advisory_model_assisted"
      | "formative_practice" =
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
      const responseSummary =
        ans.type === "single_choice"
          ? ans.selected_option_id
          : ans.type === "multiple_choice"
            ? ans.selected_option_ids.join(", ")
            : ans.text;
      return {
        questionId: ans.question_id,
        prompt: q?.prompt ?? ans.question_id,
        learnerResponseSummary: responseSummary,
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
    const evaluationRevisionId = `eval-rev-${evaluationSeq++}`;

    const outcome: AssessmentAttemptSubmissionOutcome = {
      attemptId,
      status: gradingMethod === "model_assisted" ? "requires_review" : "scored",
      evaluationRevisionId,
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
    explicitReason?: string
  ): DefectiveItemReportRecord {
    let itemId: string;
    let rawReason: string;

    if (typeof itemIdOrReason === "object" && itemIdOrReason !== null) {
      itemId = sanitizeText(
        itemIdOrReason.itemId,
        currentQuestionId ?? assessmentId
      );
      rawReason = sanitizeText(itemIdOrReason.reason);
    } else if (explicitReason !== undefined) {
      itemId = sanitizeText(itemIdOrReason, currentQuestionId ?? assessmentId);
      rawReason = sanitizeText(explicitReason);
    } else {
      itemId = currentQuestionId ?? assessmentId;
      rawReason = sanitizeText(itemIdOrReason);
    }

    if (!rawReason || rawReason.trim().length < 5) {
      throw new Error(
        "A defective assessment item report requires a reason of at least 5 characters (PED-005)."
      );
    }

    const headers = buildOperationHeaders("reportDefectiveAssessmentItem");
    const request: DefectiveItemReportRequestDescriptor = {
      operationId: "reportDefectiveAssessmentItem",
      method: "POST",
      path: `/assessments/${assessmentId}/reports`,
      headers,
      body: {
        reason: rawReason,
      },
    };

    const record: DefectiveItemReportRecord = {
      reportId: `defect-report-${reportSeq++}`,
      assessmentId,
      itemId,
      reason: rawReason,
      reportedAt: "2026-10-20T16:30:00Z",
      status: "queued",
      preservesAttemptHistory: true,
      request,
    };

    reportedDefectiveItems.push(record);
    return record;
  }

  function applyKeyCorrection(correctionOptions: {
    readonly correctionId?: string;
    readonly correctionReason: string;
    readonly invalidatePriorDemonstrations?: boolean;
  }): KeyCorrectionProjectionOutcome {
    const correctionReason = sanitizeText(correctionOptions.correctionReason);
    if (!correctionReason) {
      throw new Error("A correction reason is required to apply an assessment key correction.");
    }
    const invalidatePrior = correctionOptions.invalidatePriorDemonstrations !== false;
    const prevEvalId = attemptResult?.evaluationRevisionId ?? "eval-rev-0";
    const newEvalId = `eval-rev-${evaluationSeq++}`;
    const newStatus: "invalidated" | "corrected" = invalidatePrior
      ? "invalidated"
      : "corrected";
    const recomputedProficiencyStatus: ObjectiveProficiencyBadgeStatus = invalidatePrior
      ? "needs_review"
      : (attemptResult?.resultingProficiencyStatus ?? "in_progress");

    if (attemptResult) {
      const updatedOutcome: AssessmentAttemptSubmissionOutcome = {
        ...attemptResult,
        status: newStatus,
        evaluationRevisionId: newEvalId,
        previousEvaluationRevisionId: prevEvalId,
        invalidationReason: correctionReason,
        evidenceStatus: "needs_review",
        resultingProficiencyStatus: recomputedProficiencyStatus,
        canEstablishDemonstratedCompetence: false,
      };
      attemptResult = updatedOutcome;
      historicalEvaluations.push(updatedOutcome);
    }

    const headers = buildOperationHeaders("applyAssessmentKeyCorrection");
    return {
      correctionId: sanitizeText(correctionOptions.correctionId, `correction-${evaluationSeq}`),
      assessmentId,
      assessmentVersionId,
      correctionReason,
      originalAttemptRetainedAndInspectable: true,
      previousEvaluationRevisionId: prevEvalId,
      newEvaluationRevisionId: newEvalId,
      resultingAttemptStatus: newStatus,
      recomputedProficiencyStatus,
      dependentWaiversInvalidated: invalidatePrior,
      activeCurriculumSilentlyReplaced: false,
      explanation: `Answer-key correction applied (${correctionReason}). Original attempt and evaluation ${prevEvalId} remain inspectable; dependent proficiency and waivers were recomputed without silently replacing the active plan (@S46, @S55).`,
      request: {
        operationId: "applyAssessmentKeyCorrection",
        method: "POST",
        path: `/admin/assessments/${assessmentId}/key-corrections`,
        headers,
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
    selectChoice: (qOrOpt: string, opt?: string) => selectAnswer(qOrOpt, opt),
    selectOption: (qOrOpt: string, opt?: string) => selectAnswer(qOrOpt, opt),
    selectAnswer,
    setShortAnswer: (qOrText: string, text?: string) => {
      if (text === undefined) {
        return selectAnswer(currentQuestionId ?? "question-1", qOrText);
      }
      return selectAnswer(qOrText, text);
    },
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
    readonly curriculum_revision_id: string;
    readonly activity_id: string;
    readonly type: AuditableGateEventType;
    readonly occurred_at: string;
    readonly client_timezone: string;
    readonly note: string;
    readonly time_spent_minutes: 0;
  };
}

export interface MasteryGateEvaluationInput {
  readonly curriculumId?: string;
  readonly curriculum_id?: string;
  readonly curriculumRevisionId?: string;
  readonly curriculum_revision_id?: string;
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

/**
 * Evaluates the Mastery Gate & Study-Ahead Interstitial (`PED-006`, `@S15`, `@S18`, `@S51`, `@S81`).
 *
 * Rules:
 * 1. Non-`mastery_gated` activities (`masteryGated: false`) allow immediate study-ahead
 *    (`canProceedImmediately: true`, `blocking: false`, `hardLocked: false`) with a
 *    non-blocking prerequisite warning and recommended bridging activities.
 * 2. `mastery_gated: true` activities WITH an active reviewed anchor (`hasActiveReviewedAnchor: true`)
 *    require either `demonstrated` prerequisite proficiency from valid reviewed evidence OR
 *    recording an explicit auditable override (`prerequisite_override_recorded` with learner rationale).
 *    Non-qualifying support (self-rating, external completion, elapsed time, upvotes, assisted answer,
 *    advisory AI grade) NEVER satisfies the gate (`@S51`).
 * 3. `mastery_gated: true` activities WITHOUT an active reviewed anchor (`hasActiveReviewedAnchor: false`)
 *    display the exact notice `"Prerequisite unverified — no reviewed anchor available"` and require
 *    an explicit auditable acknowledgement (`unverified_prerequisite_acknowledged`) before continuing (`@S15`).
 */
export function evaluateMasteryGateInterstitial(
  input: MasteryGateEvaluationInput
): MasteryGateModalState {
  const curriculumId = sanitizeText(
    input.curriculumId ?? input.curriculum_id,
    "synthetic-curriculum-1"
  );
  const curriculumRevisionId = sanitizeText(
    input.curriculumRevisionId ?? input.curriculum_revision_id,
    "synthetic-revision-1"
  );
  const activityId = sanitizeText(input.activityId ?? input.activity_id, "activity-quiz");
  const activityTitle = sanitizeText(input.activityTitle, activityId);
  const masteryGated = Boolean(input.masteryGated ?? input.mastery_gated);
  const hasActiveReviewedAnchor =
    input.hasActiveReviewedAnchor !== undefined
      ? input.hasActiveReviewedAnchor
      : input.has_active_reviewed_anchor !== undefined
        ? input.has_active_reviewed_anchor
        : input.reviewedAnchorAvailable !== undefined
          ? input.reviewedAnchorAvailable
          : true;

  const prerequisiteObjectiveIds = (
    input.prerequisiteObjectiveIds ??
    input.prerequisite_objective_ids ?? ["objective-tokenization"]
  ).map((id) => sanitizeText(id));

  const recommendedBridgingActivityIds = (
    input.recommendedBridgingActivityIds ??
    input.recommended_bridging_activity_ids ?? ["activity-theory", "activity-example"]
  ).map((id) => sanitizeText(id));

  const rawSupport = sanitizeText(
    input.nonqualifyingSupport ?? input.nonqualifying_support,
    "none"
  );
  const hasNonQualifyingSupportOnly =
    rawSupport !== "none" &&
    rawSupport !== "" &&
    input.hasQualifyingReviewedEvidence !== true &&
    input.has_qualifying_reviewed_evidence !== true;

  const rawProfStatus =
    input.prerequisiteProficiencyStatus ??
    input.prerequisite_proficiency_status ??
    "unassessed";

  const normalizedProfStatus: ObjectiveProficiencyBadgeStatus =
    rawProfStatus === "demonstrated" && !hasNonQualifyingSupportOnly
      ? "demonstrated"
      : rawProfStatus === "self_reported"
        ? "self_reported"
        : rawProfStatus === "in_progress"
          ? "in_progress"
          : rawProfStatus === "needs_review"
            ? "needs_review"
            : "unassessed";

  const prerequisiteSatisfied =
    normalizedProfStatus === "demonstrated" &&
    !hasNonQualifyingSupportOnly &&
    hasActiveReviewedAnchor;

  const eventId = sanitizeText(input.eventId ?? input.event_id, `gate-decision-${activityId}`);
  const occurredAt = sanitizeText(input.occurredAt, "2026-10-26T18:15:00-04:00");
  const clientTimezone = sanitizeText(input.clientTimezone, "America/New_York");
  const surfaceStyle = resolveSurfaceStyle("assessment");

  function buildAuditRequest(
    type: AuditableGateEventType,
    note: string
  ): AuditableGateDecisionProgressEventRequest {
    const headers = buildOperationHeaders("appendProgressEvent");
    return {
      operationId: "appendProgressEvent",
      method: "POST",
      path: `/curricula/${curriculumId}/progress-events`,
      headers,
      body: {
        event_id: eventId,
        curriculum_revision_id: curriculumRevisionId,
        activity_id: activityId,
        type,
        occurred_at: occurredAt,
        client_timezone: clientTimezone,
        note,
        time_spent_minutes: 0,
      },
    };
  }

  // Case 1: Non-mastery-gated activity -> allow immediate study-ahead with non-blocking warning + bridge work
  if (!masteryGated) {
    const hasWarning = !prerequisiteSatisfied;
    const warningMsg = hasWarning
      ? "Prerequisite objective is not yet demonstrated. You can study ahead now or complete the recommended bridging activities first; studying ahead will not manufacture prerequisite competence."
      : null;

    return {
      activityId,
      activityTitle,
      masteryGated: false,
      hasActiveReviewedAnchor,
      prerequisiteObjectiveIds,
      prerequisiteProficiencyStatus: normalizedProfStatus,
      prerequisiteSatisfiedByDemonstratedEvidence: prerequisiteSatisfied,
      nonqualifyingSupportRejected: hasNonQualifyingSupportOnly,
      gateStatus: hasWarning ? "study_ahead_with_warning" : "open",
      canProceedImmediately: true,
      allowedToProceedImmediately: true,
      canProceed: true,
      blocking: false,
      hardLocked: false,
      hasPrerequisiteWarning: hasWarning,
      warningMessage: warningMsg,
      notice:
        warningMsg ??
        "Prerequisite satisfied by reviewed evidence; activity ready.",
      unverifiedPrerequisiteNotice: null,
      bannerText:
        warningMsg ??
        "Prerequisite satisfied by reviewed evidence; activity ready.",
      recommendedBridgingActivityIds: hasWarning ? recommendedBridgingActivityIds : [],
      recommendedBridgeActivities: hasWarning ? recommendedBridgingActivityIds : [],
      requiredAuditEventType: null,
      requiresLearnerRationale: false,
      auditableDecisionRecorded: false,
      auditableEventType: null,
      auditProgressEventRequest: null,
      createsPrerequisiteWaiver: false,
      marksSkippedActivityCompleted: false,
      grantsPrerequisiteProficiency: false,
      prerequisiteGateRemainsUnsatisfied: !prerequisiteSatisfied,
      surfaceStyle,
    };
  }

  // Case 2: mastery_gated: true WITHOUT an active reviewed anchor (@S15, PED-006)
  if (!hasActiveReviewedAnchor) {
    const acknowledged = Boolean(
      input.acknowledgedUnverifiedPrerequisite ??
        input.acknowledged_unverified_prerequisite ??
        input.acknowledged
    );
    const note = sanitizeText(
      input.overrideRationale ?? input.override_rationale ?? input.learnerRationale,
      UNVERIFIED_PREREQUISITE_NOTICE
    );
    const auditReq = acknowledged
      ? buildAuditRequest("unverified_prerequisite_acknowledged", note)
      : null;

    return {
      activityId,
      activityTitle,
      masteryGated: true,
      hasActiveReviewedAnchor: false,
      prerequisiteObjectiveIds,
      prerequisiteProficiencyStatus: normalizedProfStatus,
      prerequisiteSatisfiedByDemonstratedEvidence: false,
      nonqualifyingSupportRejected: hasNonQualifyingSupportOnly,
      gateStatus: acknowledged
        ? "unverified_prerequisite_acknowledged"
        : "requires_unverified_acknowledgement",
      canProceedImmediately: false,
      allowedToProceedImmediately: false,
      canProceed: acknowledged,
      blocking: !acknowledged,
      hardLocked: false,
      hasPrerequisiteWarning: true,
      warningMessage: UNVERIFIED_PREREQUISITE_NOTICE,
      notice: UNVERIFIED_PREREQUISITE_NOTICE,
      unverifiedPrerequisiteNotice: UNVERIFIED_PREREQUISITE_NOTICE,
      bannerText: UNVERIFIED_PREREQUISITE_NOTICE,
      recommendedBridgingActivityIds,
      recommendedBridgeActivities: recommendedBridgingActivityIds,
      requiredAuditEventType: "unverified_prerequisite_acknowledged",
      requiresLearnerRationale: false,
      auditableDecisionRecorded: acknowledged,
      auditableEventType: acknowledged ? "unverified_prerequisite_acknowledged" : null,
      auditProgressEventRequest: auditReq,
      createsPrerequisiteWaiver: false,
      marksSkippedActivityCompleted: false,
      grantsPrerequisiteProficiency: false,
      prerequisiteGateRemainsUnsatisfied: true,
      surfaceStyle,
    };
  }

  // Case 3: mastery_gated: true WITH an active reviewed anchor
  if (prerequisiteSatisfied) {
    return {
      activityId,
      activityTitle,
      masteryGated: true,
      hasActiveReviewedAnchor: true,
      prerequisiteObjectiveIds,
      prerequisiteProficiencyStatus: "demonstrated",
      prerequisiteSatisfiedByDemonstratedEvidence: true,
      nonqualifyingSupportRejected: false,
      gateStatus: "satisfied_by_demonstrated_evidence",
      canProceedImmediately: true,
      allowedToProceedImmediately: true,
      canProceed: true,
      blocking: false,
      hardLocked: false,
      hasPrerequisiteWarning: false,
      warningMessage: null,
      notice: "Prerequisite demonstrated via reviewed anchor assessment.",
      unverifiedPrerequisiteNotice: null,
      bannerText: "Prerequisite demonstrated via reviewed anchor assessment.",
      recommendedBridgingActivityIds: [],
      recommendedBridgeActivities: [],
      requiredAuditEventType: null,
      requiresLearnerRationale: false,
      auditableDecisionRecorded: false,
      auditableEventType: null,
      auditProgressEventRequest: null,
      createsPrerequisiteWaiver: false,
      marksSkippedActivityCompleted: false,
      grantsPrerequisiteProficiency: false,
      prerequisiteGateRemainsUnsatisfied: false,
      surfaceStyle,
    };
  }

  const rawRationale =
    input.overrideRationale ?? input.override_rationale ?? input.learnerRationale ?? "";
  const cleanRationale = sanitizeText(rawRationale);
  const hasValidOverride = cleanRationale.trim().length > 0;
  const auditReq = hasValidOverride
    ? buildAuditRequest("prerequisite_override_recorded", cleanRationale)
    : null;

  const warningText =
    "Mastery-gated activity: independent prerequisite demonstration on the reviewed anchor or an explicit auditable learner override with rationale is required before continuing.";

  return {
    activityId,
    activityTitle,
    masteryGated: true,
    hasActiveReviewedAnchor: true,
    prerequisiteObjectiveIds,
    prerequisiteProficiencyStatus: normalizedProfStatus,
    prerequisiteSatisfiedByDemonstratedEvidence: false,
    nonqualifyingSupportRejected: hasNonQualifyingSupportOnly,
    gateStatus: hasValidOverride
      ? "override_recorded"
      : "requires_demonstration_or_override",
    canProceedImmediately: false,
    allowedToProceedImmediately: false,
    canProceed: hasValidOverride,
    blocking: !hasValidOverride,
    hardLocked: false,
    hasPrerequisiteWarning: true,
    warningMessage: warningText,
    notice: warningText,
    unverifiedPrerequisiteNotice: null,
    bannerText: warningText,
    recommendedBridgingActivityIds,
    recommendedBridgeActivities: recommendedBridgingActivityIds,
    requiredAuditEventType: "prerequisite_override_recorded",
    requiresLearnerRationale: true,
    auditableDecisionRecorded: hasValidOverride,
    auditableEventType: hasValidOverride ? "prerequisite_override_recorded" : null,
    auditProgressEventRequest: auditReq,
    createsPrerequisiteWaiver: false,
    marksSkippedActivityCompleted: false,
    grantsPrerequisiteProficiency: false,
    prerequisiteGateRemainsUnsatisfied: true,
    surfaceStyle,
  };
}
