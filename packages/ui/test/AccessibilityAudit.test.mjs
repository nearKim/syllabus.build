import test from "node:test";
import assert from "node:assert/strict";

import {
  MANUAL_WCAG_22_AA_EVALUATION_MATRIX,
  UI_TOKENS,
  calculateContrastRatio,
  calculateRelativeLuminance,
  evaluateThemeTokenContrast,
  runAutomatedAccessibilityRegressionCheck,
} from "../src/index.ts";

test("T14-Full: WCAG 2.2 AA relative luminance and contrast ratio across light and dark tokens", () => {
  assert.equal(calculateRelativeLuminance("#FFFFFF"), 1);
  assert.equal(calculateRelativeLuminance("#000000"), 0);
  assert.equal(calculateContrastRatio("#FFFFFF", "#000000"), 21);

  for (const mode of ["light", "dark"]) {
    const evaluations = evaluateThemeTokenContrast(mode);
    assert.ok(evaluations.length >= 11);
    for (const item of evaluations) {
      assert.equal(
        item.passes,
        true,
        `Expected ${mode} ${item.pairId} (${item.contrastRatio}:1) >= ${item.minimumRequiredRatio}:1`
      );
    }
  }
});

test("T14-Full: 8-part manual WCAG 2.2 AA evaluation matrix is complete and distinct from automated checks", () => {
  assert.equal(MANUAL_WCAG_22_AA_EVALUATION_MATRIX.standard, "WCAG 2.2 AA");
  assert.equal(MANUAL_WCAG_22_AA_EVALUATION_MATRIX.requirementId, "UI-015");
  assert.equal(
    MANUAL_WCAG_22_AA_EVALUATION_MATRIX.automatedToolingSufficientAlone,
    false
  );
  assert.equal(MANUAL_WCAG_22_AA_EVALUATION_MATRIX.parts.length, 8);
  assert.deepEqual(
    MANUAL_WCAG_22_AA_EVALUATION_MATRIX.parts.map((p) => p.id),
    [
      "keyboard_operation",
      "focus_visibility",
      "screen_readers",
      "accessible_math_katex_mathml",
      "zoom_and_reflow_320px_200pct",
      "reduced_motion",
      "forced_colors",
      "map_outline_equivalence",
    ]
  );
});

test("T14-Full: automated accessibility regression check validates screens and flags violations", () => {
  const validReport = runAutomatedAccessibilityRegressionCheck([
    {
      screenId: "sample_study_screen",
      landmarkRole: "main",
      headingText: "Today's Study Session",
      surfaceKind: "reading",
      touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
      primaryCompactTargetPx: UI_TOKENS.layout_css_px.primary_compact_target,
      ariaLiveRegion: "polite",
      keyboardTrapPresent: false,
      supportsReducedMotion: true,
      supportsForcedColors: true,
      supports320PxReflow: true,
      supportsOutlineParity: true,
    },
  ]);

  assert.equal(validReport.automatedChecksPass, true);
  assert.equal(validReport.replacesManualWcagEvaluation, false);
  assert.equal(validReport.automatedChecksAreNecessaryButNotSufficient, true);
  assert.equal(validReport.opaqueSurfaceChecksPass, true);
  assert.equal(validReport.touchTargetChecksPass, true);
  assert.equal(validReport.zeroKeyboardTraps, true);
  assert.equal(validReport.violations.length, 0);

  const failingReport = runAutomatedAccessibilityRegressionCheck([
    {
      screenId: "broken_screen",
      landmarkRole: "main",
      headingText: "",
      surfaceKind: "study_card",
      touchTargetMinPx: 32,
      primaryCompactTargetPx: 36,
      ariaLiveRegion: "polite",
      keyboardTrapPresent: true,
      supportsReducedMotion: true,
      supportsForcedColors: true,
      supports320PxReflow: false,
      supportsOutlineParity: false,
    },
  ]);

  assert.equal(failingReport.automatedChecksPass, false);
  assert.equal(failingReport.touchTargetChecksPass, false);
  assert.equal(failingReport.zeroKeyboardTraps, false);
  assert.equal(failingReport.reflow320PxVerified, false);
  assert.equal(failingReport.outlineEquivalenceVerified, false);
  assert.ok(failingReport.violations.length >= 5);
});
