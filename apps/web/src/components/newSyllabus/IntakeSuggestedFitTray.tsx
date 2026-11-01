import type { VNode } from "preact";
import { SfIcon } from "../Icons.tsx";
import { categoryIcon } from "../ResourcesView.tsx";
import { subjectIcon } from "./taxonomy.ts";
import { renderPolymorphicIndexDetails } from "./PolymorphicIndexView.tsx";
import type { IntakeResourceFitEvaluation } from "./indexing.ts";

export interface IntakeSuggestedFitTrayProps {
  readonly fitEvaluation: IntakeResourceFitEvaluation;
}

export function IntakeSuggestedFitTray({
  fitEvaluation,
}: IntakeSuggestedFitTrayProps): VNode {
  return (
    <section
      class="intake-fit-tray"
      id="intake-suggested-fit-tray"
      aria-labelledby="intake-fit-heading"
      data-opaque-surface="true"
    >
      <div class="intake-section-head">
        <div class="intake-section-title-group">
          <h3 id="intake-fit-heading">Suggested fit</h3>
          <p
            class="intake-bypass-badge"
            role="status"
            data-search-bypass-status={fitEvaluation.costAndBypassBadge}
          >
            <SfIcon name={fitEvaluation.webSearchRequired ? "globe" : "check"} size={15} />
            <span>{fitEvaluation.costAndBypassBadge}</span>
          </p>
        </div>
      </div>

      {fitEvaluation.existingPlans.length > 0 ? (
        <div class="intake-fit-group intake-existing-plans-block">
          <h4 class="intake-fit-group-title">Existing syllabi ({fitEvaluation.existingPlans.length})</h4>
          <ul class="intake-fit-list intake-existing-plans-list">
            {fitEvaluation.existingPlans.map((plan) => (
              <li
                key={plan.id}
                class="intake-fit-card intake-existing-plan-card"
                data-fit-plan-id={plan.id}
              >
                <div class="intake-existing-plan-main">
                  <span class="intake-plan-icon" data-subject={plan.subject} aria-hidden="true">
                    <SfIcon name={subjectIcon(plan.subject)} size={16} />
                  </span>
                  <div class="intake-existing-plan-inner">
                    <strong class="intake-plan-title">{plan.title}</strong>
                    <p class="meta-text">
                      {plan.kind === "my_plan" ? "Your plan" : "Community"} · {plan.subject} ·{" "}
                      {plan.matchedTopics.length}/{plan.totalRequestedTopics} topics matched
                    </p>
                  </div>
                </div>
                <div class="intake-existing-plan-actions">
                  {plan.kind === "my_plan" && plan.syllabusId ? (
                    <button
                      type="button"
                      class="btn-secondary intake-open-plan-btn"
                      data-action="intake-open-existing-plan"
                      data-syllabus-id={plan.syllabusId}
                    >
                      Open plan →
                    </button>
                  ) : plan.publicationId ? (
                    <button
                      type="button"
                      class="btn-secondary intake-open-plan-btn"
                      data-action="intake-adopt-marketplace-plan"
                      data-publication-id={plan.publicationId}
                    >
                      Use plan →
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div class="intake-fit-group intake-materials-block">
        <h4 class="intake-fit-group-title">Materials ({fitEvaluation.indexedMaterials.length})</h4>
        <ul class="intake-fit-list intake-materials-list">
          {fitEvaluation.indexedMaterials.map((mat) => {
            const isUsed = fitEvaluation.selectedResourceIds.includes(mat.resourceVersionId);
            const isSkipped = fitEvaluation.skippedResourceIds.includes(mat.resourceVersionId);
            return (
              <li
                key={mat.resourceVersionId}
                class={`intake-fit-card intake-material-card intake-material-row${isUsed ? " is-used" : ""}${isSkipped ? " is-skipped" : ""}`}
                data-fit-resource-id={mat.resourceVersionId}
                data-fit-resource-source={mat.source ?? "indexed"}
                data-fit-resource-used={String(isUsed)}
                data-fit-resource-skipped={String(isSkipped)}
                data-match-score={mat.matchScore?.toFixed(2)}
              >
                <div class="intake-material-badge-col">
                  <span class="resource-category-badge" data-category={mat.category}>
                    <SfIcon name={categoryIcon(mat.category)} size={15} />
                    <span>{mat.category}</span>
                  </span>
                </div>
                <div class="intake-material-content-col">
                  <div class="intake-material-inner">
                    <strong class="intake-material-title">{mat.title}</strong>
                    <p class="meta-text">
                      {[mat.publisher, mat.coveredTopics.join(", ")].filter(Boolean).join(" · ")}
                      {mat.matchScore ? ` · ${mat.matchScore.toFixed(2)} match` : ""}
                    </p>
                    {renderPolymorphicIndexDetails(mat.polymorphicIndex)}
                  </div>
                  <div class="intake-material-actions">
                    <button
                      type="button"
                      class={`intake-material-check${isUsed ? " is-checked" : ""}`}
                      data-action="toggle-intake-resource"
                      data-resource-id={mat.resourceVersionId}
                      aria-pressed={isUsed}
                      aria-label={`${isUsed ? "Exclude" : "Include"} ${mat.title}`}
                    >
                      <span class="intake-material-check-ring" aria-hidden="true">
                        {isUsed ? <SfIcon name="check" size={15} /> : null}
                      </span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
