/**
 * Section 9.2 Visual System, Semantic Theme Controller, Opaque Study Surfaces,
 * Restrained Navigation Glass Fallbacks & Motion Policy (`UI-007`, `UI-008`,
 * `UI-021`, `UI-022`, `UI-023`, `@S69`, `@S70`, `@S78`, `@S79`, `@S86`, `@S87`).
 */

import { UI_TOKENS, type SemanticColorToken, type ThemeMode } from "./tokens.ts";

export type ThemePreference = "light" | "dark" | "system";

export const STUDY_SURFACE_KINDS = [
  "reading", "math", "code", "assessment", "quiz", "dense_table",
  "evidence", "pricing", "consent", "destructive_confirmation", "study_card",
] as const;

export type StudySurfaceKind = (typeof STUDY_SURFACE_KINDS)[number];

export const NAVIGATION_CHROME_SURFACE_KINDS = [
  "navigation_header", "bottom_navigation", "compact_map_toolbar", "navigation_chrome",
] as const;

export type NavigationChromeSurfaceKind = (typeof NAVIGATION_CHROME_SURFACE_KINDS)[number];
export type SurfaceKind = StudySurfaceKind | NavigationChromeSurfaceKind;

export const TYPOGRAPHY_TOKENS = {
  page_title: { compactPx: 28, widePx: 36, fontWeight: 600, lineHeight: 1.15 },
  section_title: { compactPx: 22, widePx: 24, fontWeight: 600, lineHeight: 1.25 },
  card_title: { compactPx: 18, widePx: 18, fontWeight: 600, lineHeight: 1.35 },
  body: { compactPx: 16, widePx: 16, fontWeight: 400, lineHeight: 1.5, minLineWidthCh: 60, maxLineWidthCh: 70 },
  metadata: { compactPx: 14, widePx: 14, fontWeight: 400, lineHeight: 1.45 },
  code: {
    compactPx: 14, widePx: 14, fontWeight: 400, lineHeight: 1.55,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
} as const;

export const CORNER_RADIUS_TOKENS = { controlPx: 12, cardPx: 16, sheetPx: 24 } as const;
export const CARD_PADDING_TOKENS = { compactPx: 20, widePx: 24 } as const;

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
  | "queued" | "running" | "validating" | "succeeded" | "failed" | "cancel_requested" | "cancelled";

export interface DeterministicStepIndicator {
  readonly status: AuthoritativeJobStatus;
  readonly stepLabel: string;
  readonly showAnimatedSpinner: boolean;
  readonly fabricatedProgressPercentage: null;
}

const STUDY_SURFACE_SET: ReadonlySet<string> = new Set(STUDY_SURFACE_KINDS);

export function resolveThemeMode(
  preference: ThemePreference = "system",
  systemColorScheme: ThemeMode = "light",
): ThemeMode {
  return preference === "light" || preference === "dark"
    ? preference
    : systemColorScheme === "dark" ? "dark" : "light";
}

export function resolveThemePalette(
  preference: ThemePreference = "system",
  systemColorScheme: ThemeMode = "light",
): ResolvedThemePalette {
  const mode = resolveThemeMode(preference, systemColorScheme);
  const colors = Object.fromEntries(
    Object.entries(UI_TOKENS.colors).map(([k, v]) => [k, v[mode]]),
  ) as Record<SemanticColorToken, string>;
  return { mode, rootColorScheme: "light dark", colors };
}

export function isStudySurfaceKind(surfaceKind: SurfaceKind): surfaceKind is StudySurfaceKind {
  return STUDY_SURFACE_SET.has(surfaceKind);
}

export function resolveSurfaceStyle(
  surfaceKind: SurfaceKind,
  preferences: AppearancePreferences = {},
  env: EnvironmentMediaPreferences = {},
): ResolvedSurfaceStyle {
  const palette = resolveThemePalette(preferences.themePreference ?? "system", env.systemColorScheme ?? "light");
  const isStudySurface = isStudySurfaceKind(surfaceKind);
  const forcedColors = env.forcedColorsActive === true;
  const reducedTransparency =
    Boolean(preferences.solidSurfaces) ||
    (UI_TOKENS.effects.system_reduction_wins && Boolean(env.prefersReducedTransparency));
  const opaque = isStudySurface || reducedTransparency || env.backdropFilterSupported === false || forcedColors;
  const backdropBlurPx = opaque ? 0 : UI_TOKENS.effects.backdrop_blur_css_px;

  return {
    surfaceKind,
    isStudySurface,
    opaque,
    opacity: opaque ? 1 : UI_TOKENS.effects.glass_opacity,
    backdropBlurPx,
    backdropFilterCss: opaque ? "none" : `blur(${backdropBlurPx}px)`,
    usesSolidFallback: opaque,
    backgroundColor: forcedColors ? "Canvas" : palette.colors.surface,
    textColor: forcedColors ? "CanvasText" : palette.colors["text-primary"],
    secondaryTextColor: forcedColors ? "CanvasText" : palette.colors["text-secondary"],
    borderColor: forcedColors ? "ButtonBorder" : palette.colors["border-control"],
    borderWidthPx: forcedColors ? 2 : 1,
    borderStyle: "solid",
    focusRing: { widthPx: 2, offsetPx: 2, style: "solid", color: forcedColors ? "Highlight" : palette.colors.accent },
    forcedColorsActive: forcedColors,
    shadowOnlyAffordanceAllowed: false,
  };
}

export function resolveMotionPolicy(
  preferences: AppearancePreferences = {},
  env: EnvironmentMediaPreferences = {},
): ResolvedMotionPolicy {
  const reducedMotion =
    (UI_TOKENS.effects.system_reduction_wins && Boolean(env.prefersReducedMotion)) ||
    Boolean(preferences.reduceMotion);
  return {
    reducedMotion,
    systemReductionWins: true,
    transitionMs: reducedMotion ? [0, 0] : UI_TOKENS.effects.transition_ms,
    transitionDurationCss: reducedMotion ? "0ms" : `${UI_TOKENS.effects.transition_ms[0]}ms`,
    sheetMaxMs: reducedMotion ? 0 : UI_TOKENS.effects.sheet_max_ms,
    allowAnimatedSpinners: !reducedMotion,
    allowDecorativeShimmer: false,
    allowAnimatedGraphLayout: !reducedMotion,
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

export function resolveDeterministicStepIndicator(
  status: AuthoritativeJobStatus,
  preferences: AppearancePreferences = {},
  env: EnvironmentMediaPreferences = {},
): DeterministicStepIndicator {
  const motion = resolveMotionPolicy(preferences, env);
  const inFlight = status === "queued" || status === "running" || status === "validating";
  return {
    status,
    stepLabel: DETERMINISTIC_JOB_LABELS[status],
    showAnimatedSpinner: inFlight && motion.allowAnimatedSpinners,
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

export function createThemeController(
  initialPreferences: AppearancePreferences = {},
  initialEnv: EnvironmentMediaPreferences = {},
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

  const getState = (): ThemeControllerState => {
    const themePreference = preferences.themePreference ?? "system";
    const sysScheme = env.systemColorScheme ?? "light";
    return {
      themePreference,
      resolvedThemeMode: resolveThemeMode(themePreference, sysScheme),
      solidSurfaces: Boolean(preferences.solidSurfaces),
      reduceMotion: Boolean(preferences.reduceMotion),
      env,
      palette: resolveThemePalette(themePreference, sysScheme),
      motionPolicy: resolveMotionPolicy(preferences, env),
      preservesLearningAndBillingState: true,
    };
  };

  return {
    getState,
    setThemePreference: (themePreference) => ((preferences = { ...preferences, themePreference }), getState()),
    setSolidSurfaces: (solidSurfaces) => ((preferences = { ...preferences, solidSurfaces }), getState()),
    setReduceMotion: (reduceMotion) => ((preferences = { ...preferences, reduceMotion }), getState()),
    setEnvironment: (nextEnv) => ((env = { ...env, ...nextEnv }), getState()),
    getSurfaceStyle: (surfaceKind) => resolveSurfaceStyle(surfaceKind, preferences, env),
    getStepIndicator: (status) => resolveDeterministicStepIndicator(status, preferences, env),
  };
}
