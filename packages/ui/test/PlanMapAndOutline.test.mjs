import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVITY_EXECUTION_STATUSES,
  buildPlanMapAndOutlineModel,
  computeActivityDurationTriplet,
  OBJECTIVE_PROFICIENCY_BADGE_STATUSES,
} from "../src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");

const canonicalSyllabus = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/syllabus.synthetic.json"),
    "utf-8"
  )
);

const canonicalProficiency = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/proficiency.synthetic.json"),
    "utf-8"
  )
);

const canonicalResource = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/resource.synthetic.json"),
    "utf-8"
  )
);

test("buildPlanMapAndOutlineModel renders syllabus.synthetic.json + proficiency.synthetic.json with honest two-layer status badges (@S17, @S23)", () => {
  const model = buildPlanMapAndOutlineModel(
    canonicalSyllabus,
    canonicalProficiency,
    {
      "activity-theory": "self_reported_completed",
      "activity-example": "in_progress",
    },
    {
      catalogResources: [canonicalResource],
    }
  );

  assert.equal(model.syllabusId, "synthetic-syllabus-1");
  assert.equal(model.revisionId, "synthetic-revision-1");
  assert.equal(model.outlineModules.length, 1);
  assert.equal(model.outlineActivities.length, 6);

  // Two-layer honesty: activity-theory is `self_reported_completed`, while its objective
  // `objective-tokenization` remains `unassessed` (never inflated to `demonstrated` @S17, @S23)
  const theoryAct = model.outlineActivities.find((a) => a.activityId === "activity-theory");
  assert.ok(theoryAct);
  assert.equal(theoryAct.executionStatus, "self_reported_completed");
  assert.equal(theoryAct.executionBadge.status, "self_reported_completed");
  assert.equal(theoryAct.executionBadge.countsAsDemonstratedProficiency, false);
  assert.equal(theoryAct.objectiveProficiencyStatus, "unassessed");
  assert.equal(theoryAct.objectiveProficiencyBadge.selfReportedActivityCompleted, true);
  assert.equal(theoryAct.objectiveProficiencyBadge.conflatedWithActivityCompletion, false);

  // Resource provenance card includes verified publisher, version timestamp, access model, rights badge
  assert.equal(theoryAct.resourceProvenanceCards.length, 1);
  const provCard = theoryAct.resourceProvenanceCards[0];
  assert.equal(provCard.resourceVersionId, "synthetic-resource-tokenization-v1");
  assert.equal(provCard.verifiedPublisher, "Synthetic Fixture Provider");
  assert.equal(provCard.versionTimestamp, "2026-10-20T16:00:00Z");
  assert.equal(provCard.accessModel, "free");
  assert.equal(provCard.rightsBadge.basis, "metadata_only");
  assert.equal(provCard.rightsBadge.externalLinkOnly, true);
  assert.equal(provCard.optionalCertificationBadge, null);

  // Proficiency fixture objectives are preserved with accurate statuses
  const demonstratedObj = model.objectiveTracks.find(
    (o) => o.objectiveId === "objective-matrix-shapes"
  );
  assert.ok(demonstratedObj);
  assert.equal(demonstratedObj.proficiencyStatus, "demonstrated");

  const unassessedObj = model.objectiveTracks.find(
    (o) => o.objectiveId === "objective-matrix-calculus"
  );
  assert.ok(unassessedObj);
  assert.equal(unassessedObj.proficiencyStatus, "unassessed");

  assert.ok(ACTIVITY_EXECUTION_STATUSES.includes(theoryAct.executionStatus));
  assert.ok(OBJECTIVE_PROFICIENCY_BADGE_STATUSES.includes(theoryAct.objectiveProficiencyStatus));
});

