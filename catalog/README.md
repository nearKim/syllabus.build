# Syllabus Open Resource Catalog

Learning resources in Syllabus are **not locked inside an opaque database**. Every public catalog resource lives as an individual, human-readable JSON file under `catalog/resources/<subject>/<resource_version_id>.json` so learners, educators, and maintainers can inspect, audit, and contribute resources via standard Git Pull Requests with zero merge conflicts.

## Directory Layout

```text
catalog/
├── README.md
├── schema/
│   └── resource.schema.json          # JSON Schema 2020-12 (enables IDE autocomplete)
└── resources/
    ├── engineering/
    ├── literature/
    ├── mathematics/
    ├── physics/
    └── systems/
```

## Two Ways to Contribute a Resource

### 1. Manual Git Contribution (Any Editor or GitHub Web UI)

1. Create a new file at `catalog/resources/<subject>/<your-resource-id>.json` (where `<subject>` is `engineering`, `systems`, `mathematics`, `physics`, or `literature`).
2. Start from this minimal template (`$schema` provides full editor autocomplete):

```json
{
  "$schema": "../../schema/resource.schema.json",
  "catalog_collection": "curated",
  "resource_version_id": "kubernetes-official-docs-v1",
  "title": "Kubernetes Official Concepts & Workloads Guide",
  "canonical_url": "https://kubernetes.io/docs/concepts/",
  "captured_at": "2026-10-31T00:00:00Z",
  "category": "Book",
  "subject": "Systems",
  "description": "Canonical reference covering Pods, Deployments, Services, ConfigMaps, and RBAC.",
  "topics": ["Kubernetes", "Pods", "Deployments", "Containers"],
  "provider": {
    "provider_id": "cncf-kubernetes",
    "display_name": "CNCF / Kubernetes Documentation"
  },
  "access": {
    "model": "free",
    "tier_label": "Free",
    "cost_label": "$0",
    "rights_label": "Link & metadata",
    "certificate_included": false,
    "optional_certificate_price_minor": null,
    "access_verified_at": "2026-10-31T00:00:00Z"
  },
  "ingestion_permissions": {
    "basis": "link_and_metadata_only",
    "permissions": {
      "display_excerpts": "denied"
    }
  },
  "vector_index": {
    "status": "indexed",
    "index_type": "tfidf-cosine-v1",
    "discovered_by": "Community Published",
    "discovered_by_handle": "@your_handle",
    "last_indexed_at": "2026-10-31T00:00:00Z"
  },
  "segments": [
    {
      "segment_id": "seg-workloads",
      "title": "Workloads: Pods, ReplicaSets, and Deployments",
      "verified": true
    }
  ]
}
```

3. Run `pnpm catalog:sync` to validate against `catalog/schema/resource.schema.json` and update the browser bundle index, then open a Pull Request.

### 2. Web UI Assisted Contribution (`Learn › Resources → + Add resource`)

1. Open **`Learn › Resources`** and click **`+ Add resource`**.
2. Paste a URL alongside free-form study notes (AI inspects the page metadata and headings, classifies the resource, and extracts topics and syllabus sections).
3. Either:
   - Check **"Write to Open Catalog (`catalog/resources/`)"** when running locally to save `catalog/resources/<subject>/<id>.json` directly to disk, or
   - Click **`JSON`** on any resource row in `Learn › Resources` (`/catalog/resources/<id>.json`) to download a schema-validated `.json` file ready for a GitHub PR.

## Runtime Architecture (Git + PostgreSQL Hybrid)

- **Git is the source of truth** for the public catalog (`catalog/resources/**/*.json`).
- **Live Server & PostgreSQL Sync**: Both `@syllabus/web` and `syllabus-api` scan `catalog/resources/**/*.json` at runtime, seed/upsert entries into PostgreSQL (`catalog_resources`, `resource_versions`, `catalog_resource_segments`), and index them into BM25 / MiniSearch.
- **Public JSON Feed**: `GET /catalog/resources.json` exposes the live merged open catalog, and `GET /catalog/resources/<id>.json` exports any individual entry in canonical schema format.
