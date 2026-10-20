import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNavigationShellController,
  createPlanViewController,
  getWebShellBootstrapSummary,
  LEARN_SUB_DESTINATIONS,
  PLAN_SYNCHRONIZED_VIEWS,
  resolveResponsiveLayout,
  TOP_LEVEL_DESTINATIONS,
} from "../src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Web shell enforces Section 9.3 navigation hierarchy (Learn/Explore/Settings -> Today/Plan[Map+Outline]/Progress/Resources)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf-8");
  assert.ok(src.includes('["Learn", "Explore", "Settings"]'));
  assert.ok(src.includes('["Today", "Plan", "Progress", "Resources"]'));
  assert.ok(src.includes('["Map", "Outline"]'));

  const summary = getWebShellBootstrapSummary();
  assert.deepEqual(summary.topLevelDestinations, TOP_LEVEL_DESTINATIONS);
  assert.deepEqual(summary.learnSubDestinations, LEARN_SUB_DESTINATIONS);
  assert.deepEqual(summary.planSynchronizedViews, PLAN_SYNCHRONIZED_VIEWS);
  assert.equal(summary.operationCount, 71);
});

test("resolveResponsiveLayout enforces 320 CSS px / 200% zoom reflow, medium rail, and wide 224px sidebar + 1280px container (UI-009, UI-010, @S71, @S76, @S85)", () => {
  const compact320 = resolveResponsiveLayout(320, 200, 480);
  assert.equal(compact320.breakpoint, "compact");
  assert.equal(compact320.columns, 1);
  assert.equal(compact320.flowMode, "single_column");
  assert.equal(compact320.navigationChrome, "bottom_navigation_bar");
  assert.equal(compact320.touchTargetMinPx, 44);
  assert.deepEqual(compact320.touchTargetMinSize, { widthPx: 44, heightPx: 44 });
  assert.equal(compact320.primaryCompactActionHeightPx, 48);
  assert.equal(compact320.activePrimaryActionHeightPx, 48);
  assert.equal(compact320.hasPageHorizontalScroll, false);
  assert.equal(compact320.shellContainerStyle.overflowX, "hidden");
  assert.equal(compact320.longTokenCodeMathRegionStyle.overflowX, "auto");
  assert.equal(compact320.stickySurfacePolicy.obscuresFocusedControl, false);
  assert.equal(compact320.stickySurfacePolicy.obscuresPrimaryActionOrError, false);
  assert.equal(compact320.stickySurfacePolicy.demotesStickyToInFlow, true);

  // High text scaling (200%) at 1000px reflows to compact layout so center column is never cramped
  const zoomedCompact = resolveResponsiveLayout(1000, 200, 800);
  assert.equal(zoomedCompact.breakpoint, "compact");
  assert.equal(zoomedCompact.columns, 1);

  const medium960 = resolveResponsiveLayout(960, 100, 800);
  assert.equal(medium960.breakpoint, "medium");
  assert.equal(medium960.columns, 2);
  assert.equal(medium960.flowMode, "two_column_workspace");
  assert.equal(medium960.navigationChrome, "navigation_rail");
  assert.equal(medium960.gutterPx, 24);

  const wide1440 = resolveResponsiveLayout(1440, 100, 900);
  assert.equal(wide1440.breakpoint, "wide");
  assert.equal(wide1440.columns, 2);
  assert.equal(wide1440.flowMode, "sidebar_and_workspace");
  assert.equal(wide1440.navigationChrome, "left_sidebar");
  assert.equal(wide1440.sidebarWidthPx, 224);
  assert.equal(wide1440.contentMaxWidthPx, 1280);
  assert.equal(wide1440.gutterPx, 32);
});

