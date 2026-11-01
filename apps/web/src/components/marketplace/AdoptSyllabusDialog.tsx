import type { VNode } from "preact";
import {
  buildPlanMapAndOutlineModel,
  type CatalogResourceMetadataInput,
} from "@syllabus/ui";
import type { ProficiencyProfileFixture } from "../../diagnosticsAndAdaptation.ts";
import { SfIcon } from "../Icons.tsx";
import { MathText } from "../MathText.tsx";
import {
  displayUnitTitle,
  effortWords,
  humanize,
  type StudyActivity,
} from "../StudyFlowBoard.tsx";
import {
  SUBJECT_ICONS,
  tagLabelOf,
  type Adoption,
  type MarketplaceListing,
} from "./types.ts";
import {
  adoptionScopeOf,
  difficultyTagOf,
  formatTagOf,
  publicProjectionOf,
} from "./filterEngine.ts";

export interface AdoptSyllabusDialogProps {
  readonly open: boolean;
  readonly adoptListing: MarketplaceListing | null;
  readonly adoptModuleIds: readonly string[];
  readonly adoptions: readonly Adoption[];
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
}

// An activity's kind in a learner's words. A coding activity is a code lab.
const activityKindOf = (activity: StudyActivity): string =>
  activity.type === "coding" ? "Code lab" : humanize(activity.type);

const requirementOf = (activity: StudyActivity): "gate" | "required" | "optional" =>
  activity.masteryGated ? "gate" : activity.required ? "required" : "optional";

const REQUIREMENT_LABELS = { gate: "Mastery gate", required: "Required", optional: "Optional" } as const;

