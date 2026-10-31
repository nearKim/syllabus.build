import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssessmentSessionController,
  evaluateMasteryGateInterstitial,
  UNVERIFIED_PREREQUISITE_NOTICE,
  WORKED_SOLUTION_ASSISTANCE_WARNING,
} from "../src/index.ts";

test("T05 (@S77): selecting an answer choice never auto-submits; requires explicit submitAttempt()", () => {
  const controller = createAssessmentSessionController({
    assessmentId: "anchor-tokenization-1",
    purpose: "independent_probe",
    contentReviewStatus: "curator_reviewed",
    gradingMethod: "deterministic",
  });

  const choiceOutcome = controller.selectChoice("opt-longer-sequences");
  assert.equal(choiceOutcome.selectedOptionId, "opt-longer-sequences");
  assert.equal(choiceOutcome.submitted, false);
  assert.equal(choiceOutcome.autoSubmitted, false);
  assert.equal(choiceOutcome.advancedToNextQuestion, false);
  assert.equal(choiceOutcome.requiresExplicitSubmitCall, true);

  const modelBeforeSubmit = controller.getState();
  assert.equal(modelBeforeSubmit.submitted, false);
  assert.equal(modelBeforeSubmit.autoSubmitOnSelect, false);
  assert.equal(modelBeforeSubmit.attemptResult, null);
  assert.equal(modelBeforeSubmit.excludesPrivateAnswerKeyBeforeReveal, true);
  assert.equal(modelBeforeSubmit.impliesUnimplementedInBrowserCodeRunner, false);

  const submission = controller.submitAttempt({
    attemptId: "attempt-unassisted-1",
    clientElapsedSeconds: 42,
    scoreFraction: 1.0,
  });

  assert.equal(submission.attemptId, "attempt-unassisted-1");
  assert.equal(submission.declaredAssistance, "none");
  assert.equal(submission.assistanceEvidence, "observed_unassisted_in_app");
  assert.equal(submission.canEstablishDemonstratedCompetence, true);
  assert.equal(submission.resultingProficiencyStatus, "demonstrated");
  assert.equal(submission.resultingExecutionStatus, "completed");
  assert.equal(submission.preservesQuestionResponseAssuranceAndUncertainty, true);
  assert.equal(submission.request.operationId, "submitAssessmentAttempt");
});

test("T05 (@S14, @S16, @S17, @S45): staged hints and worked-solution reveal warn learner and record in_progress rather than demonstrated", () => {
  const controller = createAssessmentSessionController({
    assessmentId: "anchor-attention-1",
    purpose: "independent_probe",
    contentReviewStatus: "curator_reviewed",
    gradingMethod: "deterministic",
  });

  const warningPreview = controller.previewWorkedSolutionWarning();
  assert.equal(warningPreview.warningShownBeforeReveal, true);
  assert.equal(warningPreview.warningMessage, WORKED_SOLUTION_ASSISTANCE_WARNING);
  assert.equal(warningPreview.recordsCompetenceStatus, "in_progress");
  assert.equal(warningPreview.canEstablishDemonstratedCompetence, false);

  const hint1 = controller.requestHint({ eventId: "assist-hint-1" });
  assert.equal(hint1.assistanceKind, "staged_hint");
  assert.equal(hint1.hintStage, 1);
  assert.equal(hint1.countsAsIndependentAttempt, false);
  assert.equal(hint1.canEstablishDemonstratedCompetence, false);
  assert.equal(hint1.resultingCompetenceStatus, "in_progress");
  assert.equal(hint1.request.operationId, "recordAssessmentAssistanceEvent");

  const reveal = controller.revealWorkedSolution({ eventId: "assist-sol-1" });
  assert.equal(reveal.warningShownBeforeReveal, true);
  assert.equal(reveal.solutionRevealed, true);
  assert.equal(reveal.declaredAssistance, "solution_viewed");
  assert.equal(reveal.assistanceEvidence, "observed_solution_viewed");
  assert.equal(reveal.canEstablishDemonstratedCompetence, false);
  assert.equal(reveal.resultingProficiencyStatus, "in_progress");

  controller.selectOption("opt-longer-sequences");
  const attempt = controller.submitAttempt({
    attemptId: "attempt-assisted-1",
    scoreFraction: 1.0,
  });

  assert.equal(attempt.declaredAssistance, "solution_viewed");
  assert.equal(attempt.canEstablishDemonstratedCompetence, false);
  assert.equal(attempt.resultingProficiencyStatus, "in_progress");
  assert.equal(attempt.resultingExecutionStatus, "in_progress");
});

