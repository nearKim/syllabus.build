import type { VNode } from "preact";
import {
  INTAKE_DEPTH_CHOICES,
  INTAKE_FLOW_CHOICES,
  type IntakeDepthChoice,
  type IntakeFlowChoice,
  type IntakeMaterialsChoice,
} from "./taxonomy.ts";

export interface IntakePreferencesGridProps {
  readonly depth: IntakeDepthChoice;
  readonly flowOrder: IntakeFlowChoice;
  readonly materialsAccess: IntakeMaterialsChoice;
  readonly weeklyMinutes: number;
}

export function IntakePreferencesGrid({
  depth,
  flowOrder,
  materialsAccess,
  weeklyMinutes,
}: IntakePreferencesGridProps): VNode {
  return (
    <div class="intake-controls-grid">
      <div class="intake-control-cell">
        <span class="intake-row-label">Depth</span>
        <div class="segmented" role="group" aria-label="Mathematical depth">
          {INTAKE_DEPTH_CHOICES.map((d) => (
            <button
              key={d}
              type="button"
              class="seg-btn"
              data-action="set-intake-depth"
              data-intake-depth={d}
              aria-pressed={depth === d}
            >
              {d === "intuitive" ? "Intuitive" : d === "applied" ? "Applied" : "Formal"}
            </button>
          ))}
        </div>
      </div>

      <div class="intake-control-cell">
        <span class="intake-row-label">Flow</span>
        <div class="segmented" role="group" aria-label="Study flow order">
          {INTAKE_FLOW_CHOICES.map((f) => (
            <button
              key={f}
              type="button"
              class="seg-btn"
              data-action="set-intake-flow"
              data-intake-flow={f}
              aria-pressed={flowOrder === f}
            >
              {f === "theory_first" ? "Theory" : f === "application_first" ? "Code first" : "Balanced"}
            </button>
          ))}
        </div>
      </div>

      <div class="intake-control-cell">
        <span class="intake-row-label">Materials</span>
        <div class="segmented" role="group" aria-label="Materials access">
          <button
            type="button"
            class="seg-btn"
            data-action="set-intake-materials"
            data-intake-materials="free_only"
            aria-pressed={materialsAccess === "free_only"}
          >
            Free only
          </button>
          <button
            type="button"
            class="seg-btn"
            data-action="set-intake-materials"
            data-intake-materials="paid_allowed"
            aria-pressed={materialsAccess === "paid_allowed"}
          >
            Paid allowed
          </button>
        </div>
      </div>

      <div class="intake-control-cell">
        <span class="intake-row-label">Pace</span>
        <div class="segmented" role="group" aria-label="Weekly pace presets">
          {[90, 120, 180, 240].map((mins) => (
            <button
              key={mins}
              type="button"
              class="seg-btn"
              data-action="set-intake-pace"
              data-weekly-minutes={String(mins)}
              aria-pressed={weeklyMinutes === mins}
            >
              {mins}m/wk
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
