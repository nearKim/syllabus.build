/**
 * Formative Quiz Evaluation, Scoring, Staged Hint Tracking, Solution Reveal,
 * Defective Item Reporting, and Answer Key Correction Mechanics.
 */

import { buildOperationHeaders } from "@syllabus/api-client";
import { resolveSurfaceStyle } from "./theme.ts";
import {
  renderAccessibleMathFormula,
  sanitizeText,
} from "./SafeActivityRenderer.ts";
import type {
  ActivityExecutionStatus,
  ObjectiveProficiencyBadgeStatus,
} from "./planMapTokens.ts";
import {
  WORKED_SOLUTION_ASSISTANCE_WARNING,
  type AssessmentPurpose,
  type AssessmentContentReviewStatus,
  type AssessmentGradingMethod,
  type DeclaredAssistanceKind,
  type AssistanceEvidenceKind,
  type AssessmentQuestionInput,
  type AssessmentQuestionView,
  type AssessmentSelectedAnswer,
  type AssessmentChoiceSelectionOutcome,
  type AssistanceEventRequestDescriptor,
  type RecordedAssistanceEvent,
  type StagedHintOutcome,
  type WorkedSolutionWarningPreview,
  type WorkedSolutionRevealOutcome,
  type DefectiveItemReportRecord,
  type SubmitAssessmentAttemptRequestDescriptor,
  type AssessmentQuestionFeedbackView,
  type AssessmentAttemptSubmissionOutcome,
  type KeyCorrectionProjectionOutcome,
  type AssessmentSessionModel,
  type AssessmentSessionControllerOptions,
  type AssessmentSessionController,
} from "./assessmentTypes.ts";

export const DEFAULT_QUESTIONS: readonly AssessmentQuestionInput[] = [
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

export const clean = (raw: unknown, fallback = "") => sanitizeText(raw, fallback, 2000);

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
    readonly ifMatch?: string;
    readonly idempotencyKey?: string;
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
      headers: buildOperationHeaders(
        "submitAssessmentAttempt",
        submitOptions
          ? {
              ...(submitOptions.ifMatch ? { ifMatch: submitOptions.ifMatch } : {}),
              ...(submitOptions.idempotencyKey ? { idempotencyKey: submitOptions.idempotencyKey } : {}),
            }
          : {},
      ),
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
    readonly ifMatch?: string;
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
        headers: buildOperationHeaders(
          "applyAssessmentKeyCorrection",
          correctionOptions.ifMatch ? { ifMatch: correctionOptions.ifMatch } : {},
        ),
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
