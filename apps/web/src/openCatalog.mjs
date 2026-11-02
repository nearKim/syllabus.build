import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OPEN_CATALOG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../catalog",
);

function stripSchemaFields(raw) {
  const { $schema: _s, catalog_collection: _c, ...entry } = raw;
  return entry;
}

/**
 * Dynamically scans `catalog/resources/**\/*.json` from disk so manual Git edits
 * or newly dropped `.json` files appear immediately in the server and search index.
 */
export function loadOpenCatalogFromDisk(catalogRootDir = DEFAULT_OPEN_CATALOG_DIR) {
  const resourcesDir = path.join(catalogRootDir, "resources");
  const curated = {};
  const discovered = {};
  let fileCount = 0;

  if (!fs.existsSync(resourcesDir)) {
    return {
      schema_version: "1.0.0",
      resources: curated,
      global_discovered_resources: discovered,
      all: {},
      fileCount: 0,
    };
  }

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of entries) {
      const fullPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walk(fullPath);
      } else if (dirent.isFile() && dirent.name.endsWith(".json")) {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        const id = parsed?.resource_version_id;
        if (!id || typeof id !== "string") continue;
        const clean = stripSchemaFields(parsed);
        if (parsed.catalog_collection === "community_discovered") {
          discovered[id] = clean;
        } else {
          curated[id] = clean;
        }
        fileCount += 1;
      }
    }
  };

  walk(resourcesDir);

  return {
    schema_version: "1.0.0",
    resources: curated,
    global_discovered_resources: discovered,
    all: { ...discovered, ...curated },
    fileCount,
  };
}

/**
 * Formats a `CatalogResourceMetadataInput` as a standalone, pretty-printed JSON document
 * referencing `../../schema/resource.schema.json` so contributors can drop it directly into
 * `catalog/resources/<subject>/<id>.json` and open a GitHub Pull Request.
 */
export function serializeOpenCatalogEntry(entry, collection = "community_discovered") {
  const safeId = String(entry.resource_version_id ?? "manual-resource-v1")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const nowIso = new Date().toISOString();
  const ordered = {
    $schema: "../../schema/resource.schema.json",
    catalog_collection: collection,
    resource_version_id: safeId,
    title: entry.title ?? safeId,
    canonical_url: entry.canonical_url ?? "https://example.org",
    captured_at: entry.captured_at ?? nowIso,
    category: entry.category ?? "Course",
    subject: entry.subject ?? "Engineering",
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.topics && entry.topics.length > 0 ? { topics: [...entry.topics] } : {}),
    provider: {
      provider_id: entry.provider?.provider_id ?? "community-source",
      display_name: entry.provider?.display_name ?? "Community Contributor",
    },
    access: {
      model: entry.access?.model ?? "free",
      tier_label: entry.access?.tier_label ?? "Free",
      cost_label: entry.access?.cost_label ?? "$0",
      rights_label: entry.access?.rights_label ?? "External Link · Metadata Indexed",
      certificate_included: Boolean(entry.access?.certificate_included),
      optional_certificate_price_minor: entry.access?.optional_certificate_price_minor ?? null,
      ...(entry.access?.access_verified_at ? { access_verified_at: entry.access.access_verified_at } : {}),
    },
    ingestion_permissions: {
      basis: entry.ingestion_permissions?.basis ?? "link_and_metadata_only",
      permissions: entry.ingestion_permissions?.permissions ?? { display_excerpts: "denied" },
    },
    vector_index: {
      status: entry.vector_index?.status ?? "indexed",
      index_type: entry.vector_index?.index_type ?? "tfidf-cosine-v1",
      discovered_by: entry.vector_index?.discovered_by ?? "Community Published",
      discovered_by_handle: entry.vector_index?.discovered_by_handle ?? "@community",
      last_indexed_at: entry.vector_index?.last_indexed_at ?? nowIso,
    },
    segments: (entry.segments ?? []).map((seg, idx) => ({
      segment_id: seg.segment_id || `seg-${idx + 1}`,
      title: seg.title,
      verified: Boolean(seg.verified ?? true),
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
