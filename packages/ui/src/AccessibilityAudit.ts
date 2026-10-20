import { UI_TOKENS, type SemanticColorToken, type ThemeMode } from "./tokens.ts";
import {
  STUDY_SURFACE_KINDS,
  resolveSurfaceStyle,
  resolveThemePalette,
  type StudySurfaceKind,
} from "./theme.ts";

export type WcagContrastCategory = "normal_text" | "large_text" | "ui_component";

export interface TokenContrastEvaluation {
  readonly mode: ThemeMode;
  readonly pairId: string;
  readonly foregroundToken: SemanticColorToken;
  readonly backgroundToken: SemanticColorToken;
  readonly foregroundHex: string;
  readonly backgroundHex: string;
  readonly category: WcagContrastCategory;
  readonly minimumRequiredRatio: number;
  readonly contrastRatio: number;
  readonly passes: boolean;
}

export type ManualWcagEvaluationPartId =
  | "keyboard_operation"
  | "focus_visibility"
  | "screen_readers"
  | "accessible_math_katex_mathml"
  | "zoom_and_reflow_320px_200pct"
  | "reduced_motion"
  | "forced_colors"
  | "map_outline_equivalence";

export interface ManualWcagEvaluationPartSpec {
  readonly partNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly id: ManualWcagEvaluationPartId;
  readonly title: string;
  readonly wcagCriteria: readonly string[];
  readonly requiredAssistiveTechOrEnvironment: readonly string[];
  readonly verificationSteps: readonly string[];
  readonly passCondition: string;
}

export interface ManualWcagEvaluationMatrixSpec {
  readonly standard: "WCAG 2.2 AA";
  readonly requirementId: "UI-015";
  readonly automatedToolingSufficientAlone: false;
  readonly parts: readonly ManualWcagEvaluationPartSpec[];
}

export interface ScreenAccessibilityDescriptor {
  readonly screenId: string;
  readonly landmarkRole: "main" | "region" | "dialog";
  readonly headingText: string;
  readonly surfaceKind: StudySurfaceKind;
  readonly touchTargetMinPx: number;
  readonly primaryCompactTargetPx: number;
  readonly ariaLiveRegion: "polite" | "assertive";
  readonly keyboardTrapPresent: boolean;
  readonly supportsReducedMotion: boolean;
  readonly supportsForcedColors: boolean;
  readonly supports320PxReflow: boolean;
  readonly supportsOutlineParity: boolean;
}

export interface AutomatedAccessibilityAuditReport {
  readonly standard: "WCAG 2.2 AA";
  readonly automatedChecksPass: boolean;
  readonly replacesManualWcagEvaluation: false;
  readonly automatedChecksAreNecessaryButNotSufficient: true;
  readonly contrastEvaluations: readonly TokenContrastEvaluation[];
  readonly opaqueSurfaceChecksPass: boolean;
  readonly touchTargetChecksPass: boolean;
  readonly zeroKeyboardTraps: boolean;
  readonly politeLiveRegionsVerified: boolean;
  readonly reflow320PxVerified: boolean;
  readonly outlineEquivalenceVerified: boolean;
  readonly violations: readonly string[];
  readonly manualEvaluationMatrix: ManualWcagEvaluationMatrixSpec;
}

function parseHexChannel(hex: string, start: number): number {
  const raw = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
}

