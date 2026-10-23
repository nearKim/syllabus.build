import type { VNode } from "preact";
import {
  buildPlanMapAndOutlineModel,
  type CatalogResourceMetadataInput,
} from "../../../../packages/ui/src/index.ts";
import { formatMinorCurrency } from "../billingAndSharing.ts";
import type { ProficiencyProfileFixture } from "../diagnosticsAndAdaptation.ts";
import { goalTitleOf, type ActiveCurriculum } from "./ExploreMarketplace.tsx";
import { SfIcon, type SfIconName } from "./Icons.tsx";
import type { SourceCardView } from "./InspectorDrawer.tsx";
import { humanize, rightsWords } from "./StudyFlowBoard.tsx";

export const RESOURCE_CATEGORIES = ["All", "Course", "Book", "YouTube", "Code Lab", "Problem Set"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const RESOURCE_SCOPES = ["selected", "all"] as const;
export type ResourceScope = (typeof RESOURCE_SCOPES)[number];

export interface ResourceUsageEntry {
  readonly curriculumId: string;
  readonly curriculumTitle: string;
  readonly moduleId: string;
  readonly unitIndex: number;
  readonly unitTitle: string;
  readonly activityId: string;
  readonly activityTitle: string;
  readonly required: boolean;
}

export interface AggregatedResourceRow {
  readonly resourceVersionId: string;
  readonly title: string;
  readonly verifiedPublisher: string;
  readonly versionTimestamp: string;
  readonly canonicalUrl: string | null;
  readonly accessModel: string;
  readonly rightsBadge: SourceCardView["rightsBadge"];
  readonly optionalCertificationBadge: SourceCardView["optionalCertificationBadge"];
  readonly selectionRationale: string;
  readonly category: Exclude<ResourceCategory, "All">;
  readonly curricula: readonly { readonly curriculumId: string; readonly curriculumTitle: string; readonly domain: string }[];
  readonly usages: readonly ResourceUsageEntry[];
}

export function classifyResourceCategory(
  resourceVersionId: string,
  title: string,
  verifiedPublisher: string,
): Exclude<ResourceCategory, "All"> {
  const haystack = `${resourceVersionId} ${title} ${verifiedPublisher}`.toLowerCase();
  if (haystack.includes("youtube") || haystack.includes("video") || haystack.includes("walkthrough")) {
    return "YouTube";
  }
  if (haystack.includes("cert-prep") || haystack.includes("certification track") || haystack.includes("course:")) {
    return "Course";
  }
  if (haystack.includes("problem-set") || haystack.includes("problem set")) {
    return "Problem Set";
  }
  if (haystack.includes("-lab-") || haystack.includes("lab:") || haystack.includes("repository") || haystack.includes("eigensolver")) {
    return "Code Lab";
  }
  return "Book";
}

export function categoryIcon(category: Exclude<ResourceCategory, "All">): SfIconName {
  switch (category) {
    case "Course":
      return "course";
    case "YouTube":
      return "video";
    case "Code Lab":
      return "code";
    case "Problem Set":
      return "resources";
    case "Book":
      return "learn";
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

export function buildAggregatedResourceRows(
  plans: readonly ActiveCurriculum[],
  proficiency: ProficiencyProfileFixture,
  catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>,
): readonly AggregatedResourceRow[] {
  const byResourceId = new Map<
    string,
    {
      card: SourceCardView;
      curriculaMap: Map<string, { curriculumId: string; curriculumTitle: string; domain: string }>;
      usages: ResourceUsageEntry[];
    }
  >();

  for (const plan of plans) {
    const curriculumTitle = goalTitleOf(plan.curriculum);
    const model = buildPlanMapAndOutlineModel({
      curriculum: plan.curriculum,
      proficiency,
      activityStates: {},
      catalogResources,
      viewportWidthPx: 1280,
    });
    const unitIndexById = new Map(model.outlineModules.map((mod, idx) => [mod.moduleId, idx + 1]));
    const unitTitleById = new Map(model.outlineModules.map((mod) => [mod.moduleId, mod.title]));

    for (const act of model.outlineActivities) {
      const unitIndex = unitIndexById.get(act.moduleId) ?? 1;
      const unitTitle = unitTitleById.get(act.moduleId) ?? `Unit ${unitIndex}`;
      for (const card of act.resourceProvenanceCards) {
        let entry = byResourceId.get(card.resourceVersionId);
        if (!entry) {
          entry = {
            card,
            curriculaMap: new Map(),
            usages: [],
          };
          byResourceId.set(card.resourceVersionId, entry);
        }
        entry.curriculaMap.set(plan.curriculumId, {
          curriculumId: plan.curriculumId,
          curriculumTitle,
          domain: plan.domain,
        });
        const duplicateUsage = entry.usages.some(
          (u) => u.curriculumId === plan.curriculumId && u.activityId === act.activityId,
        );
        if (!duplicateUsage) {
          entry.usages.push({
            curriculumId: plan.curriculumId,
            curriculumTitle,
            moduleId: act.moduleId,
            unitIndex,
            unitTitle,
            activityId: act.activityId,
            activityTitle: act.title,
            required: act.required,
          });
        }
      }
    }
  }

  return Array.from(byResourceId.values()).map(({ card, curriculaMap, usages }) => ({
    resourceVersionId: card.resourceVersionId,
    title: card.title,
    verifiedPublisher: card.verifiedPublisher,
    versionTimestamp: card.versionTimestamp,
    canonicalUrl: card.canonicalUrl,
    accessModel: card.accessModel,
    rightsBadge: card.rightsBadge,
    optionalCertificationBadge: card.optionalCertificationBadge,
    selectionRationale: card.selectionRationale,
    category: classifyResourceCategory(card.resourceVersionId, card.title, card.verifiedPublisher),
    curricula: Array.from(curriculaMap.values()),
    usages,
  }));
}

export interface ResourcesViewProps {
  readonly active: boolean;
  readonly selectedPlan: ActiveCurriculum;
  readonly allPlans: readonly ActiveCurriculum[];
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly resourceScope: ResourceScope;
  readonly resourceCategory: ResourceCategory;
}

export function ResourcesView({
  active,
  selectedPlan,
  allPlans,
  proficiency,
  catalogResources,
  resourceScope,
  resourceCategory,
}: ResourcesViewProps): VNode {
  const scopedPlans = resourceScope === "all" ? allPlans : [selectedPlan];
  const allScopedRows = buildAggregatedResourceRows(scopedPlans, proficiency, catalogResources);
  const filteredRows =
    resourceCategory === "All"
      ? allScopedRows
      : allScopedRows.filter((row) => row.category === resourceCategory);

  const countForCategory = (cat: ResourceCategory): number =>
    cat === "All" ? allScopedRows.length : allScopedRows.filter((row) => row.category === cat).length;

  const selectedCurriculumTitle = goalTitleOf(selectedPlan.curriculum);
  const selectValue = resourceScope === "all" ? "all" : selectedPlan.curriculumId;

  return (
    <section
      class="learn-sub-panel"
      id="panel-learn-resources"
      data-learn-panel="Resources"
      data-active={String(active)}
      data-resource-scope={resourceScope}
      data-resource-category={resourceCategory}
      hidden={!active}
    >
      <div class="section-header">
        <h1 class="page-title">Resources</h1>
        <div class="plan-toolbar">
          <div class="segmented" role="group" aria-label="Resource curriculum scope">
            <button
              type="button"
              class="seg-btn"
              data-action="set-resource-scope"
              data-resource-scope="selected"
              aria-pressed={resourceScope === "selected"}
            >
              Current curriculum
            </button>
            <button
              type="button"
              class="seg-btn"
              data-action="set-resource-scope"
              data-resource-scope="all"
              aria-pressed={resourceScope === "all"}
            >
              All curricula ({allPlans.length})
            </button>
          </div>
          <label class="field field-inline" for="resources-curriculum-control">
            <span class="st-sr">Curriculum</span>
            <select
              id="resources-curriculum-control"
              name="resources-curriculum"
              data-action="select-curriculum"
            >
              <option value="all" selected={selectValue === "all"}>
                All active curricula ({allPlans.length})
              </option>
              {allPlans.map((plan) => (
                <option
                  key={plan.curriculumId}
                  value={plan.curriculumId}
                  selected={selectValue === plan.curriculumId}
                >
                  {goalTitleOf(plan.curriculum)}
                  {plan.draft ? " · Draft" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <section class="surface-panel resources-library-panel" data-opaque-surface="true">
        <div class="resources-toolbar-row">
          <div class="segmented resources-category-bar" role="group" aria-label="Filter resources by category">
            {RESOURCE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                class="seg-btn resource-category-pill"
                data-action="set-resource-category"
                data-resource-category={cat}
                aria-pressed={resourceCategory === cat}
              >
                {cat !== "All" ? <SfIcon name={categoryIcon(cat)} size={15} /> : null}
                <span>
                  {cat} ({countForCategory(cat)})
                </span>
              </button>
            ))}
          </div>
          <p class="resources-count meta-text">
            {filteredRows.length} of {allScopedRows.length}
          </p>
        </div>

        {filteredRows.length === 0 ? (
          <p class="empty-state">
            <SfIcon name="resources" />
            <span>No {resourceCategory} resources.</span>
          </p>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="resources-table-caption"
            class="table-wrapper resources-table-wrapper"
            data-opaque-surface="true"
          >
            <table class="resources-data-table">
              <caption id="resources-table-caption" class="st-sr">
                {resourceScope === "all"
                  ? `Curated resources across all ${allPlans.length} curricula`
                  : `Curated resources for ${selectedCurriculumTitle}`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Resource</th>
                  <th scope="col">Type</th>
                  <th scope="col">Units</th>
                  <th scope="col">Access</th>
                  <th scope="col"><span class="st-sr">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const certBadge = row.optionalCertificationBadge ? (
                    <span class="badge badge-cert-cost" data-optional-certification="true">
                      Optional certification {formatMinorCurrency(4900, "USD")}
                    </span>
                  ) : (
                    <span class="badge badge-cert-none">Core access {formatMinorCurrency(0, "USD")}</span>
                  );

                  return (
                    <tr
                      key={row.resourceVersionId}
                      class="resource-catalog-card resource-table-row"
                      data-resource-version-id={row.resourceVersionId}
                      data-resource-category={row.category}
                      data-opaque-surface="true"
                    >
                      <th scope="row" class="resource-primary-cell">
                        <div class="resource-main">
                          <h3 class="resource-row-title">{row.title}</h3>
                          <p class="meta-text">
                            {row.verifiedPublisher} · Version captured{" "}
                            <time dateTime={row.versionTimestamp}>{formatDate(row.versionTimestamp)}</time>
                          </p>
                          <p class="prose resource-row-rationale">{row.selectionRationale}</p>
                        </div>
                      </th>
                      <td class="resource-category-cell">
                        <div class="resource-category-stack">
                          <span class="badge resource-category-badge" data-category={row.category}>
                            <SfIcon name={categoryIcon(row.category)} size={15} />
                            <span>{row.category}</span>
                          </span>
                          {row.curricula.map((curr) => (
                            <span
                              key={curr.curriculumId}
                              class="domain-pill resource-curriculum-pill"
                              data-curriculum-id={curr.curriculumId}
                            >
                              {curr.curriculumTitle}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td class="resource-usage-cell">
                        <ul class="resource-usage-list" aria-label={`Activities using ${row.title}`}>
                          {row.usages.map((usage) => (
                            <li key={`${usage.curriculumId}-${usage.activityId}`}>
                              <button
                                type="button"
                                class="resource-usage-chip"
                                data-action="resume-curriculum"
                                data-curriculum-id={usage.curriculumId}
                                data-activity-id={usage.activityId}
                                data-module-id={usage.moduleId}
                              >
                                <span class="badge">U{usage.unitIndex}</span>
                                <span class="resource-usage-title">{usage.activityTitle}</span>
                                <span aria-hidden="true">→</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td class="resource-access-cell">
                        <div class="resource-main">
                          <p class="badge-row">
                            <span class="badge badge-rights" data-rights-basis={row.rightsBadge.basis}>
                              {rightsWords(row.rightsBadge)}
                            </span>
                            <span class="badge">{humanize(row.accessModel)} access</span>
                            {certBadge}
                          </p>
                          {row.optionalCertificationBadge ? (
                            <p class="prose warning-copy">
                              {row.optionalCertificationBadge.label}. Separate optional cost{" "}
                              {formatMinorCurrency(4900, "USD")}. Opening the source does not mark the activity complete.
                            </p>
                          ) : (
                            <p class="prose meta-text">
                              No paid certification is required for core access ({formatMinorCurrency(0, "USD")}).
                              Opening the source does not mark the activity complete.
                            </p>
                          )}
                        </div>
                      </td>
                      <td class="resource-action-cell">
                        {row.canonicalUrl ? (
                          <a
                            href={row.canonicalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="btn-secondary"
                          >
                            Open source
                            <span aria-hidden="true">↗</span>
                            <span class="st-sr"> in a new tab</span>
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
