/**
 * Section 9.2 Visual System, Semantic Theme Controller, Opaque Study Surfaces,
 * Restrained Navigation Glass Fallbacks & Motion Policy (`UI-007`, `UI-008`,
 * `UI-021`, `UI-022`, `UI-023`, `@S69`, `@S70`, `@S78`, `@S79`, `@S86`, `@S87`).
 */

import { UI_TOKENS, type SemanticColorToken, type ThemeMode } from "./tokens.ts";

export type ThemePreference = "light" | "dark" | "system";

/**
 * Surfaces where study content, reading, math, code, assessments, evidence,
 * pricing, or consent are rendered. These surfaces MUST always remain 100% opaque
 * (`UI_TOKENS.effects.opaque_content === true`, `UI-008`, `UI-022`, `@S70`, `@S79`).
 */
export const STUDY_SURFACE_KINDS = [
  "reading",
  "math",
  "code",
  "assessment",
  "quiz",
  "dense_table",
  "evidence",
  "pricing",
  "consent",
  "destructive_confirmation",
  "study_card",
] as const;

export type StudySurfaceKind = (typeof STUDY_SURFACE_KINDS)[number];

/**
 * Top-level navigation chrome where restrained translucent glass (`0.92` opacity,
 * `12px` backdrop blur) is permitted when system and user preferences allow it.
 */
export const NAVIGATION_CHROME_SURFACE_KINDS = [
  "navigation_header",
  "bottom_navigation",
  "compact_map_toolbar",
  "navigation_chrome",
] as const;

export type NavigationChromeSurfaceKind = (typeof NAVIGATION_CHROME_SURFACE_KINDS)[number];

export type SurfaceKind = StudySurfaceKind | NavigationChromeSurfaceKind;

/**
 * Section 9.2 canonical typography scale and line-width bounds.
 */
