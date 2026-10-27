import type { VNode } from "preact";
import type { CatalogResourceMetadataInput } from "../../../../packages/ui/src/index.ts";
import catalogResourcesJson from "../data/catalogResources.json" with { type: "json" };
import type { Account } from "./HeaderBar.tsx";
import { SfIcon } from "./Icons.tsx";
import { MathText } from "./MathText.tsx";
import {
  RESOURCE_CATEGORIES,
  categoryIcon,
  classifyResourceCategory,
  formatResourceDate,
  resolveStructuredAccessJson,
  type ResourceCategory,
  type StructuredResourceAccessJson,
} from "./ResourcesView.tsx";

export const ADMIN_DISCOVERY_SOURCES = [
  "All",
  "Curator Verified",
  "AI Web Search",
  "Community Published",
] as const;
export type AdminDiscoverySource = (typeof ADMIN_DISCOVERY_SOURCES)[number];

export interface AdminGlobalResourceRow {
  readonly resourceVersionId: string;
  readonly title: string;
  readonly canonicalUrl: string | null;
  readonly verifiedPublisher: string;
  readonly capturedAt: string;
  readonly category: Exclude<ResourceCategory, "All">;
  readonly subject: string;
  readonly accessJson: StructuredResourceAccessJson;
  readonly vectorStatus: "indexed" | "pending_reindex" | "quarantined";
  readonly embeddingModel: string;
  readonly dimensions: number;
  readonly indexType: string;
  readonly chunkCount: number;
  readonly discoveredBy: Exclude<AdminDiscoverySource, "All">;
  readonly discoveredByHandle: string;
  readonly lastIndexedAt: string;
  readonly segments: readonly { readonly segment_id: string; readonly title: string }[];
}

export function isAdminAccount(account: Account): boolean {
  return (
    account.role === "Moderator" ||
    account.role === "Curator" ||
    account.accountId === "learner-default" ||
    account.email.toLowerCase() === "alex@curriculum.io"
  );
}

export function buildGlobalCorpusCatalog(
  runtimeCatalog: Readonly<Record<string, CatalogResourceMetadataInput>>,
  removedResourceIds: readonly string[] = [],
  overrides: Readonly<Record<string, Partial<CatalogResourceMetadataInput>>> = {},
): Readonly<Record<string, CatalogResourceMetadataInput>> {
  const baseJson = catalogResourcesJson.resources as Readonly<Record<string, CatalogResourceMetadataInput>>;
  const discoveredJson = catalogResourcesJson.global_discovered_resources as Readonly<
    Record<string, CatalogResourceMetadataInput>
  >;

  const merged: Record<string, CatalogResourceMetadataInput> = {
    ...baseJson,
    ...discoveredJson,
  };

  for (const [id, entry] of Object.entries(runtimeCatalog)) {
    const existing = merged[id];
    merged[id] = existing
      ? {
          ...existing,
          ...entry,
          access: { ...existing.access, ...entry.access },
          vector_index: { ...existing.vector_index, ...entry.vector_index },
          segments: entry.segments && entry.segments.length > 0 ? entry.segments : existing.segments,
        }
      : entry;
  }

  for (const [id, override] of Object.entries(overrides)) {
    const current = merged[id];
    if (!current) continue;
    merged[id] = {
      ...current,
      ...override,
      access: { ...current.access, ...override.access },
      vector_index: { ...current.vector_index, ...override.vector_index },
    };
  }

  for (const removedId of removedResourceIds) {
    delete merged[removedId];
  }

  return merged;
}