test("T05 (@S58, @S46, @S55): defective item report and attributable key correction invalidation preserve attempt history", () => {
  const controller = createAssessmentSessionController({
    assessmentId: "anchor-matrix-1",
    assessmentVersionId: "anchor-matrix-1-v1",
    purpose: "independent_probe",
    contentReviewStatus: "curator_reviewed",
    gradingMethod: "deterministic",
  });

  controller.selectChoice("opt-longer-sequences");
  const initialAttempt = controller.submitAttempt({
    attemptId: "attempt-before-correction",
    scoreFraction: 1.0,
  });
  assert.equal(initialAttempt.resultingProficiencyStatus, "demonstrated");

  const report = controller.reportDefectiveItem(
    "question-tokenization-tradeoff-1",
    "Option B has an ambiguous subscript in the denominator."
  );
  assert.equal(report.status, "queued");
  assert.equal(report.preservesAttemptHistory, true);
  assert.equal(report.request.operationId, "reportDefectiveAssessmentItem");

  const correction = controller.applyKeyCorrection({
    correctionId: "key-fix-1",
    correctionReason: "Fixed sign error in option key for question 1.",
    invalidatePriorDemonstrations: true,
  });
  assert.equal(correction.originalAttemptRetainedAndInspectable, true);
  assert.equal(correction.resultingAttemptStatus, "invalidated");
  assert.equal(correction.recomputedProficiencyStatus, "needs_review");
  assert.equal(correction.dependentWaiversInvalidated, true);
  assert.equal(correction.activeSyllabusSilentlyReplaced, false);
  assert.notEqual(
    correction.newEvaluationRevisionId,
    correction.previousEvaluationRevisionId
  );

  const stateAfterCorrection = controller.getState();
  assert.equal(stateAfterCorrection.historicalEvaluations.length, 2);
});

test("T05 (@S15, @S18, @S51, @S81): evaluateMasteryGateInterstitial handles non-gated study-ahead, reviewed anchor override, and missing anchor notice", () => {
  // 1. Non-mastery_gated activity allows immediate study-ahead with warning & bridging work
  const nonGated = evaluateMasteryGateInterstitial({
    syllabusId: "curr-1",
    syllabusRevisionId: "rev-1",
    activityId: "activity-optional-reading",
    masteryGated: false,
    prerequisiteProficiencyStatus: "unassessed",
    recommendedBridgingActivityIds: ["activity-bridge-1"],
  });
  assert.equal(nonGated.canProceedImmediately, true);
  assert.equal(nonGated.blocking, false);
  assert.equal(nonGated.hardLocked, false);
  assert.equal(nonGated.hasPrerequisiteWarning, true);
  assert.deepEqual(nonGated.recommendedBridgingActivityIds, ["activity-bridge-1"]);
  assert.equal(nonGated.grantsPrerequisiteProficiency, false);
  assert.equal(nonGated.createsPrerequisiteWaiver, false);

  // 2. mastery_gated: true with active reviewed anchor rejects non-qualifying support (@S51) and requires demonstration or auditable override
  const gatedBlocked = evaluateMasteryGateInterstitial({
    syllabusId: "curr-1",
    syllabusRevisionId: "rev-1",
    activityId: "activity-advanced-proof",
    masteryGated: true,
    hasActiveReviewedAnchor: true,
    prerequisiteProficiencyStatus: "demonstrated",
    nonqualifyingSupport: "self_rating",
    hasQualifyingReviewedEvidence: false,
  });
  assert.equal(gatedBlocked.nonqualifyingSupportRejected, true);
  assert.equal(gatedBlocked.canProceedImmediately, false);
  assert.equal(gatedBlocked.canProceed, false);
  assert.equal(gatedBlocked.blocking, true);
  assert.equal(gatedBlocked.requiredAuditEventType, "prerequisite_override_recorded");

  const gatedOverridden = evaluateMasteryGateInterstitial({
    syllabusId: "curr-1",
    syllabusRevisionId: "rev-1",
    activityId: "activity-advanced-proof",
    masteryGated: true,
    hasActiveReviewedAnchor: true,
    prerequisiteProficiencyStatus: "in_progress",
    overrideRationale: "Completed equivalent graduate coursework; proceeding with bridge reference.",
  });
  assert.equal(gatedOverridden.canProceed, true);
  assert.equal(gatedOverridden.blocking, false);
  assert.equal(gatedOverridden.auditableDecisionRecorded, true);
  assert.equal(gatedOverridden.auditableEventType, "prerequisite_override_recorded");
  assert.equal(
    gatedOverridden.auditProgressEventRequest?.body.type,
    "prerequisite_override_recorded"
  );
  assert.equal(gatedOverridden.grantsPrerequisiteProficiency, false);

  // 3. mastery_gated: true without active reviewed anchor displays exact notice and requires unverified_prerequisite_acknowledged (@S15)
  const unverifiedBlocked = evaluateMasteryGateInterstitial({
    syllabusId: "curr-1",
    syllabusRevisionId: "rev-1",
    activityId: "activity-unanchored-lab",
    masteryGated: true,
    hasActiveReviewedAnchor: false,
    acknowledgedUnverifiedPrerequisite: false,
  });
  assert.equal(unverifiedBlocked.notice, UNVERIFIED_PREREQUISITE_NOTICE);
  assert.equal(
    unverifiedBlocked.unverifiedPrerequisiteNotice,
    "Prerequisite unverified — no reviewed anchor available"
  );
  assert.equal(unverifiedBlocked.canProceed, false);
  assert.equal(
    unverifiedBlocked.requiredAuditEventType,
    "unverified_prerequisite_acknowledged"
  );

  const unverifiedAcked = evaluateMasteryGateInterstitial({
    syllabusId: "curr-1",
    syllabusRevisionId: "rev-1",
    activityId: "activity-unanchored-lab",
    masteryGated: true,
    hasActiveReviewedAnchor: false,
    acknowledgedUnverifiedPrerequisite: true,
  });
  assert.equal(unverifiedAcked.canProceed, true);
  assert.equal(unverifiedAcked.auditableDecisionRecorded, true);
  assert.equal(
    unverifiedAcked.auditableEventType,
    "unverified_prerequisite_acknowledged"
  );
});