export const TYPOGRAPHY_TOKENS = {
  page_title: {
    compactPx: 28,
    widePx: 36,
    fontWeight: 600,
    lineHeight: 1.15,
  },
  section_title: {
    compactPx: 22,
    widePx: 24,
    fontWeight: 600,
    lineHeight: 1.25,
  },
  card_title: {
    compactPx: 18,
    widePx: 18,
    fontWeight: 600,
    lineHeight: 1.35,
  },
  body: {
    compactPx: 16,
    widePx: 16,
    fontWeight: 400,
    lineHeight: 1.5,
    minLineWidthCh: 60,
    maxLineWidthCh: 70,
  },
  metadata: {
    compactPx: 14,
    widePx: 14,
    fontWeight: 400,
    lineHeight: 1.45,
  },
  code: {
    compactPx: 14,
    widePx: 14,
    fontWeight: 400,
    lineHeight: 1.55,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
} as const;

export const CORNER_RADIUS_TOKENS = {
  controlPx: 12,
  cardPx: 16,
  sheetPx: 24,
} as const;

export const CARD_PADDING_TOKENS = {
  compactPx: 20,
  widePx: 24,
} as const;

export interface EnvironmentMediaPreferences {
  readonly systemColorScheme?: ThemeMode;
  readonly prefersReducedMotion?: boolean;
  readonly prefersReducedTransparency?: boolean;
  readonly backdropFilterSupported?: boolean;
  readonly forcedColorsActive?: boolean;
}

export interface AppearancePreferences {
  readonly themePreference?: ThemePreference;
  readonly solidSurfaces?: boolean;
  readonly reduceMotion?: boolean;
}

export interface FocusIndicatorStyle {
  readonly widthPx: 2;
  readonly offsetPx: 2;
  readonly style: "solid";
  readonly color: string;
}

export interface ResolvedThemePalette {
  readonly mode: ThemeMode;
  readonly rootColorScheme: "light dark";
  readonly colors: Readonly<Record<SemanticColorToken, string>>;
}

export interface ResolvedSurfaceStyle {
  readonly surfaceKind: SurfaceKind;
  readonly isStudySurface: boolean;
  readonly opaque: boolean;
  readonly opacity: number;
  readonly backdropBlurPx: number;
  readonly backdropFilterCss: string;
  readonly usesSolidFallback: boolean;
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly secondaryTextColor: string;
  readonly borderColor: string;
  readonly borderWidthPx: number;
  readonly borderStyle: "solid";
  readonly focusRing: FocusIndicatorStyle;
  readonly forcedColorsActive: boolean;
  readonly shadowOnlyAffordanceAllowed: false;
}

export interface ResolvedMotionPolicy {
  readonly reducedMotion: boolean;
  readonly systemReductionWins: true;
  readonly transitionMs: readonly [number, number];
  readonly transitionDurationCss: string;
  readonly sheetMaxMs: number;
  readonly allowAnimatedSpinners: boolean;
  readonly allowDecorativeShimmer: false;
  readonly allowAnimatedGraphLayout: boolean;
  readonly allowParallax: false;
}

export type AuthoritativeJobStatus =
  | "queued"
  | "running"
  | "validating"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export interface DeterministicStepIndicator {
  readonly status: AuthoritativeJobStatus;
  readonly stepLabel: string;
  readonly showAnimatedSpinner: boolean;
  readonly fabricatedProgressPercentage: null;
}

const STUDY_SURFACE_SET: ReadonlySet<string> = new Set(STUDY_SURFACE_KINDS);

/**
 * Resolves `"light"`, `"dark"`, or `"system"` preference into an effective `ThemeMode`.
 */
export function resolveThemeMode(
  preference: ThemePreference = "system",
  systemColorScheme: ThemeMode = "light"
): ThemeMode {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return systemColorScheme === "dark" ? "dark" : "light";
}

/**
 * Resolves the semantic color token dictionary for the active `ThemeMode`.
 * Includes `rootColorScheme: "light dark"` for `:root` viewport-level native control adaptation.
 */
export function resolveThemePalette(
  preference: ThemePreference = "system",
  systemColorScheme: ThemeMode = "light"
): ResolvedThemePalette {
  const mode = resolveThemeMode(preference, systemColorScheme);
  const colors = {} as Record<SemanticColorToken, string>;
  const tokenKeys = Object.keys(UI_TOKENS.colors) as SemanticColorToken[];
  for (const key of tokenKeys) {
    colors[key] = UI_TOKENS.colors[key][mode];
  }
  return {
    mode,
    rootColorScheme: "light dark",
    colors,
  };
}

export function isStudySurfaceKind(surfaceKind: SurfaceKind): surfaceKind is StudySurfaceKind {
  return STUDY_SURFACE_SET.has(surfaceKind);
}

/**
 * Computes surface styles enforcing:
 * 1. Opaque study surfaces (`opaque_content: true`) for reading, math, code, assessments,
 *    dense tables, evidence, pricing, and consent (`UI-008`, `UI-022`, `@S70`, `@S79`).
 * 2. Restrained glass (`glass_opacity: 0.92`, `backdrop_blur_css_px: 12`) strictly limited
 *    to top-level navigation chrome, with solid fallbacks when `prefers-reduced-transparency: reduce`,
 *    app `solidSurfaces`, `forced-colors: active`, or unsupported `backdrop-filter` applies.
 * 3. High-contrast semantic borders and explicit 2px focus ring with 2px offset.
 */
export function resolveSurfaceStyle(
  surfaceKind: SurfaceKind,
  preferences: AppearancePreferences = {},
  env: EnvironmentMediaPreferences = {}
): ResolvedSurfaceStyle {
  const palette = resolveThemePalette(
    preferences.themePreference ?? "system",
    env.systemColorScheme ?? "light"
  );
  const studySurface = isStudySurfaceKind(surfaceKind);
  const forcedColors = env.forcedColorsActive === true;
  const backdropSupported = env.backdropFilterSupported !== false;
  const reducedTransparency =
    Boolean(preferences.solidSurfaces) ||
    (UI_TOKENS.effects.system_reduction_wins && Boolean(env.prefersReducedTransparency));

  const mustUseSolidSurface =
    studySurface ||
    UI_TOKENS.effects.opaque_content && studySurface ||
    reducedTransparency ||
    !backdropSupported ||
    forcedColors;

  const opacity = mustUseSolidSurface ? 1 : UI_TOKENS.effects.glass_opacity;
  const backdropBlurPx = mustUseSolidSurface ? 0 : UI_TOKENS.effects.backdrop_blur_css_px;
  const backdropFilterCss = mustUseSolidSurface ? "none" : `blur(${backdropBlurPx}px)`;

  const backgroundColor = forcedColors ? "Canvas" : palette.colors.surface;
  const textColor = forcedColors ? "CanvasText" : palette.colors["text-primary"];
  const secondaryTextColor = forcedColors ? "CanvasText" : palette.colors["text-secondary"];
  const borderColor = forcedColors ? "ButtonBorder" : palette.colors["border-control"];
  const focusColor = forcedColors ? "Highlight" : palette.colors.accent;

  return {
    surfaceKind,
    isStudySurface: studySurface,
    opaque: mustUseSolidSurface,
    opacity,
    backdropBlurPx,
    backdropFilterCss,
    usesSolidFallback: mustUseSolidSurface,
    backgroundColor,
    textColor,
    secondaryTextColor,
    borderColor,
    borderWidthPx: forcedColors ? 2 : 1,
    borderStyle: "solid",
    focusRing: {
      widthPx: 2,
      offsetPx: 2,
      style: "solid",
      color: focusColor,
    },
    forcedColorsActive: forcedColors,
    shadowOnlyAffordanceAllowed: false,
  };
}

/**
 * Resolves motion durations and animation permissions (`UI-022`, `@S78`, `@S86`).
 * System `prefers-reduced-motion: reduce` always wins over app preferences
 * (`UI_TOKENS.effects.system_reduction_wins === true`).
 */
export function resolveMotionPolicy(
  preferences: AppearancePreferences = {},
  env: EnvironmentMediaPreferences = {}
): ResolvedMotionPolicy {
  const reducedMotion =
    (UI_TOKENS.effects.system_reduction_wins && Boolean(env.prefersReducedMotion)) ||
    Boolean(preferences.reduceMotion);

  if (reducedMotion) {
    return {
      reducedMotion: true,
      systemReductionWins: true,
      transitionMs: [0, 0] as const,
      transitionDurationCss: "0ms",
      sheetMaxMs: 0,
      allowAnimatedSpinners: false,
      allowDecorativeShimmer: false,
      allowAnimatedGraphLayout: false,
      allowParallax: false,
    };
  }

  return {
    reducedMotion: false,
    systemReductionWins: true,
    transitionMs: UI_TOKENS.effects.transition_ms,
    transitionDurationCss: `${UI_TOKENS.effects.transition_ms[0]}ms`,
    sheetMaxMs: UI_TOKENS.effects.sheet_max_ms,
    allowAnimatedSpinners: true,
    allowDecorativeShimmer: false,
    allowAnimatedGraphLayout: true,
    allowParallax: false,
  };
}

const DETERMINISTIC_JOB_LABELS: Readonly<Record<AuthoritativeJobStatus, string>> = {
  queued: "Step 1 of 3: Queued — waiting for worker capacity",
  running: "Step 2 of 3: Running — generating structured curriculum draft",
  validating: "Step 3 of 3: Validating — verifying schema, prerequisites, and catalog rights",
  succeeded: "Completed: Validated curriculum draft ready for review",
  failed: "Failed: Generation stopped with an actionable error",
  cancel_requested: "Cancellation requested — awaiting worker confirmation",
  cancelled: "Cancelled: Job terminated without activating a plan",
};

/**
 * Produces a deterministic step label for asynchronous generation/adaptation jobs.
 * Disables animated spinners when `prefers-reduced-motion: reduce` is active and
 * never fabricates progress percentages (`@S74`, `@S78`, `@S86`).
 */
export function resolveDeterministicStepIndicator(
  status: AuthoritativeJobStatus,
  preferences: AppearancePreferences = {},
  env: EnvironmentMediaPreferences = {}
): DeterministicStepIndicator {
  const motion = resolveMotionPolicy(preferences, env);
  const isInFlight = status === "queued" || status === "running" || status === "validating";

  return {
    status,
    stepLabel: DETERMINISTIC_JOB_LABELS[status],
    showAnimatedSpinner: isInFlight && motion.allowAnimatedSpinners,
    fabricatedProgressPercentage: null,
  };
}

export interface ThemeControllerState {
  readonly themePreference: ThemePreference;
  readonly resolvedThemeMode: ThemeMode;
  readonly solidSurfaces: boolean;
  readonly reduceMotion: boolean;
  readonly env: EnvironmentMediaPreferences;
  readonly palette: ResolvedThemePalette;
  readonly motionPolicy: ResolvedMotionPolicy;
  readonly preservesLearningAndBillingState: true;
}

export interface ThemeController {
  getState(): ThemeControllerState;
  setThemePreference(themePreference: ThemePreference): ThemeControllerState;
  setSolidSurfaces(solidSurfaces: boolean): ThemeControllerState;
  setReduceMotion(reduceMotion: boolean): ThemeControllerState;
  setEnvironment(env: Partial<EnvironmentMediaPreferences>): ThemeControllerState;
  getSurfaceStyle(surfaceKind: SurfaceKind): ResolvedSurfaceStyle;
  getStepIndicator(status: AuthoritativeJobStatus): DeterministicStepIndicator;
}

/**
 * Creates a presentation-only appearance controller (`UI-021`, `UI-022`, `UI-023`, `@S87`).
 * Appearance updates never mutate proficiency evidence, curriculum content, or billing state.
 */
export function createThemeController(
  initialPreferences: AppearancePreferences = {},
  initialEnv: EnvironmentMediaPreferences = {}
): ThemeController {
  let preferences: AppearancePreferences = {
    themePreference: initialPreferences.themePreference ?? "system",
    solidSurfaces: initialPreferences.solidSurfaces ?? false,
    reduceMotion: initialPreferences.reduceMotion ?? false,
  };
  let env: EnvironmentMediaPreferences = {
    systemColorScheme: initialEnv.systemColorScheme ?? "light",
    prefersReducedMotion: initialEnv.prefersReducedMotion ?? false,
    prefersReducedTransparency: initialEnv.prefersReducedTransparency ?? false,
    backdropFilterSupported: initialEnv.backdropFilterSupported ?? true,
    forcedColorsActive: initialEnv.forcedColorsActive ?? false,
  };

  function getState(): ThemeControllerState {
    const pref = preferences.themePreference ?? "system";
    const sysScheme = env.systemColorScheme ?? "light";
    return {
      themePreference: pref,
      resolvedThemeMode: resolveThemeMode(pref, sysScheme),
      solidSurfaces: Boolean(preferences.solidSurfaces),
      reduceMotion: Boolean(preferences.reduceMotion),
      env,
      palette: resolveThemePalette(pref, sysScheme),
      motionPolicy: resolveMotionPolicy(preferences, env),
      preservesLearningAndBillingState: true,
    };
  }

  return {
    getState,
    setThemePreference(themePreference: ThemePreference): ThemeControllerState {
      preferences = { ...preferences, themePreference };
      return getState();
    },
    setSolidSurfaces(solidSurfaces: boolean): ThemeControllerState {
      preferences = { ...preferences, solidSurfaces };
      return getState();
    },
    setReduceMotion(reduceMotion: boolean): ThemeControllerState {
      preferences = { ...preferences, reduceMotion };
      return getState();
    },
    setEnvironment(nextEnv: Partial<EnvironmentMediaPreferences>): ThemeControllerState {
      env = { ...env, ...nextEnv };
      return getState();
    },
    getSurfaceStyle(surfaceKind: SurfaceKind): ResolvedSurfaceStyle {
      return resolveSurfaceStyle(surfaceKind, preferences, env);
    },
    getStepIndicator(status: AuthoritativeJobStatus): DeterministicStepIndicator {
      return resolveDeterministicStepIndicator(status, preferences, env);
    },
  };
}