export function AdoptSyllabusDialog({
  open,
  adoptListing,
  adoptModuleIds,
  adoptions,
  proficiency,
  catalogResources,
}: AdoptSyllabusDialogProps): VNode {
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;

  return (
    <dialog
      id="dialog-partial-adoption"
      closedby="any"
      aria-labelledby="dialog-partial-adoption-title"
      data-open={String(open)}
      data-opaque-surface="true"
    >
      <form method="dialog" class="dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-partial-adoption-title">Details</h2>
          <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
            <SfIcon name="close" />
          </button>
        </header>
        {!adoptListing ? (
          <p class="meta-text">Choose a syllabus in Explore to preview it.</p>
        ) : (
          (() => {
            const projection = publicProjectionOf(adoptListing.syllabus);
            // The resolver reads an empty selection as the whole syllabus, so an empty selection adopts nothing here.
            const scope = adoptModuleIds.length > 0 ? adoptionScopeOf(adoptListing, adoptModuleIds) : null;
            const included = new Set(scope?.resolvedModuleIds ?? []);
            const autoIncluded = new Set(scope?.autoIncludedPrerequisiteModuleIds ?? []);
            const model = buildPlanMapAndOutlineModel({
              syllabus: adoptListing.syllabus,
              proficiency,
              activityStates: {},
              catalogResources,
            });
            const { goal, outlineModules: outline } = model;
            const unitNumber = new Map(projection.modules.map((mod, index) => [mod.module_id, index + 1]));
            const chosen = outline.filter((mod) => included.has(mod.moduleId));
            const total = { min: 0, point: 0, max: 0 };
            for (const mod of chosen) {
              total.min += mod.durationTriplet.min;
              total.point += mod.durationTriplet.point;
              total.max += mod.durationTriplet.max;
            }
            const difficulty = difficultyTagOf(adoptListing);
            const format = formatTagOf(adoptListing);
            const units = projection.modules.length;
            return (
              <>
                <section class="adopt-overview" aria-labelledby="adopt-title">
                  <p class="marketplace-card-head">
                    <span class="marketplace-card-icon" data-subject={adoptListing.subject} aria-hidden="true">
                      <SfIcon name={SUBJECT_ICONS[adoptListing.subject] ?? "course"} />
                    </span>
                    <span class="tag">{tagLabelOf(adoptListing.subject)}</span>
                    {difficulty ? <span class="tag">{difficulty}</span> : null}
                    {format ? <span class="tag">{format}</span> : null}
                  </p>
                  <h3 id="adopt-title" class="adopt-title">
                    {projection.title}
                  </h3>
                  <p class="meta-text">
                    {adoptListing.handle} · {units} unit{units === 1 ? "" : "s"} · {effortWords(model.totalDurationTriplet)} · {adoptionsOf(adoptListing)} adopted · CC BY 4.0
                  </p>
                  {projection.summary ? <p class="prose adopt-summary">{projection.summary}</p> : null}
                  {goal.includedTopics.length + goal.excludedTopics.length > 0 ? (
                    <dl class="adopt-coverage">
                      {goal.includedTopics.length > 0 ? (
                        <div>
                          <dt>Covers</dt>
                          <dd>
                            {goal.includedTopics.map((topic) => (
                              <span key={topic} class="badge">
                                {topic}
                              </span>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                      {goal.excludedTopics.length > 0 ? (
                        <div>
                          <dt>Not covered</dt>
                          <dd>{goal.excludedTopics.join(", ")}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  {goal.scopeNote ? <p class="meta-text">{goal.scopeNote}</p> : null}
                </section>
                <section aria-labelledby="adopt-units-title">
                  <div class="adopt-units-head">
                    <h3 id="adopt-units-title">Units</h3>
                    <button
                      type="button"
                      class="select-all-btn"
                      data-action="select-all-adopt-modules"
                      disabled={included.size === units}
                    >
                      Select all
                    </button>
                  </div>
                  <ol class="adopt-units">
                    {projection.modules.map((mod, index) => {
                      const number = index + 1;
                      const unit = outline.find((entry) => entry.moduleId === mod.module_id);
                      const needs = (mod.prerequisite_module_ids ?? [])
                        .map((moduleId) => `U${unitNumber.get(moduleId) ?? "?"}`)
                        .join(", ");
                      return (
                        <li key={mod.module_id} class="adopt-unit" data-included={String(included.has(mod.module_id))}>
                          <button
                            type="button"
                            class="adopt-unit-toggle"
                            role="checkbox"
                            aria-checked={included.has(mod.module_id)}
                            data-action="toggle-adopt-module"
                            data-module-id={mod.module_id}
                          >
                            <span class="adopt-check" aria-hidden="true">
                              <SfIcon name="check" size={15} />
                            </span>
                            <span class="adopt-unit-text">
                              <span class="adopt-unit-title">
                                U{number} · {displayUnitTitle(mod.title)}
                              </span>
                              <span class="adopt-unit-meta">
                                {unit ? <span>{effortWords(unit.durationTriplet)}</span> : null}
                                {needs ? <span class="requires-badge">Requires {needs}</span> : null}
                                {autoIncluded.has(mod.module_id) ? (
                                  <span class="auto-badge">Auto-included prerequisite</span>
                                ) : null}
                              </span>
                            </span>
                          </button>
                          {unit?.summary ? (
                            <p class="adopt-unit-summary">
                              <MathText text={unit.summary} />
                            </p>
                          ) : null}
                          {unit && unit.activities.length > 0 ? (
                            <ol class="adopt-activities" aria-label={`Unit ${number} activities`}>
                              {unit.activities.map((activity, step) => {
                                const requirement = requirementOf(activity);
                                return (
                                    <li key={activity.activityId} class="adopt-activity">
                                    <span class="adopt-step">
                                      {number}.{step + 1}
                                    </span>
                                    <div class="adopt-activity-body">
                                      <p class="adopt-activity-title">
                                        <MathText text={activity.title} />
                                      </p>
                                      <p class="adopt-activity-meta">
                                        {activityKindOf(activity)} ·{" "}
                                        <span class="adopt-requirement" data-requirement={requirement}>
                                          {REQUIREMENT_LABELS[requirement]}
                                        </span>
                                      </p>
                                      {activity.resourceProvenanceCards.length > 0 ? (
                                        <ul class="adopt-resources" aria-label="Study resources">
                                          {activity.resourceProvenanceCards.map((card, cardIndex) => (
                                            <li key={`${card.resourceVersionId}-${cardIndex}`}>
                                              <SfIcon name="resources" size={15} />
                                              <span>
                                                {card.canonicalUrl ? (
                                                  <a href={card.canonicalUrl} target="_blank" rel="noopener noreferrer">
                                                    {card.title}
                                                    <span class="st-sr"> (opens in a new tab)</span>
                                                  </a>
                                                ) : (
                                                  card.title
                                                )}
                                                <span class="adopt-publisher">
                                                  {card.verifiedPublisher} <span class="badge">{humanize(card.accessModel)} access</span>
                                                </span>
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      ) : null}
                                    </div>
                                    <span class="adopt-minutes">{activity.durationTriplet.point} min</span>
                                  </li>
                                );
                              })}
                            </ol>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </section>
                <p class="prose meta-text adopt-terms">
                  Adoption creates your private draft. It copies none of the author's progress, evidence, votes, keys, or spending authority, and it costs $0.00. You review the draft on the Plan page and activate it there.
                </p>
                <footer class="dialog-footer">
                  <p class="adopt-total">
                    {scope ? `${included.size} of ${units} units · ${effortWords(total)}` : "Select at least one unit."}
                  </p>
                  <button
                    type="button"
                    class="btn-primary"
                    data-action="confirm-adopt-syllabus"
                    data-publication-id={adoptListing.publicationId}
                    disabled={!scope}
                  >
                    Adopt into My Plans
                    <span aria-hidden="true">→</span>
                  </button>
                </footer>
              </>
            );
          })()
        )}
      </form>
    </dialog>
  );
}
