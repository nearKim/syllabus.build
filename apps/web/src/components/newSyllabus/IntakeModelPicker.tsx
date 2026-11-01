import type { VNode } from "preact";
import { DESIGNATED_AI_MODELS, type DesignatedAiModelOption } from "./taxonomy.ts";

export type IntakeModelOption = DesignatedAiModelOption;

export interface IntakeModelPickerProps {
  readonly designatedProviderId?: string;
  readonly designatedModelId?: string;
  readonly configuredProviderIds?: readonly string[];
}

export function filterAvailableIntakeModels(
  configuredProviderIds: readonly string[] = [],
): readonly DesignatedAiModelOption[] {
  return DESIGNATED_AI_MODELS.filter((opt) =>
    configuredProviderIds.includes(opt.providerId),
  );
}

export function IntakeModelPicker({
  designatedProviderId = "anthropic",
  designatedModelId = "claude-sonnet-4-6",
  configuredProviderIds = [],
}: IntakeModelPickerProps): VNode {
  const activeCompoundModel = `${designatedProviderId}:${designatedModelId}`;
  const availableModels = filterAvailableIntakeModels(configuredProviderIds);

  return (
    <div class="intake-model-picker" data-has-active-keys={String(availableModels.length > 0)}>
      {availableModels.length > 0 ? (
        <select
          id="intake-ai-model"
          class="intake-model-select"
          name="intake-ai-model"
          aria-label="Designated AI model for synthesis and web search"
          data-action="set-intake-ai-model"
          data-designated-provider={designatedProviderId}
          data-designated-model={designatedModelId}
        >
          {availableModels.map((opt) => {
            const compound = `${opt.providerId}:${opt.modelId}`;
            return (
              <option
                key={compound}
                value={compound}
                selected={compound === activeCompoundModel}
              >
                {opt.providerLabel} · {opt.modelLabel} · {opt.webSearchTool}
              </option>
            );
          })}
        </select>
      ) : (
        <div class="intake-no-key-row">
          <span class="row-meta">No AI API key configured</span>
          <button type="button" class="clear-filters" data-action="open-ai-settings">
            Add key in Settings →
          </button>
        </div>
      )}
    </div>
  );
}
