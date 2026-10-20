/**
 * Canonical Navigation Hierarchy (`Section 9.3`) & Web Shell Entry Point (`T00`).
 *
 * Top-level destinations:
 * - `Learn` -> (`Today`, `Plan` [synchronized `Map` + `Outline`], `Progress`, `Resources`)
 * - `Explore`
 * - `Settings`
 */

import { evaluateSafeCurriculumRender, UI_TOKENS } from "@curriculum/ui";
import { CANONICAL_SPEC_SHA256, OPENAPI_OPERATIONS } from "@curriculum/api-client";

export const TOP_LEVEL_DESTINATIONS = ["Learn", "Explore", "Settings"] as const;
export type TopLevelDestination = (typeof TOP_LEVEL_DESTINATIONS)[number];

export const LEARN_SUB_DESTINATIONS = ["Today", "Plan", "Progress", "Resources"] as const;
export type LearnSubDestination = (typeof LEARN_SUB_DESTINATIONS)[number];

export const PLAN_SYNCHRONIZED_VIEWS = ["Map", "Outline"] as const;
export type PlanSynchronizedView = (typeof PLAN_SYNCHRONIZED_VIEWS)[number];

export interface WebShellBootstrapSummary {
  readonly specSha256: string;
  readonly topLevelDestinations: readonly TopLevelDestination[];
  readonly learnSubDestinations: readonly LearnSubDestination[];
  readonly planSynchronizedViews: readonly PlanSynchronizedView[];
  readonly operationCount: number;
  readonly lightCanvasColor: string;
}

export function getWebShellBootstrapSummary(): WebShellBootstrapSummary {
  return {
    specSha256: CANONICAL_SPEC_SHA256,
    topLevelDestinations: TOP_LEVEL_DESTINATIONS,
    learnSubDestinations: LEARN_SUB_DESTINATIONS,
    planSynchronizedViews: PLAN_SYNCHRONIZED_VIEWS,
    operationCount: Object.keys(OPENAPI_OPERATIONS).length,
    lightCanvasColor: UI_TOKENS.colors.canvas.light,
  };
}

export { evaluateSafeCurriculumRender };
