import type { VNode } from "preact";
import { SfIcon } from "./Icons.tsx";
import {
  CHEAP_MODEL_BY_PROVIDER,
  type IntakeDepthChoice,
  type IntakeFlowChoice,
  type IntakeMaterialsChoice,
  type IntakeSubject,
  type IntakeFitMode,
} from "./newSyllabus/taxonomy.ts";
import type {
  IntakePipelineExecutionReceipt,
  IntakeResourceFitEvaluation,
} from "./newSyllabus/indexing.ts";
import { IntakeTaxonomyTree } from "./newSyllabus/IntakeTaxonomyTree.tsx";
import { IntakePreferencesGrid } from "./newSyllabus/IntakePreferencesGrid.tsx";
import { IntakeSuggestedFitTray } from "./newSyllabus/IntakeSuggestedFitTray.tsx";
import {
  IntakeModelPicker,
  filterAvailableIntakeModels,
} from "./newSyllabus/IntakeModelPicker.tsx";

// Re-exports for 100% backward compatibility
export * from "./newSyllabus/taxonomy.ts";
export * from "./newSyllabus/indexing.ts";
export * from "./newSyllabus/pipeline.ts";
export * from "./newSyllabus/PolymorphicIndexView.tsx";
export * from "./newSyllabus/IntakeTaxonomyTree.tsx";
export * from "./newSyllabus/IntakePreferencesGrid.tsx";
export * from "./newSyllabus/IntakeSuggestedFitTray.tsx";
export * from "./newSyllabus/IntakeModelPicker.tsx";

export interface NewSyllabusDialogProps {
  readonly open: boolean;
  readonly goalTitle: string;
  readonly subject: IntakeSubject;
  readonly requestedTopics: readonly string[];
  readonly depth: IntakeDepthChoice;
  readonly flowOrder: IntakeFlowChoice;
  readonly materialsAccess: IntakeMaterialsChoice;
  readonly weeklyMinutes: number;
  readonly fitMode: IntakeFitMode;
  readonly depthOverrideReset: boolean;
  readonly intakeNote: string | null;
  readonly fitEvaluation: IntakeResourceFitEvaluation;
  readonly lastPipelineReceipt: IntakePipelineExecutionReceipt | null;
  readonly designatedProviderId?: string;
  readonly designatedModelId?: string;
  readonly configuredProviderIds?: readonly string[];
}

export function NewSyllabusDialog({
  open,
  goalTitle,
  subject,
  requestedTopics,
  depth,
  flowOrder,
  materialsAccess,
  weeklyMinutes,
  fitMode,
  depthOverrideReset: _depthOverrideReset,
  intakeNote,
  fitEvaluation,
  lastPipelineReceipt,
  designatedProviderId = "openai",
  designatedModelId = CHEAP_MODEL_BY_PROVIDER.openai,
  configuredProviderIds = ["openai", "anthropic", "google_gemini"],
}: NewSyllabusDialogProps): VNode {
  const availableModels = filterAvailableIntakeModels(configuredProviderIds);
  const hasIntakeIntent = goalTitle.trim().length > 0 || requestedTopics.length > 0;

  return (
    <dialog
      id="dialog-new-syllabus"
      closedby="any"
      aria-labelledby="dialog-new-syllabus-title"
      data-open={String(open)}
      data-intake-subject={hasIntakeIntent ? subject : undefined}
      data-intake-fit-mode={fitMode}
      data-web-search-required={hasIntakeIntent ? String(fitEvaluation.webSearchRequired) : undefined}
      data-opaque-surface="true"
    >
      <form method="dialog" class="dialog-surface intake-dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-new-syllabus-title">New Syllabus</h2>
          <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
            <SfIcon name="close" />
          </button>
        </header>

        <section class="intake-compact-section" aria-label="Syllabus goal and preferences">
          <label class="field intake-goal-field" for="intake-goal">
            <span>Goal</span>
            <textarea
              id="intake-goal"
              name="goal"
              rows={2}
              autocomplete="off"
              value={goalTitle}
              placeholder="What do you want to learn?"
              autofocus
            />
          </label>

          {hasIntakeIntent ? (
            <IntakeTaxonomyTree
              subject={subject}
              requestedTopics={requestedTopics}
              fitEvaluation={fitEvaluation}
            />
          ) : null}

          <IntakePreferencesGrid
            depth={depth}
            flowOrder={flowOrder}
            materialsAccess={materialsAccess}
            weeklyMinutes={weeklyMinutes}
          />
        </section>

        {hasIntakeIntent ? (
          <IntakeSuggestedFitTray fitEvaluation={fitEvaluation} />
        ) : null}

        {intakeNote ? (
          <p class="prose intake-status-note" role="status">
            {intakeNote}
          </p>
        ) : null}

        {lastPipelineReceipt ? (
          <div class="intake-receipt-banner" role="status" data-pipeline-receipt="true">
            <strong>{lastPipelineReceipt.summaryNote}</strong>
          </div>
        ) : null}

        <footer class="dialog-footer intake-dialog-footer">
          <IntakeModelPicker
            designatedProviderId={designatedProviderId}
            designatedModelId={designatedModelId}
            configuredProviderIds={configuredProviderIds}
          />
          <button
            type="button"
            class="btn-primary"
            data-action="generate-syllabus-ai"
            disabled={availableModels.length === 0}
          >
            <SfIcon name="sparkles" size={15} />
            <span>Generate syllabus</span>
          </button>
        </footer>
      </form>
    </dialog>
  );
}
