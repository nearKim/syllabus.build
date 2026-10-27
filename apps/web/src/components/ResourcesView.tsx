import type { VNode } from "preact";
import {
  buildPlanMapAndOutlineModel,
  type CatalogResourceMetadataInput,
} from "../../../../packages/ui/src/index.ts";
import { formatMinorCurrency } from "../billingAndSharing.ts";
import catalogResourcesJson from "../data/catalogResources.json" with { type: "json" };
import type { ProficiencyProfileFixture } from "../diagnosticsAndAdaptation.ts";
import { goalTitleOf, type ActiveCurriculum } from "./ExploreMarketplace.tsx";
import { SfIcon, type SfIconName } from "./Icons.tsx";
import type { SourceCardView } from "./InspectorDrawer.tsx";
import { MathText } from "./MathText.tsx";
import { rightsWords } from "./StudyFlowBoard.tsx";

export const RESOURCE_CATEGORIES = ["All", "Course", "Book", "YouTube", "Code Lab", "Problem Set"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const RESOURCE_SCOPES = ["selected", "all"] as const;
export type ResourceScope = (typeof RESOURCE_SCOPES)[number];

export interface StructuredResourceAccessJson {
  readonly model: string;
  readonly tier_label: string;
  readonly cost_label: string;
  readonly rights_label: string;
  readonly certificate_included: boolean;
  readonly optional_certificate_price_minor: number | null;
}

export interface ResourceUsageEntry {
  readonly curriculumId: string;
  readonly curriculumTitle: string;
  readonly moduleId: string;
  readonly unitIndex: number;
  readonly unitTitle: string;
  readonly activityId: string;
  readonly activityTitle: string;
  readonly required: boolean;
  readonly sourceUrl: string | null;
}

export interface AggregatedResourceRow {
  readonly resourceVersionId: string;
  readonly title: string;
  readonly verifiedPublisher: string;
  readonly versionTimestamp: string;
  readonly canonicalUrl: string | null;
  readonly accessModel: string;
  readonly accessJson: StructuredResourceAccessJson;
  readonly rightsBadge: SourceCardView["rightsBadge"];
  readonly optionalCertificationBadge: SourceCardView["optionalCertificationBadge"];
  readonly selectionRationale: string;
  readonly category: Exclude<ResourceCategory, "All">;
  readonly segments: readonly { readonly segment_id: string; readonly title: string }[];
  readonly curricula: readonly { readonly curriculumId: string; readonly curriculumTitle: string; readonly domain: string }[];
  readonly usages: readonly ResourceUsageEntry[];
}

const CANONICAL_JSON_BY_ID: Readonly<Record<string, CatalogResourceMetadataInput>> = {
  ...(catalogResourcesJson.resources as Readonly<Record<string, CatalogResourceMetadataInput>>),
  ...(catalogResourcesJson.global_discovered_resources as Readonly<Record<string, CatalogResourceMetadataInput>>),
};

export function resolveStructuredAccessJson(
  resourceVersionId: string,
  catalogEntry: CatalogResourceMetadataInput | undefined,
  fallbackAccessModel: string,
  rightsBadge: SourceCardView["rightsBadge"],
  optionalCertificationBadge: SourceCardView["optionalCertificationBadge"],
): StructuredResourceAccessJson {
  const jsonEntry = CANONICAL_JSON_BY_ID[resourceVersionId];
  const rawAccess = catalogEntry?.access ?? jsonEntry?.access;
  const model = rawAccess?.model ?? fallbackAccessModel ?? "free";
  const certIncluded = Boolean(rawAccess?.certificate_included ?? optionalCertificationBadge?.included);
  const certMinor =
    typeof rawAccess?.optional_certificate_price_minor === "number"
      ? rawAccess.optional_certificate_price_minor
      : certIncluded
        ? 4900
        : null;

  const tier_label =
    rawAccess?.tier_label ??
    (model === "freemium_optional_certificate"
      ? "Freemium"
      : model === "library_loan"
        ? "Library Loan"
        : model === "paid"
          ? "Paid"
          : "Free");

  const cost_label =
    rawAccess?.cost_label ??
    (certIncluded && certMinor !== null
      ? `Core ${formatMinorCurrency(0, "USD")} · Cert ${formatMinorCurrency(certMinor, "USD")}`
      : model === "library_loan"
        ? "Institutional / Loan"
        : "$0");

  const rights_label = rawAccess?.rights_label ?? rightsWords(rightsBadge);

  return {
    model,
    tier_label,
    cost_label,
    rights_label,
    certificate_included: certIncluded,
    optional_certificate_price_minor: certMinor,
  };
}

export function classifyResourceCategory(
  resourceVersionId: string,
  title: string,
  verifiedPublisher: string,
  explicitCategory?: string | undefined,
): Exclude<ResourceCategory, "All"> {
  if (
    explicitCategory === "Course" ||
    explicitCategory === "Book" ||
    explicitCategory === "YouTube" ||
    explicitCategory === "Code Lab" ||
    explicitCategory === "Problem Set"
  ) {
    return explicitCategory;
  }
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

export function formatResourceDate(iso: string): string {
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
          const rawEntryForUrl =
            catalogResources[card.resourceVersionId] ?? CANONICAL_JSON_BY_ID[card.resourceVersionId];
          const baseUrl = card.canonicalUrl ?? rawEntryForUrl?.canonical_url ?? null;
          const primarySegmentId = card.verifiedSegments[0] ?? null;
          const sourceUrl = baseUrl
            ? primarySegmentId && !baseUrl.includes("#")
              ? `${baseUrl}#${primarySegmentId}`
              : baseUrl
            : null;
          entry.usages.push({
            curriculumId: plan.curriculumId,
            curriculumTitle,
            moduleId: act.moduleId,
            unitIndex,
            unitTitle,
            activityId: act.activityId,
            activityTitle: act.title,
            required: act.required,
            sourceUrl,
          });
        }
      }
    }
  }

  return Array.from(byResourceId.values()).map(({ card, curriculaMap, usages }) => {
    const rawEntry = catalogResources[card.resourceVersionId] ?? CANONICAL_JSON_BY_ID[card.resourceVersionId];
    const accessJson = resolveStructuredAccessJson(
      card.resourceVersionId,
      rawEntry,
      card.accessModel,
      card.rightsBadge,
      card.optionalCertificationBadge,
    );
    const rawSegments = rawEntry?.segments ?? [];
    const segments = rawSegments
      .filter((s): s is { readonly segment_id: string; readonly title: string } => Boolean(s.segment_id && s.title))
      .map((s) => ({ segment_id: s.segment_id, title: s.title }));

    return {
      resourceVersionId: card.resourceVersionId,
      title: card.title,
      verifiedPublisher: card.verifiedPublisher,
      versionTimestamp: card.versionTimestamp,
      canonicalUrl: card.canonicalUrl,
      accessModel: card.accessModel,
      accessJson,
      rightsBadge: card.rightsBadge,
      optionalCertificationBadge: card.optionalCertificationBadge,
      selectionRationale: card.selectionRationale,
      category: classifyResourceCategory(
        card.resourceVersionId,
        card.title,
        card.verifiedPublisher,
        rawEntry?.category,
      ),
      segments,
      curricula: Array.from(curriculaMap.values()),
      usages,
    };
  });
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
        <div class="page-heading-group">
          <h1 class="page-title">Resources</h1>
          <p class="page-description">
            {resourceScope === "all"
              ? `All study materials linked across your ${allPlans.length} personal curricula.`
              : `Study materials linked to ${selectedCurriculumTitle}.`}
          </p>
        </div>
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

      <section class="resources-library-panel" aria-labelledby="resources-library-heading" data-opaque-surface="true">
        <h2 id="resources-library-heading" class="st-sr">Resource catalog</h2>
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
                  <th scope="col">Type</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Units</th>
                  <th scope="col">Access</th>
                  <th scope="col"><span class="st-sr">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const accessTone =
                    row.accessJson.model === "free"
                      ? "active"
                      : row.accessJson.model === "freemium_optional_certificate"
                        ? "standby"
                        : "public";

                  return (
                    <tr
                      key={row.resourceVersionId}
                      class="resource-catalog-card resource-table-row"
                      data-resource-version-id={row.resourceVersionId}
                      data-resource-category={row.category}
                      data-access-model={row.accessJson.model}
                      data-opaque-surface="true"
                    >
                      <td class="resource-category-cell">
                        <span class="resource-category-badge" data-category={row.category}>
                          <SfIcon name={categoryIcon(row.category)} size={15} />
                          <span>{row.category}</span>
                        </span>
                      </td>
                      <th scope="row" class="resource-primary-cell">
                        <div class="resource-main">
                          <h3 class="resource-row-title">{row.title}</h3>
                          <p class="meta-text">
                            {row.verifiedPublisher} ·{" "}
                            <time dateTime={row.versionTimestamp}>{formatResourceDate(row.versionTimestamp)}</time>
                          </p>
                          <p class="prose resource-row-rationale">
                            <MathText text={row.selectionRationale} />
                          </p>
                          {row.segments.length > 0 ? (
                            <ul class="resource-segments-inline" aria-label="Verified syllabus segments">
                              {row.segments.map((seg) => (
                                <li key={seg.segment_id} class="resource-segment-item">
                                  <MathText text={seg.title} />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </th>
                      <td class="resource-usage-cell">
                        <ul class="resource-usage-list" aria-label={`Units using ${row.title}`}>
                          {row.usages.map((usage) => {
                            const href = usage.sourceUrl ?? row.canonicalUrl;
                            return (
                              <li key={`${usage.curriculumId}-${usage.activityId}`}>
                                {href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="resource-usage-chip"
                                    data-curriculum-id={usage.curriculumId}
                                    data-activity-id={usage.activityId}
                                    data-module-id={usage.moduleId}
                                  >
                                    <span class="resource-usage-unit">U{usage.unitIndex}</span>
                                    <span class="resource-usage-title">
                                      <MathText text={usage.activityTitle} />
                                    </span>
                                    <span aria-hidden="true">↗</span>
                                  </a>
                                ) : (
                                  <span
                                    class="resource-usage-chip"
                                    data-curriculum-id={usage.curriculumId}
                                    data-activity-id={usage.activityId}
                                    data-module-id={usage.moduleId}
                                  >
                                    <span class="resource-usage-unit">U{usage.unitIndex}</span>
                                    <span class="resource-usage-title">
                                      <MathText text={usage.activityTitle} />
                                    </span>
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td class="resource-access-cell">
                        <div
                          class="resource-access-stack"
                          data-rights-basis={row.rightsBadge.basis}
                          data-optional-certification={row.accessJson.certificate_included ? "true" : undefined}
                          data-tier={row.accessJson.tier_label}
                          data-cost={row.accessJson.cost_label}
                          data-rights={row.accessJson.rights_label}
                        >
                          <div class="resource-access-primary">
                            <span class="status-dot" data-status={accessTone} aria-hidden="true" />
                            <span class="resource-access-tier">{row.accessJson.tier_label}</span>
                            <span class="resource-access-sep" aria-hidden="true">·</span>
                            <code class="resource-access-cost">{row.accessJson.cost_label}</code>
                          </div>
                          <span class="row-meta resource-access-rights">{row.accessJson.rights_label}</span>
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
                            Open
                            <span aria-hidden="true">↗</span>
                            <span class="st-sr"> {row.title} in a new tab</span>
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