test("buildPlanMapAndOutlineModel enforces 100% Map <-> Outline equivalence, DAG topological order, keyboard navigation, and non-dragging controls (@S25, @S75)", () => {
  const multiModuleSyllabus = {
    ...canonicalSyllabus,
    objectives: [
      ...canonicalSyllabus.objectives,
      {
        objective_id: "objective-attention",
        title: "Derive scaled dot-product attention",
        description: "Compute QK^T / sqrt(d_k) attention weights.",
        success_criterion: "Complete derivation and shape check.",
        level: "applied",
        requirement_level: "required",
        assessment_activity_ids: ["activity-quiz"],
        prior_evidence_refs: [],
        topic_id: "topic-attention",
        objective_version_id: "objective-attention-v1",
      },
    ],
    prerequisite_edges: [
      {
        from_objective_id: "objective-tokenization",
        to_objective_id: "objective-attention",
      },
    ],
    modules: [
      {
        module_id: "module-attention",
        title: "Attention derivations",
        summary: "Dependent module on tokenization.",
        objective_ids: ["objective-attention"],
        activity_ids: ["activity-quiz", "activity-review", "activity-reflection"],
      },
      {
        module_id: "module-tokenization",
        title: "Tokenization foundations",
        summary: "Prerequisite module.",
        objective_ids: ["objective-tokenization"],
        activity_ids: ["activity-theory", "activity-example", "activity-coding"],
      },
    ],
  };

  const model = buildPlanMapAndOutlineModel(multiModuleSyllabus, canonicalProficiency);

  // Topological sort places module-tokenization (layer 0) before module-attention (layer 1)
  assert.equal(model.outlineModules[0].moduleId, "module-tokenization");
  assert.equal(model.outlineModules[0].layer, 0);
  assert.equal(model.outlineModules[1].moduleId, "module-attention");
  assert.equal(model.outlineModules[1].layer, 1);

  // 100% Map <-> Outline equivalence (@S75)
  assert.equal(model.equivalence.isEquivalent, true);
  assert.equal(model.equivalence.everyMapNodeInOutline, true);
  assert.equal(model.equivalence.everyPrerequisiteEdgeInOutline, true);
  assert.equal(model.equivalence.everyStatusBadgeEquivalent, true);
  assert.equal(model.equivalence.everyActionEquivalent, true);
  assert.equal(model.equivalence.requiresPointerDragging, false);
  assert.equal(model.svgViewport.opaqueSurface, true);

  // Directed edges include module and objective prerequisite edges with explicit text meanings
  assert.ok(
    model.mapEdges.some(
      (e) =>
        e.from === "module-tokenization" &&
        e.to === "module-attention" &&
        e.arrowMeaning === "prerequisite_dependency"
    )
  );
  assert.ok(
    model.mapEdges.some(
      (e) => e.from === "objective-tokenization" && e.to === "objective-attention"
    )
  );

  // Keyboard navigation (`ArrowRight`, `ArrowLeft`, `ArrowDown`, `ArrowUp`, `Enter`)
  assert.equal(model.focusedNodeId, "module-tokenization");
  const afterRight = model.navigateKeyboard("ArrowRight");
  assert.equal(afterRight.focusedNodeId, "module-attention");
  assert.equal(afterRight.selectedModuleId, "module-attention");

  const afterLeft = afterRight.navigateKeyboard("ArrowLeft");
  assert.equal(afterLeft.focusedNodeId, "module-tokenization");

  const afterEnter = afterRight.navigateKeyboard("Enter");
  assert.equal(afterEnter.selectedModuleId, "module-attention");

  // Non-dragging viewport controls (`zoomIn`, `zoomOut`, `resetView`, `focusNeighborhood`)
  const zoomedIn = model.zoomIn();
  assert.equal(zoomedIn.svgViewport.zoom, 1.25);
  const zoomedOut = zoomedIn.zoomOut();
  assert.equal(zoomedOut.svgViewport.zoom, 1.0);
  const neighborhoodFocused = zoomedIn.focusNeighborhood("module-attention");
  assert.equal(neighborhoodFocused.selectedModuleId, "module-attention");
  const reset = neighborhoodFocused.resetView();
  assert.equal(reset.svgViewport.zoom, 1.0);
  assert.equal(reset.selectedModuleId, "module-tokenization");
});