test("Synchronized Plan Map and Outline controller preserves selection, filters, keyboard parity, and non-dragging controls (@S75)", () => {
  const plan = createPlanViewController();
  const initial = plan.getState();
  assert.equal(initial.activeView, "Map");
  assert.equal(initial.mapSelectedModuleId, initial.outlineSelectedModuleId);

  // Select module in Map -> updates Outline selection
  const afterMapSelect = plan.selectModule("module-attention", "Map");
  assert.equal(afterMapSelect.selectedModuleId, "module-attention");
  assert.equal(afterMapSelect.mapSelectedModuleId, "module-attention");
  assert.equal(afterMapSelect.outlineSelectedModuleId, "module-attention");

  // Switch to Outline -> selection and filters preserved
  plan.setFilters({ showDueReviewsOnly: true, requirementFilter: "required" });
  const inOutline = plan.switchView("Outline");
  assert.equal(inOutline.activeView, "Outline");
  assert.equal(inOutline.selectedModuleId, "module-attention");
  assert.equal(inOutline.filters.showDueReviewsOnly, true);
  assert.equal(inOutline.filters.requirementFilter, "required");

  // Select activity in Outline -> updates Map module and activity selection
  const afterOutlineActivity = plan.selectActivity(
    "activity-coding",
    "module-foundations",
    "Outline"
  );
  assert.equal(afterOutlineActivity.mapSelectedModuleId, "module-foundations");
  assert.equal(afterOutlineActivity.outlineSelectedModuleId, "module-foundations");
  assert.equal(afterOutlineActivity.mapSelectedActivityId, "activity-coding");
  assert.equal(afterOutlineActivity.outlineSelectedActivityId, "activity-coding");

  // Keyboard navigation works without dragging
  const afterKeyDown = plan.handleKeyboardNavigation("ArrowDown");
  assert.equal(afterKeyDown.selectedModuleId, "module-attention");
  const afterKeyUp = plan.handleKeyboardNavigation("ArrowUp");
  assert.equal(afterKeyUp.selectedModuleId, "module-foundations");

  // Non-dragging viewport controls
  assert.equal(plan.applyMapViewportControl("zoom_in").zoomLevel, 1.25);
  assert.equal(plan.applyMapViewportControl("reset_focus").zoomLevel, 1.0);

  // Parity report confirms 100% action equivalence and zero dragging requirement
  const parity = plan.getParityReport();
  assert.equal(parity.selectionSynchronized, true);
  assert.equal(parity.filtersSynchronized, true);
  assert.equal(parity.actionsEquivalent, true);
  assert.equal(parity.requiresDragging, false);
  assert.equal(parity.keyboardReachable, true);
  assert.equal(parity.singlePointerReachable, true);
  assert.deepEqual(parity.mapActions, parity.outlineActions);

  // Study ahead and skip activity never manufacture prerequisite evidence or waivers (@S51, @S75)
  const studyAheadOutcome = plan.studyAhead("activity-quiz", ["objective-tokenization"]);
  assert.equal(studyAheadOutcome.prerequisiteActivitiesCompletedOrSkipped, false);
  assert.equal(studyAheadOutcome.waiverCreated, false);
  assert.equal(studyAheadOutcome.proficiencyChanged, false);
  assert.equal(studyAheadOutcome.demonstrationGateSatisfied, false);
  assert.equal(studyAheadOutcome.bypassesResourceRightsOrPaidAuth, false);

  const skipOutcome = plan.skipActivity("activity-example");
  assert.equal(skipOutcome.recordedStatus, "self_reported_skipped");
  assert.equal(skipOutcome.prerequisiteEvidenceManufactured, false);
  assert.equal(skipOutcome.bypassesResourceRightsOrPaidAuth, false);
});

test("Navigation shell preserves deep links, sign-in return context, external open safety, deliberate submit, account cache isolation, and contract guards (@S71, @S76, @S77, @S87, @S88)", () => {
  const shell = createNavigationShellController({
    initialAccountId: "learner-a",
    initialViewportWidthPx: 320,
    initialTextScalePercent: 200,
  });

  // Navigate to public revision in Explore and preserve sign-in return context (@S71)
  shell.navigateDeepLink({
    topLevel: "Explore",
    selectedRevisionId: "pub-rev-42",
    selectedModuleId: "module-attention",
  });
  shell.preserveSignInReturnContext();
  const signInTransition = shell.completeSignInReturn("learner-a");
  assert.equal(signInTransition.restoredContext.topLevel, "Explore");
  assert.equal(signInTransition.restoredContext.selectedRevisionId, "pub-rev-42");
  assert.equal(signInTransition.autoVoteTriggered, false);
  assert.equal(signInTransition.autoPublishTriggered, false);
  assert.equal(signInTransition.autoActivateTriggered, false);
  assert.equal(signInTransition.autoPaymentTriggered, false);

  // Back navigation restores prior state safely
  const afterBack = shell.navigateBack();
  assert.equal(afterBack.current.topLevel, "Learn");
  assert.equal(afterBack.current.learnSubDestination, "Today");

  // External resource navigation never marks activity completed or demonstrated (@S76)
  const extOutcome = shell.openExternalResource(
    "activity-theory",
    "https://example.edu/tokenization-notes"
  );
  assert.equal(extOutcome.openedExternally, true);
  assert.equal(extOutcome.markedCompletedOnOpen, false);
  assert.equal(extOutcome.demonstratedCompetenceOnOpen, false);

  // Selecting an assessment option never auto-submits or advances (@S77)
  const selectOutcome = shell.selectAssessmentOption("q-1", "opt-b");
  assert.equal(selectOutcome.submitted, false);
  assert.equal(selectOutcome.advancedToNextQuestion, false);

  // Account switch isolates private draft caches while keeping appearance settings presentation-only (@S87)
  shell.updateAppearance({ themePreference: "dark", solidSurfaces: true });
  const switched = shell.handleAccountSwitch("learner-b");
  assert.equal(switched.accountId, "learner-b");
  assert.ok(!switched.privateDraftCacheKeys.some((k) => k.includes("learner-a")));
  assert.equal(switched.appearance.themePreference, "dark");

  // Contract and role guard rejects unknown contracts and unauthorized admin roles without simulated success (@S88)
  const unauthorized = shell.evaluateSurfaceContractSupport(
    "quarantinePublication",
    ["learner"],
    "moderator"
  );
  assert.equal(unauthorized.status, "unauthorized_role");
  assert.equal(unauthorized.simulatedSuccessRendered, false);

  const unsupported = shell.evaluateSurfaceContractSupport("nonExistentExperimentalEndpoint");
  assert.equal(unsupported.status, "unsupported_contract");
  assert.equal(unsupported.simulatedSuccessRendered, false);

  const supported = shell.evaluateSurfaceContractSupport("startGeneration", ["learner"]);
  assert.equal(supported.status, "authorized_and_supported");
  assert.equal(supported.simulatedSuccessRendered, false);
});
