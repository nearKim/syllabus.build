#!/usr/bin/env node
/**
 * Validates every individual resource file in `catalog/resources/<subject>/<id>.json`
 * against the open catalog contract and synchronizes (or `--check` verifies)
 * `apps/web/src/data/catalogResources.json` for browser client bundling.
 *
 * Also supports `--bootstrap` to populate `catalog/resources/` from an existing
 * `apps/web/src/data/catalogResources.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_DIR = path.join(REPO_ROOT, "catalog");
const RESOURCES_DIR = path.join(CATALOG_DIR, "resources");
const SCHEMA_FILE = path.join(CATALOG_DIR, "schema", "resource.schema.json");
const BUNDLE_JSON_PATH = path.join(REPO_ROOT, "apps/web/src/data/catalogResources.json");

const VALID_CATEGORIES = new Set(["Course", "Book", "YouTube", "Code Lab", "Problem Set"]);
const VALID_SUBJECTS = new Set(["Engineering", "Systems", "Mathematics", "Physics", "Literature"]);
const VALID_ACCESS_MODELS = new Set(["free", "freemium_optional_certificate", "paid", "library_loan"]);
const VALID_COLLECTIONS = new Set(["curated", "community_discovered"]);

const args = new Set(process.argv.slice(2));
const isCheck = args.has("--check");
const isBootstrap = args.has("--bootstrap");

function normalizeSubject(subject) {
  const s = String(subject || "Engineering").trim();
  if (s === "Humanities") return "Literature";
  return VALID_SUBJECTS.has(s) ? s : "Engineering";
}

function subjectSlug(subject) {
  return normalizeSubject(subject).toLowerCase();
}

function validateResourceEntry(filePath, parsed) {
  const errors = [];
  const expectedId = path.basename(filePath, ".json");
  if (parsed.resource_version_id !== expectedId) {
    errors.push(`resource_version_id "${parsed.resource_version_id}" must match filename "${expectedId}.json"`);
  }
  if (!parsed.title || typeof parsed.title !== "string" || parsed.title.trim().length < 2) {
    errors.push("title must be a non-empty string (min 2 chars)");
  }
  if (!parsed.canonical_url || !/^https?:\/\//.test(String(parsed.canonical_url))) {
    errors.push(`canonical_url must start with http:// or https:// (got "${parsed.canonical_url}")`);
  }
  if (!VALID_CATEGORIES.has(parsed.category)) {
    errors.push(`category "${parsed.category}" must be one of ${[...VALID_CATEGORIES].join(", ")}`);
  }
  if (!VALID_SUBJECTS.has(parsed.subject)) {
    errors.push(`subject "${parsed.subject}" must be one of ${[...VALID_SUBJECTS].join(", ")}`);
  }
  const actualDirSubject = path.basename(path.dirname(filePath));
  if (actualDirSubject !== subjectSlug(parsed.subject)) {
    errors.push(`file is in "${actualDirSubject}/" directory but subject is "${parsed.subject}" (expected "${subjectSlug(parsed.subject)}/")`);
  }
  if (parsed.catalog_collection && !VALID_COLLECTIONS.has(parsed.catalog_collection)) {
    errors.push(`catalog_collection "${parsed.catalog_collection}" is invalid`);
  }
  if (!parsed.provider?.provider_id || !parsed.provider?.display_name) {
    errors.push("provider.provider_id and provider.display_name are required");
  }
  if (!parsed.access || !VALID_ACCESS_MODELS.has(parsed.access.model)) {
    errors.push(`access.model "${parsed.access?.model}" must be one of ${[...VALID_ACCESS_MODELS].join(", ")}`);
  }
  if (!Array.isArray(parsed.segments)) {
    errors.push("segments must be an array");
  }
  return errors;
}

if (!fs.existsSync(SCHEMA_FILE)) {
  console.error(`ERROR: Missing schema file at ${SCHEMA_FILE}`);
  process.exit(1);
}

if (isBootstrap) {
  const existing = JSON.parse(fs.readFileSync(BUNDLE_JSON_PATH, "utf8"));
  let written = 0;
  for (const [collectionKey, collectionTag] of [
    ["resources", "curated"],
    ["global_discovered_resources", "community_discovered"],
  ]) {
    const map = existing[collectionKey] || {};
    for (const [id, entry] of Object.entries(map)) {
      const normalizedSubj = normalizeSubject(entry.subject);
      const dir = path.join(RESOURCES_DIR, subjectSlug(normalizedSubj));
      fs.mkdirSync(dir, { recursive: true });
      const doc = {
        $schema: "../../schema/resource.schema.json",
        catalog_collection: collectionTag,
        ...entry,
        subject: normalizedSubj,
        resource_version_id: id,
      };
      fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      written += 1;
    }
  }
  console.log(`Bootstrapped ${written} open catalog files into ${RESOURCES_DIR}`);
}

const files = [];
function collectJsonFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsonFiles(full);
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
}
collectJsonFiles(RESOURCES_DIR);

if (files.length === 0) {
  console.error(`ERROR: No resource JSON files found under ${RESOURCES_DIR}`);
  process.exit(1);
}

const curatedEntries = [];
const discoveredEntries = [];
const seenIds = new Map();
const allErrors = [];

for (const filePath of files) {
  const rel = path.relative(REPO_ROOT, filePath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    allErrors.push(`${rel}: invalid JSON (${err.message})`);
    continue;
  }
  const errs = validateResourceEntry(filePath, parsed);
  for (const e of errs) allErrors.push(`${rel}: ${e}`);

  const id = parsed.resource_version_id;
  if (seenIds.has(id)) {
    allErrors.push(`${rel}: duplicate resource_version_id "${id}" (already defined in ${seenIds.get(id)})`);
  } else {
    seenIds.set(id, rel);
  }

  const { $schema: _s, catalog_collection, ...cleanEntry } = parsed;
  if (catalog_collection === "community_discovered") {
    discoveredEntries.push([id, cleanEntry]);
  } else {
    curatedEntries.push([id, cleanEntry]);
  }
}

if (allErrors.length > 0) {
  console.error("Open Catalog validation failed:");
  for (const e of allErrors) console.error(`  - ${e}`);
  process.exit(1);
}

curatedEntries.sort(([a], [b]) => a.localeCompare(b));
discoveredEntries.sort(([a], [b]) => a.localeCompare(b));

const expectedBundle = {
  schema_version: "0.3.0",
  resources: Object.fromEntries(curatedEntries),
  global_discovered_resources: Object.fromEntries(discoveredEntries),
};
const serializedBundle = `${JSON.stringify(expectedBundle, null, 2)}\n`;

if (isCheck) {
  const currentBundle = fs.existsSync(BUNDLE_JSON_PATH) ? fs.readFileSync(BUNDLE_JSON_PATH, "utf8") : "";
  if (currentBundle !== serializedBundle) {
    console.error(
      "ERROR: apps/web/src/data/catalogResources.json is out of sync with catalog/resources/**/*.json. Run `node scripts/sync_open_catalog.mjs`.",
    );
    process.exit(1);
  }
  console.log(
    `Open Catalog check passed (${files.length} files: ${curatedEntries.length} curated, ${discoveredEntries.length} community_discovered).`,
  );
} else {
  fs.writeFileSync(BUNDLE_JSON_PATH, serializedBundle, "utf8");
  console.log(
    `Synchronized ${files.length} open catalog files (${curatedEntries.length} curated, ${discoveredEntries.length} community_discovered) -> apps/web/src/data/catalogResources.json`,
  );
}