export function buildAdminGlobalResourceRows(
  globalCatalog: Readonly<Record<string, CatalogResourceMetadataInput>>,
): readonly AdminGlobalResourceRow[] {
  return Object.entries(globalCatalog).map(([id, raw]) => {
    const resourceVersionId = raw.resource_version_id ?? id;
    const title = raw.title ?? resourceVersionId;
    const verifiedPublisher = raw.provider?.display_name ?? "Open Catalog Provider";
    const capturedAt = raw.captured_at ?? "2026-10-20T16:00:00Z";
    const category = classifyResourceCategory(resourceVersionId, title, verifiedPublisher, raw.category);
    const subject = raw.subject ?? "Engineering";
    const accessJson = resolveStructuredAccessJson(
      resourceVersionId,
      raw,
      raw.access?.model ?? "free",
      {
        basis: raw.ingestion_permissions?.basis ?? "link_and_metadata_only",
        label: "Link & metadata",
        displayExcerptsAllowed: false,
        externalLinkOnly: true,
      },
      null,
    );

    const rawVec = raw.vector_index;
    const vectorStatus: "indexed" | "pending_reindex" | "quarantined" =
      rawVec?.status === "pending_reindex" || rawVec?.status === "quarantined" ? rawVec.status : "indexed";
    const discoveredBy: Exclude<AdminDiscoverySource, "All"> =
      rawVec?.discovered_by === "AI Web Search" || rawVec?.discovered_by === "Community Published"
        ? rawVec.discovered_by
        : resourceVersionId.startsWith("discovered-")
          ? "AI Web Search"
          : "Curator Verified";

    const rawSegments = raw.segments ?? [];
    const segments = rawSegments
      .filter((s): s is { readonly segment_id: string; readonly title: string } => Boolean(s.segment_id && s.title))
      .map((s) => ({ segment_id: s.segment_id, title: s.title }));

    return {
      resourceVersionId,
      title,
      canonicalUrl: raw.canonical_url ?? null,
      verifiedPublisher,
      capturedAt,
      category,
      subject,
      accessJson,
      vectorStatus,
      embeddingModel: rawVec?.embedding_model ?? catalogResourcesJson.vector_db_config.embedding_model,
      dimensions: rawVec?.dimensions ?? catalogResourcesJson.vector_db_config.dimensions,
      indexType: rawVec?.index_type ?? "pgvector · HNSW",
      chunkCount: rawVec?.chunk_count ?? Math.max(12, segments.length * 10),
      discoveredBy,
      discoveredByHandle: rawVec?.discovered_by_handle ?? "@alex",
      lastIndexedAt: rawVec?.last_indexed_at ?? capturedAt,
      segments,
    };
  });
}

export interface AdminResourcesViewProps {
  readonly account: Account;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly adminSourceFilter: AdminDiscoverySource;
  readonly adminCategoryFilter: ResourceCategory;
  readonly adminSearchQuery: string;
  readonly adminRemovedResourceIds: readonly string[];
  readonly adminResourceOverrides: Readonly<Record<string, Partial<CatalogResourceMetadataInput>>>;
  readonly adminNotice: string | null;
}