test("buildPlanMapAndOutlineModel supports compact mobile neighborhood mode (< 768px), mastery_gated flags, and playback speed ceiling duration scaling (UI-002, UI-003, @S20, @S75, @S76)", () => {
  const gatedSyllabus = {
    ...canonicalSyllabus,
    activities: canonicalSyllabus.activities.map((act) =>
      act.activity_id === "activity-quiz"
        ? { ...act, mastery_gated: true }
        : act
    ),
  };

  const compactModel = buildPlanMapAndOutlineModel(gatedSyllabus, {
    viewportWidthPx: 375,
    playbackSpeed: 2,
    studyAheadActivityIds: ["activity-example"],
  });

  // Compact mobile neighborhood (< 768px) exposes immediate neighborhood + vertical task list
  assert.equal(compactModel.mobileNeighborhood.isCompactMobile, true);
  assert.equal(compactModel.mobileNeighborhood.shrinksDesktopGraph, false);
  assert.equal(compactModel.mobileNeighborhood.selectedModuleId, "module-tokenization");
  assert.equal(compactModel.mobileNeighborhood.verticalTaskList.length, 6);
  assert.equal(compactModel.mobileNeighborhood.nextActionActivityId, "activity-theory");

  // Mastery-gated activity vs non-blocking study-ahead prerequisite bridge recommendation
  const exampleAct = compactModel.outlineActivities.find(
    (a) => a.activityId === "activity-example"
  );
  assert.ok(exampleAct);
  assert.equal(exampleAct.masteryGated, false);
  assert.ok(exampleAct.prerequisiteBridgeRecommendation);
  assert.equal(exampleAct.prerequisiteBridgeRecommendation.recommended, true);
  assert.equal(exampleAct.prerequisiteBridgeRecommendation.blocking, false);

  const quizAct = compactModel.outlineActivities.find((a) => a.activityId === "activity-quiz");
  assert.ok(quizAct);
  assert.equal(quizAct.masteryGated, true);
  assert.ok(quizAct.prerequisiteBridgeRecommendation);
  assert.equal(quizAct.prerequisiteBridgeRecommendation.blocking, true);

  // Playback speed ceiling math on syllabus.synthetic.json (`ceil_per_activity`)
  const model1x = buildPlanMapAndOutlineModel(canonicalSyllabus, { playbackSpeed: 1 });
  assert.equal(model1x.totalDurationTriplet.min, 38);
  assert.equal(model1x.totalDurationTriplet.point, 48);
  assert.equal(model1x.totalDurationTriplet.max, 76);

  const model15x = buildPlanMapAndOutlineModel(canonicalSyllabus, { playbackSpeed: 1.5 });
  // Ceiling per activity at 1.5x:
  // theory: ceil(10/1.5)=7, example: ceil(10/1.5)=7, coding: ceil(15/1.5)=10,
  // quiz: ceil(5/1.5)=4, review: ceil(5/1.5)=4, reflection: ceil(3/1.5)=2 -> total point = 34
  assert.equal(model15x.totalDurationTriplet.point, 34);
  assert.equal(model15x.durationPolicy.rounding, "ceil_per_activity");

  // Media-specific scaling (@S20): 60m media + 40m reading + 80m practice + 20m assessment at 2x = 170m
  const sessionTriplet = computeActivityDurationTriplet(
    {
      media_minutes: 60,
      reading_minutes: 40,
      practice_minutes: 80,
      assessment_minutes: 20,
      review_minutes: 0,
      lower_bounds: {
        media_minutes: 60,
        reading_minutes: 40,
        practice_minutes: 80,
        assessment_minutes: 20,
        review_minutes: 0,
      },
      upper_bounds: {
        media_minutes: 60,
        reading_minutes: 40,
        practice_minutes: 80,
        assessment_minutes: 20,
        review_minutes: 0,
      },
    },
    2,
    true
  );
  assert.equal(sessionTriplet.point, 170);
});
