import type { VNode } from "preact";
import {
  buildPlanMapAndOutlineModel,
  type CatalogResourceMetadataInput,
} from "../../../../packages/ui/src/index.ts";
import { formatMinorCurrency } from "../billingAndSharing.ts";
import catalogResourcesJson from "../data/catalogResources.json" with { type: "json" };
import type { ProficiencyProfileFixture } from "../diagnosticsAndAdaptation.ts";
import { goalTitleOf, type ActiveSyllabus } from "./ExploreMarketplace.tsx";
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
  readonly syllabusId: string;
  readonly syllabusTitle: string;
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
  readonly syllabi: readonly { readonly syllabusId: string; readonly syllabusTitle: string; readonly domain: string }[];
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
  plans: readonly ActiveSyllabus[],
  proficiency: ProficiencyProfileFixture,
  catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>,
  extraLibraryIds: readonly string[] = [],
  removedIds: readonly string[] = [],
): readonly AggregatedResourceRow[] {
  const removedSet = new Set(removedIds);
  const byResourceId = new Map<
    string,
    {
      card: SourceCardView;
      syllabiMap: Map<string, { syllabusId: string; syllabusTitle: string; domain: string }>;
      usages: ResourceUsageEntry[];
    }
  >();

  for (const plan of plans) {
    const syllabusTitle = goalTitleOf(plan.syllabus);
    const model = buildPlanMapAndOutlineModel({
      syllabus: plan.syllabus,
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
        if (removedSet.has(card.resourceVersionId)) continue;
        let entry = byResourceId.get(card.resourceVersionId);
        if (!entry) {
          entry = {
            card,
            syllabiMap: new Map(),
            usages: [],
          };
          byResourceId.set(card.resourceVersionId, entry);
        }
        entry.syllabiMap.set(plan.syllabusId, {
          syllabusId: plan.syllabusId,
          syllabusTitle,
          domain: plan.domain,
        });
        const duplicateUsage = entry.usages.some(
          (u) => u.syllabusId === plan.syllabusId && u.activityId === act.activityId,
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
            syllabusId: plan.syllabusId,
            syllabusTitle,
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

  for (const libId of extraLibraryIds) {
    if (removedSet.has(libId) || byResourceId.has(libId)) continue;
    const rawEntry = catalogResources[libId] ?? CANONICAL_JSON_BY_ID[libId];
    if (!rawEntry) continue;
    const accessModel = rawEntry.access?.model ?? "free";
    const basis = rawEntry.ingestion_permissions?.basis ?? "link_and_metadata_only";
    const certIncluded = Boolean(rawEntry.access?.certificate_included);
    const syntheticCard: SourceCardView = {
      resourceVersionId: libId,
      role: "primary",
      title: rawEntry.title ?? libId,
      verifiedPublisher: rawEntry.provider?.display_name ?? "Library resource",
      versionTimestamp: rawEntry.captured_at ?? "2026-10-30T00:00:00Z",
      canonicalUrl: rawEntry.canonical_url ?? null,
      accessModel,
      rightsBadge: {
        basis,
        displayExcerptsAllowed: rawEntry.ingestion_permissions?.permissions?.display_excerpts === "allowed",
        externalLinkOnly: basis === "link_and_metadata_only",
        label: rawEntry.access?.rights_label ?? "External Link · Metadata Indexed",
      },
      optionalCertificationBadge: certIncluded
        ? {
            included: true,
            relationship: "optional_preparation",
            label: "Optional certification preparation (separate from core completion)",
            rationale: rawEntry.description ?? "Optional certificate offered by provider.",
            verifiedIssuerUrl: rawEntry.canonical_url ?? null,
            isAccreditedQualificationGuarantee: false,
          }
        : null,
      selectionRationale:
        rawEntry.description ?? "Saved in your personal library — ready to link to any syllabus.",
      verifiedSegments: (rawEntry.segments ?? [])
        .map((s) => s.segment_id)
        .filter((s): s is string => Boolean(s)),
      omitsUnverifiedPrecision: true,
    };
    byResourceId.set(libId, {
      card: syntheticCard,
      syllabiMap: new Map(),
      usages: [],
    });
  }

  return Array.from(byResourceId.values()).map(({ card, syllabiMap, usages }) => {
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
      title: rawEntry?.title ?? card.title,
      verifiedPublisher: rawEntry?.provider?.display_name ?? card.verifiedPublisher,
      versionTimestamp: rawEntry?.captured_at ?? card.versionTimestamp,
      canonicalUrl: rawEntry?.canonical_url ?? card.canonicalUrl,
      accessModel: rawEntry?.access?.model ?? card.accessModel,
      accessJson,
      rightsBadge: card.rightsBadge,
      optionalCertificationBadge: card.optionalCertificationBadge,
      selectionRationale: card.selectionRationale,
      category: classifyResourceCategory(
        card.resourceVersionId,
        rawEntry?.title ?? card.title,
        rawEntry?.provider?.display_name ?? card.verifiedPublisher,
        rawEntry?.category,
      ),
      segments,
      syllabi: Array.from(syllabiMap.values()),
      usages,
    };
  });
}

export interface ResourcesViewProps {
  readonly active: boolean;
  readonly selectedPlan: ActiveSyllabus;
  readonly allPlans: readonly ActiveSyllabus[];
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly resourceScope: ResourceScope;
  readonly resourceCategory: ResourceCategory;
  readonly userLibraryResourceIds?: readonly string[] | undefined;
  readonly removedResourceIds?: readonly string[] | undefined;
  readonly resourceNotice?: string | null | undefined;
}

export function ResourcesView({
  active,
  selectedPlan,
  allPlans,
  proficiency,
  catalogResources,
  resourceScope,
  resourceCategory,
  userLibraryResourceIds = [],
  removedResourceIds = [],
  resourceNotice = null,
}: ResourcesViewProps): VNode {
  const scopedPlans = resourceScope === "all" ? allPlans : [selectedPlan];
  const allScopedRows = buildAggregatedResourceRows(
    scopedPlans,
    proficiency,
    catalogResources,
    resourceScope === "all" ? userLibraryResourceIds : [],
    removedResourceIds,
  );
  const filteredRows =
    resourceCategory === "All"
      ? allScopedRows
      : allScopedRows.filter((row) => row.category === resourceCategory);

  const countForCategory = (cat: ResourceCategory): number =>
    cat === "All" ? allScopedRows.length : allScopedRows.filter((row) => row.category === cat).length;

  const selectedSyllabusTitle = goalTitleOf(selectedPlan.syllabus);
  const selectValue = resourceScope === "all" ? "all" : selectedPlan.syllabusId;

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
              ? `All study materials across your ${allPlans.length} personal syllabi and saved library.`
              : `Study materials linked to ${selectedSyllabusTitle}.`}
          </p>
        </div>
        <div class="plan-toolbar">
          <div class="segmented" role="group" aria-label="Resource syllabus scope">
            <button
              type="button"
              class="seg-btn"
              data-action="set-resource-scope"
              data-resource-scope="selected"
              aria-pressed={resourceScope === "selected"}
            >
              Current syllabus
            </button>
            <button
              type="button"
              class="seg-btn"
              data-action="set-resource-scope"
              data-resource-scope="all"
              aria-pressed={resourceScope === "all"}
            >
              All syllabi ({allPlans.length})
            </button>
          </div>
          <label class="field field-inline" for="resources-syllabus-control">
            <span class="st-sr">Syllabus</span>
            <select
              id="resources-syllabus-control"
              name="resources-syllabus"
              data-action="select-syllabus"
            >
              <option value="all" selected={selectValue === "all"}>
                All active syllabi ({allPlans.length})
              </option>
              {allPlans.map((plan) => (
                <option
                  key={plan.syllabusId}
                  value={plan.syllabusId}
                  selected={selectValue === plan.syllabusId}
                >
                  {goalTitleOf(plan.syllabus)}
                  {plan.draft ? " · Draft" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            class="btn-primary"
            data-action="open-resource-editor"
            data-editor-mode="ingest"
            data-syllabus-id={resourceScope === "all" ? "__library_only__" : selectedPlan.syllabusId}
          >
            + Add resource
          </button>
        </div>
      </div>

      {resourceNotice ? (
        <p class="prose resource-status-notice" role="status">
          {resourceNotice}
        </p>
      ) : null}

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
                  ? `Curated resources across all ${allPlans.length} syllabi`
                  : `Curated resources for ${selectedSyllabusTitle}`}
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
                  const linkedToSelected = row.syllabi.some((c) => c.syllabusId === selectedPlan.syllabusId);
                  const editSyllabusId = linkedToSelected
                    ? selectedPlan.syllabusId
                    : (row.syllabi[0]?.syllabusId ?? "__library_only__");
                  const unlinkSyllabusId =
                    resourceScope === "selected"
                      ? selectedPlan.syllabusId
                      : row.syllabi.length === 1
                        ? row.syllabi[0]!.syllabusId
                        : linkedToSelected
                          ? selectedPlan.syllabusId
                          : null;

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
                        {row.usages.length === 0 ? (
                          <p class="row-meta resource-unlinked-note">Saved in library · Not linked yet</p>
                        ) : (
                          <ul class="resource-usage-list" aria-label={`Units using ${row.title}`}>
                            {row.usages.map((usage) => {
                              const href = usage.sourceUrl ?? row.canonicalUrl;
                              return (
                                <li key={`${usage.syllabusId}-${usage.activityId}`}>
                                  {href ? (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      class="resource-usage-chip"
                                      data-syllabus-id={usage.syllabusId}
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
                                      data-syllabus-id={usage.syllabusId}
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
                        )}
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
                        <div class="resource-row-actions">
                          {row.canonicalUrl ? (
                            <a
                              href={row.canonicalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="source-open-link"
                            >
                              Open
                              <span aria-hidden="true">↗</span>
                              <span class="st-sr"> {row.title} in a new tab</span>
                            </a>
                          ) : null}
                          {!linkedToSelected ? (
                            <button
                              type="button"
                              class="source-action-btn"
                              data-action="open-resource-editor"
                              data-editor-mode="link"
                              data-resource-id={row.resourceVersionId}
                              data-syllabus-id={selectedPlan.syllabusId}
                            >
                              Link
                            </button>
                          ) : null}
                          <button
                            type="button"
                            class="source-action-btn"
                            data-action="open-resource-editor"
                            data-editor-mode="edit"
                            data-resource-id={row.resourceVersionId}
                            data-syllabus-id={editSyllabusId}
                          >
                            Edit
                          </button>
                          {unlinkSyllabusId ? (
                            <button
                              type="button"
                              class="source-action-btn source-action-danger"
                              data-action="unlink-syllabus-resource"
                              data-resource-id={row.resourceVersionId}
                              data-syllabus-id={unlinkSyllabusId}
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              type="button"
                              class="source-action-btn source-action-danger"
                              data-action="delete-library-resource"
                              data-resource-id={row.resourceVersionId}
                            >
                              Delete
                            </button>
                          )}
                        </div>
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