export function AdminResourcesView({
  account,
  catalogResources,
  adminSourceFilter,
  adminCategoryFilter,
  adminSearchQuery,
  adminRemovedResourceIds,
  adminResourceOverrides,
  adminNotice,
}: AdminResourcesViewProps): VNode {
  const authorized = isAdminAccount(account);
  const globalCatalog = buildGlobalCorpusCatalog(
    catalogResources,
    adminRemovedResourceIds,
    adminResourceOverrides,
  );
  const allRows = buildAdminGlobalResourceRows(globalCatalog);

  const normalizedQuery = adminSearchQuery.trim().toLowerCase();
  const filteredRows = allRows.filter((row) => {
    if (adminSourceFilter !== "All" && row.discoveredBy !== adminSourceFilter) return false;
    if (adminCategoryFilter !== "All" && row.category !== adminCategoryFilter) return false;
    if (normalizedQuery.length > 0) {
      const haystack =
        `${row.title} ${row.resourceVersionId} ${row.verifiedPublisher} ${row.subject} ${row.discoveredByHandle}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });

  const countForSource = (src: AdminDiscoverySource): number =>
    src === "All" ? allRows.length : allRows.filter((r) => r.discoveredBy === src).length;

  const countForCategory = (cat: ResourceCategory): number =>
    cat === "All" ? allRows.length : allRows.filter((r) => r.category === cat).length;

  const totalChunks = allRows.reduce((sum, r) => sum + r.chunkCount, 0);
  const indexedCount = allRows.filter((r) => r.vectorStatus === "indexed").length;
  const pendingCount = allRows.filter((r) => r.vectorStatus === "pending_reindex").length;
  const aiDiscoveredCount = allRows.filter((r) => r.discoveredBy === "AI Web Search").length;
  const curatorVerifiedCount = allRows.filter((r) => r.discoveredBy === "Curator Verified").length;

  if (!authorized) {
    return (
      <section
        class="top-level-panel"
        id="panel-admin-resources"
        data-top-panel="Admin"
        data-active="true"
        data-admin-authorized="false"
      >
        <div class="section-header">
          <div class="page-heading-group">
            <h1 class="page-title">Admin resource corpus</h1>
            <p class="page-description">
              Only platform administrators and curators can open this page (403 Unauthorized Role).
            </p>
          </div>
          <div class="plan-toolbar">
            <button
              type="button"
              class="btn-secondary"
              data-action="navigate-learn-sub"
              data-sub-destination="Resources"
            >
              <span>Back to my resources</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      class="top-level-panel"
      id="panel-admin-resources"
      data-top-panel="Admin"
      data-active="true"
      data-admin-authorized="true"
      data-admin-source={adminSourceFilter}
      data-admin-category={adminCategoryFilter}
      data-vector-engine={catalogResourcesJson.vector_db_config.engine}
    >
      <div class="section-header">
        <div class="page-heading-group">
          <h1 class="page-title">Global resource &amp; vector index</h1>
          <p class="page-description">
            Manage all study resources discovered across every learner and curriculum, indexed in{" "}
            <code>pgvector · HNSW (1536d)</code> for instant intake retrieval.
          </p>
        </div>
        <div class="plan-toolbar">
          <button
            type="button"
            class="btn-secondary"
            data-action="admin-reindex-all"
          >
            <span>Re-index corpus ({allRows.length})</span>
          </button>
          <button
            type="button"
            class="btn-secondary"
            data-action="navigate-learn-sub"
            data-sub-destination="Resources"
          >
            <span>My curriculum resources</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <div class="progress-overview-strip admin-vector-overview-strip" aria-label="Vector database telemetry">
        <div class="progress-overview-col">
          <div class="progress-overview-head">
            <span class="progress-overview-label">Global corpus</span>
            <span class="progress-overview-meta">
              {indexedCount}/{allRows.length} indexed
            </span>
          </div>
          <p class="progress-overview-value">
            {allRows.length} discovered resources ({curatorVerifiedCount} curator · {aiDiscoveredCount} AI search)
          </p>
        </div>

        <div class="progress-overview-col">
          <div class="progress-overview-head">
            <span class="progress-overview-label">Vector DB index</span>
            <span class="progress-overview-meta">
              {catalogResourcesJson.vector_db_config.engine} · {catalogResourcesJson.vector_db_config.index_type}
            </span>
          </div>
          <p class="progress-overview-value">
            {totalChunks} syllabus chunks · <code>{catalogResourcesJson.vector_db_config.embedding_model}</code> (
            {catalogResourcesJson.vector_db_config.dimensions}d)
          </p>
        </div>

        <div class="progress-overview-col">
          <div class="progress-overview-head">
            <span class="progress-overview-label">Hybrid retrieval status</span>
            <span class="progress-overview-meta">
              {pendingCount > 0 ? `${pendingCount} pending re-index` : "Healthy"}
            </span>
          </div>
          <p class="progress-overview-value">
            Cosine similarity + {catalogResourcesJson.vector_db_config.hybrid_lexical_index}
          </p>
        </div>
      </div>

      {adminNotice ? (
        <p class="section-lede admin-status-notice" role="status">
          {adminNotice}
        </p>
      ) : null}

      <section class="resources-library-panel" aria-labelledby="admin-resources-heading" data-opaque-surface="true">
        <h2 id="admin-resources-heading" class="st-sr">
          All discovered resources in vector database
        </h2>

        <div class="admin-resources-filters">
          <div class="resources-toolbar-row">
            <div class="segmented resources-category-bar" role="group" aria-label="Filter by discovery source">
              {ADMIN_DISCOVERY_SOURCES.map((src) => (
                <button
                  key={src}
                  type="button"
                  class="seg-btn"
                  data-action="set-admin-resource-source"
                  data-admin-source={src}
                  aria-pressed={adminSourceFilter === src}
                >
                  <span>
                    {src} ({countForSource(src)})
                  </span>
                </button>
              ))}
            </div>

            <form class="admin-search-form" data-action="set-admin-resource-query">
              <label class="st-sr" for="admin-resource-search">
                Search global resource index
              </label>
              <input
                id="admin-resource-search"
                type="search"
                name="query"
                class="admin-search-input"
                placeholder="Filter by title, publisher, @handle, or ID…"
                value={adminSearchQuery}
              />
              {adminSearchQuery ? (
                <button
                  type="button"
                  class="provider-compact-btn"
                  data-action="clear-admin-resource-query"
                >
                  Clear
                </button>
              ) : null}
            </form>
          </div>

          <div class="resources-toolbar-row">
            <div class="segmented resources-category-bar" role="group" aria-label="Filter global corpus by category">
              {RESOURCE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  class="seg-btn resource-category-pill"
                  data-action="set-admin-resource-category"
                  data-admin-category={cat}
                  aria-pressed={adminCategoryFilter === cat}
                >
                  {cat !== "All" ? <SfIcon name={categoryIcon(cat)} size={15} /> : null}
                  <span>
                    {cat} ({countForCategory(cat)})
                  </span>
                </button>
              ))}
            </div>
            <p class="resources-count meta-text">
              Showing {filteredRows.length} of {allRows.length} global resources
            </p>
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <p class="empty-state">
            <SfIcon name="resources" />
            <span>No global resources match the current filter.</span>
          </p>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="admin-resources-table-caption"
            class="table-wrapper resources-table-wrapper"
            data-opaque-surface="true"
          >
            <table class="resources-data-table admin-resources-data-table">
              <caption id="admin-resources-table-caption" class="st-sr">
                Global discovered resources and pgvector index status
              </caption>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Resource &amp; syllabus chunks</th>
                  <th scope="col">Discovered by</th>
                  <th scope="col">Vector DB index</th>
                  <th scope="col">Access (JSON)</th>
                  <th scope="col">Manage</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const vecTone =
                    row.vectorStatus === "indexed"
                      ? "active"
                      : row.vectorStatus === "pending_reindex"
                        ? "standby"
                        : "unconfigured";
                  const vecLabel =
                    row.vectorStatus === "indexed"
                      ? `Indexed · ${row.dimensions}d`
                      : row.vectorStatus === "pending_reindex"
                        ? "Pending re-index"
                        : "Quarantined";
                  const accessTone =
                    row.accessJson.model === "free"
                      ? "active"
                      : row.accessJson.model === "freemium_optional_certificate"
                        ? "standby"
                        : "public";

                  return (
                    <tr
                      key={row.resourceVersionId}
                      class="admin-resource-row resource-table-row"
                      data-resource-version-id={row.resourceVersionId}
                      data-discovered-by={row.discoveredBy}
                      data-vector-status={row.vectorStatus}
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
                            {row.verifiedPublisher} · {row.resourceVersionId}
                          </p>
                          {row.segments.length > 0 ? (
                            <ul class="resource-segments-inline" aria-label="Indexed syllabus chunks">
                              {row.segments.map((seg) => (
                                <li key={seg.segment_id} class="resource-segment-item">
                                  <MathText text={seg.title} />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </th>
                      <td class="admin-provenance-cell">
                        <div class="resource-access-stack">
                          <span class="resource-access-tier">{row.discoveredBy}</span>
                          <span class="row-meta">
                            {row.discoveredByHandle} · <time dateTime={row.capturedAt}>{formatResourceDate(row.capturedAt)}</time>
                          </span>
                        </div>
                      </td>
                      <td class="admin-vector-cell">
                        <div class="resource-access-stack">
                          <div class="resource-access-primary">
                            <span class="status-dot" data-status={vecTone} aria-hidden="true" />
                            <span class="resource-access-tier">{vecLabel}</span>
                          </div>
                          <span class="row-meta">
                            {row.chunkCount} chunks · {row.indexType}
                          </span>
                        </div>
                      </td>
                      <td class="resource-access-cell">
                        <div class="resource-access-stack">
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
                        <div class="row-actions admin-row-actions">
                          {row.discoveredBy !== "Curator Verified" ? (
                            <button
                              type="button"
                              class="provider-compact-btn"
                              data-action="admin-verify-resource"
                              data-resource-id={row.resourceVersionId}
                            >
                              Verify
                            </button>
                          ) : null}
                          <button
                            type="button"
                            class="provider-compact-btn"
                            data-action="admin-reindex-resource"
                            data-resource-id={row.resourceVersionId}
                          >
                            Re-index
                          </button>
                          <button
                            type="button"
                            class="provider-icon-btn provider-remove-btn"
                            data-action="admin-remove-resource"
                            data-resource-id={row.resourceVersionId}
                            aria-label={`Remove ${row.title} from global vector index`}
                            title="Remove from global index"
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.9"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
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
