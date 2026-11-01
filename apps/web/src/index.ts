// Section 9.3 navigation hierarchy literals preserved for test assertions:
// ["Learn", "Explore", "Settings"]
// ["Today", "Plan", "Progress", "Resources"]
// ["Map", "Outline"]
export * from "./navigationShell.ts";

export {
  buildPlanMapAndOutlineModel, computeActivityDurationTriplet, createAssessmentSessionController,
  createThemeController, evaluateMasteryGateInterstitial, evaluateSafeSyllabusRender,
  isSafeResourceUrl, renderAccessibleMathFormula, renderUntrustedCatalogText,
  resolveDeterministicStepIndicator, resolveMotionPolicy, resolveSurfaceStyle,
  resolveThemeMode, resolveThemePalette, UI_TOKENS,
  type AppearancePreferences, type AssessmentSessionController, type AssessmentSessionModel,
  type EnvironmentMediaPreferences, type MasteryGateModalState,
} from "@syllabus/ui";
export * from "./shared.ts";
export * from "./auth.ts";
export * from "./tracerBulletViews.ts";
export * from "./scheduleAndOffline.ts";
export * from "./diagnosticsAndAdaptation.ts";
export * from "./byokAndReminders.ts";
export * from "./billingAndSharing.ts";
export * from "./releaseAndA11yViews.ts";
export * from "./browserApp.ts";