export function calculateRelativeLuminance(hexColor: string): number {
  const normalized = hexColor.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected 6-digit hex color, received '${hexColor}'`);
  }
  const r = parseHexChannel(normalized, 0);
  const g = parseHexChannel(normalized, 2);
  const b = parseHexChannel(normalized, 4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function calculateContrastRatio(
  foregroundHex: string,
  backgroundHex: string
): number {
  const l1 = calculateRelativeLuminance(foregroundHex);
  const l2 = calculateRelativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function minimumRatioForCategory(category: WcagContrastCategory): number {
  return category === "normal_text" ? 4.5 : 3.0;
}

const REQUIRED_TOKEN_PAIRS: ReadonlyArray<{
  readonly pairId: string;
  readonly foregroundToken: SemanticColorToken;
  readonly backgroundToken: SemanticColorToken;
  readonly category: WcagContrastCategory;
}> = [
  {
    pairId: "text-primary-on-canvas",
    foregroundToken: "text-primary",
    backgroundToken: "canvas",
    category: "normal_text",
  },
  {
    pairId: "text-primary-on-surface",
    foregroundToken: "text-primary",
    backgroundToken: "surface",
    category: "normal_text",
  },
  {
    pairId: "text-primary-on-surface-secondary",
    foregroundToken: "text-primary",
    backgroundToken: "surface-secondary",
    category: "normal_text",
  },
  {
    pairId: "text-secondary-on-canvas",
    foregroundToken: "text-secondary",
    backgroundToken: "canvas",
    category: "normal_text",
  },
  {
    pairId: "text-secondary-on-surface",
    foregroundToken: "text-secondary",
    backgroundToken: "surface",
    category: "normal_text",
  },
  {
    pairId: "action-text-on-action-fill",
    foregroundToken: "action-text",
    backgroundToken: "action-fill",
    category: "normal_text",
  },
  {
    pairId: "success-text-on-success-surface",
    foregroundToken: "success-text",
    backgroundToken: "success-surface",
    category: "normal_text",
  },
  {
    pairId: "warning-text-on-warning-surface",
    foregroundToken: "warning-text",
    backgroundToken: "warning-surface",
    category: "normal_text",
  },
  {
    pairId: "danger-text-on-danger-surface",
    foregroundToken: "danger-text",
    backgroundToken: "danger-surface",
    category: "normal_text",
  },
  {
    pairId: "border-control-on-surface",
    foregroundToken: "border-control",
    backgroundToken: "surface",
    category: "ui_component",
  },
  {
    pairId: "accent-on-accent-surface",
    foregroundToken: "accent",
    backgroundToken: "accent-surface",
    category: "ui_component",
  },
];

export function evaluateThemeTokenContrast(
  mode: ThemeMode
): readonly TokenContrastEvaluation[] {
  const palette = resolveThemePalette(mode, mode);
  return REQUIRED_TOKEN_PAIRS.map((pair) => {
    const foregroundHex = palette.colors[pair.foregroundToken];
    const backgroundHex = palette.colors[pair.backgroundToken];
    const minimumRequiredRatio = minimumRatioForCategory(pair.category);
    const contrastRatio = calculateContrastRatio(foregroundHex, backgroundHex);
    return {
      mode,
      pairId: pair.pairId,
      foregroundToken: pair.foregroundToken,
      backgroundToken: pair.backgroundToken,
      foregroundHex,
      backgroundHex,
      category: pair.category,
      minimumRequiredRatio,
      contrastRatio,
      passes: contrastRatio >= minimumRequiredRatio,
    };
  });
}

export const MANUAL_WCAG_22_AA_EVALUATION_MATRIX: ManualWcagEvaluationMatrixSpec = {
  standard: "WCAG 2.2 AA",
  requirementId: "UI-015",
  automatedToolingSufficientAlone: false,
  parts: [
    {
      partNumber: 1,
      id: "keyboard_operation",
      title: "Keyboard Operation & Zero Keyboard Traps",
      wcagCriteria: ["2.1.1", "2.1.2", "2.4.3"],
      requiredAssistiveTechOrEnvironment: ["Physical keyboard (Tab, Shift+Tab, Enter, Space, Escape, Arrow keys)"],
      verificationSteps: [
        "Navigate every launch screen, modal confirmation, and form control using only the keyboard.",
        "Verify Escape or explicit close buttons dismiss dialogs and return focus to the invoking trigger.",
        "Confirm no component traps Tab or Arrow key navigation.",
      ],
      passCondition: "All interactive actions are operable via keyboard alone with deterministic focus order and zero keyboard traps.",
    },
    {
      partNumber: 2,
      id: "focus_visibility",
      title: "Unobscured High-Contrast Focus Visibility",
      wcagCriteria: ["2.4.7", "2.4.11", "1.4.11"],
      requiredAssistiveTechOrEnvironment: ["Light theme", "Dark theme"],
      verificationSteps: [
        "Tab through primary actions, secondary actions, form fields, and tree/map nodes in both light and dark modes.",
        "Confirm focus indicators meet >= 3:1 contrast against adjacent surfaces and are never obscured by sticky headers or sheets.",
      ],
      passCondition: "Every focusable element displays an unobscured, >= 3:1 contrast focus indicator in light and dark modes.",
    },
    {
      partNumber: 3,
      id: "screen_readers",
      title: "Screen-Reader Semantics, Landmarks & Live Announcements",
      wcagCriteria: ["1.3.1", "3.3.1", "3.3.2", "4.1.2", "4.1.3"],
      requiredAssistiveTechOrEnvironment: ["VoiceOver (macOS/iOS)", "NVDA (Windows)"],
      verificationSteps: [
        "Traverse page landmarks, headings, and form inputs using screen-reader rotor/navigation shortcuts.",
        "Trigger asynchronous generation, billing reservation, upvote, and assessment feedback updates to verify polite aria-live announcements.",
        "Trigger validation errors and confirm error summaries are programmatically associated with fields.",
      ],
      passCondition: "All controls expose accurate accessible names, roles, states, and polite status announcements without stealing focus.",
    },
    {
      partNumber: 4,
      id: "accessible_math_katex_mathml",
      title: "Accessible Mathematical Notation (KaTeX + MathML)",
      wcagCriteria: ["1.1.1", "1.3.1", "1.4.5"],
      requiredAssistiveTechOrEnvironment: ["KaTeX MathML output", "VoiceOver / NVDA math reading"],
      verificationSteps: [
        "Inspect rendered inline and display math blocks in study activities and assessment prompts.",
        "Verify each formula includes semantic <math> MathML markup, an <annotation encoding=\"application/x-tex\"> source fallback, and an aria-label.",
      ],
      passCondition: "Mathematical expressions are navigable and readable by assistive technologies without relying on raster images.",
    },
    {
      partNumber: 5,
      id: "zoom_and_reflow_320px_200pct",
      title: "200% Text Zoom & 320 CSS px Reflow",
      wcagCriteria: ["1.4.4", "1.4.10"],
      requiredAssistiveTechOrEnvironment: ["Browser viewport at 320 CSS px width", "Browser zoom at 200%"],
      verificationSteps: [
        "Set viewport width to 320 CSS px and verify single-column layout reflow across onboarding, study runner, billing ledger, and publication preview.",
        "Increase text zoom to 200% and verify no text truncation, overlapping controls, or two-dimensional scrolling occurs.",
      ],
      passCondition: "All launch flows remain readable and operable at 320 CSS px width and 200% zoom without horizontal scrolling.",
    },
    {
      partNumber: 6,
      id: "reduced_motion",
      title: "System Reduced-Motion Compliance",
      wcagCriteria: ["2.3.3", "2.2.2"],
      requiredAssistiveTechOrEnvironment: ["prefers-reduced-motion: reduce"],
      verificationSteps: [
        "Enable system reduced motion preference and trigger route transitions, plan diff animations, and progress updates.",
        "Verify transitionDurationMs resolves to 0 and no decorative motion or parallax effects run.",
      ],
      passCondition: "System reduced-motion setting immediately suppresses non-essential animation across all views.",
    },
    {
      partNumber: 7,
      id: "forced_colors",
      title: "Forced-Colors & High-Contrast Mode Integrity",
      wcagCriteria: ["1.4.1", "1.4.11"],
      requiredAssistiveTechOrEnvironment: ["forced-colors: active (Windows High Contrast / emulated forced-colors)"],
      verificationSteps: [
        "Enable forced-colors: active and inspect study cards, mastery badges, billing tables, and destructive confirmation modals.",
        "Verify state distinctions do not rely on color alone and all interactive borders remain visible via transparent/system outlines.",
      ],
      passCondition: "All structural boundaries, focus rings, and status badges remain distinguishable under forced-colors: active.",
    },
    {
      partNumber: 8,
      id: "map_outline_equivalence",
      title: "Curriculum Map & Accessible Outline Tree Functional Equivalence",
      wcagCriteria: ["1.1.1", "2.1.1", "2.4.6", "4.1.2"],
      requiredAssistiveTechOrEnvironment: ["Keyboard + Screen Reader on Plan Map / Outline toggle"],
      verificationSteps: [
        "Compare every node inspection, prerequisite traversal, and module launch action available in the spatial Curriculum Map against the Outline Tree.",
        "Confirm narrow viewports (< 600 CSS px) default to the accessible Outline Tree and preserve selection state when switching views.",
      ],
      passCondition: "100% of Curriculum Map information and actions are achievable through the semantic Outline Tree view.",
    },
  ],
};

export function runAutomatedAccessibilityRegressionCheck(
  screens: readonly ScreenAccessibilityDescriptor[]
): AutomatedAccessibilityAuditReport {
  const violations: string[] = [];

  const contrastEvaluations = [
    ...evaluateThemeTokenContrast("light"),
    ...evaluateThemeTokenContrast("dark"),
  ];
  for (const evaluation of contrastEvaluations) {
    if (!evaluation.passes) {
      violations.push(
        `Contrast failure (${evaluation.mode}) ${evaluation.pairId}: ${evaluation.contrastRatio}:1 < ${evaluation.minimumRequiredRatio}:1`
      );
    }
  }

  let opaqueSurfaceChecksPass = UI_TOKENS.effects.opaque_content === true;
  for (const surfaceKind of STUDY_SURFACE_KINDS) {
    const resolved = resolveSurfaceStyle(surfaceKind, {
      themePreference: "light",
    });
    const resolvedDark = resolveSurfaceStyle(surfaceKind, {
      themePreference: "dark",
    });
    if (
      !resolved.opaque ||
      resolved.opacity !== 1 ||
      resolved.backdropBlurPx !== 0 ||
      !resolvedDark.opaque ||
      resolvedDark.opacity !== 1 ||
      resolvedDark.backdropBlurPx !== 0
    ) {
      opaqueSurfaceChecksPass = false;
      violations.push(
        `Surface '${surfaceKind}' violated UI-001 opaque study surface rule.`
      );
    }
  }

  let touchTargetChecksPass =
    UI_TOKENS.layout_css_px.touch_target_min >= 44 &&
    UI_TOKENS.layout_css_px.primary_compact_target >= 48;

  let zeroKeyboardTraps = true;
  let politeLiveRegionsVerified = true;
  let reflow320PxVerified = true;
  let outlineEquivalenceVerified = true;

  if (screens.length === 0) {
    violations.push("Screen inventory for automated accessibility regression check cannot be empty.");
  }

  for (const screen of screens) {
    if (!screen.headingText.trim()) {
      violations.push(`Screen '${screen.screenId}' is missing a primary heading.`);
    }
    if (screen.touchTargetMinPx < 44 || screen.primaryCompactTargetPx < 48) {
      touchTargetChecksPass = false;
      violations.push(
        `Screen '${screen.screenId}' touch targets (${screen.touchTargetMinPx}px / ${screen.primaryCompactTargetPx}px) fall below 44px / 48px minimums.`
      );
    }
    if (screen.keyboardTrapPresent) {
      zeroKeyboardTraps = false;
      violations.push(`Screen '${screen.screenId}' reported a keyboard trap.`);
    }
    if (screen.ariaLiveRegion !== "polite" && screen.ariaLiveRegion !== "assertive") {
      politeLiveRegionsVerified = false;
      violations.push(`Screen '${screen.screenId}' is missing an aria-live announcement region.`);
    }
    if (!screen.supports320PxReflow) {
      reflow320PxVerified = false;
      violations.push(`Screen '${screen.screenId}' does not support 320 CSS px reflow.`);
    }
    if (!screen.supportsOutlineParity) {
      outlineEquivalenceVerified = false;
      violations.push(`Screen '${screen.screenId}' failed outline equivalence check.`);
    }
  }

  return {
    standard: "WCAG 2.2 AA",
    automatedChecksPass: violations.length === 0,
    replacesManualWcagEvaluation: false,
    automatedChecksAreNecessaryButNotSufficient: true,
    contrastEvaluations,
    opaqueSurfaceChecksPass,
    touchTargetChecksPass,
    zeroKeyboardTraps,
    politeLiveRegionsVerified,
    reflow320PxVerified,
    outlineEquivalenceVerified,
    violations,
    manualEvaluationMatrix: MANUAL_WCAG_22_AA_EVALUATION_MATRIX,
  };
}
