#!/usr/bin/env python3
"""Deterministically generate Rust contract descriptors, TypeScript OpenAPI types, and UI token files from extracted specs/product.md assets."""
from pathlib import Path
import argparse
import hashlib
import json
import sys
import yaml

GENERATED_HEADER = "GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md"

# HTTP concurrency policy classifications from T01 / Section 14.6
RETRIABLE_EFFECT_OPERATIONS = {
    "reserveInferenceBudget",
    "startGeneration",
    "regenerateSyllabus",
    "acceptAdaptation",
    "publishSyllabus",
    "publishRevision",
    "adoptSyllabus",
    "createBillingCheckoutSession",
    "createAccountExportJob",
    "createAccountDeletionRequest",
}

VERSIONED_MUTATION_OPERATIONS = {
    "activateSyllabusRevision",
    "patchSchedule",
    "rotateCredential",
    "revokeCredential",
    "unpublishSyllabus",
    "updateNotificationPreferences",
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def collect_openapi_operations(root: Path):
    specs = [
        ("core", root / "specs/001-syllabus-platform/contracts/openapi.yaml"),
        ("companion", root / "specs/001-syllabus-platform/contracts/app-companion.openapi.yaml"),
    ]
    operations = []
    schema_names = {"core": [], "companion": []}
    for spec_kind, path in specs:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        schemas = data.get("components", {}).get("schemas", {})
        schema_names[spec_kind] = sorted(schemas.keys())
        for route_path, methods in sorted(data.get("paths", {}).items()):
            for method, details in sorted(methods.items()):
                if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                    continue
                op_id = details.get("operationId")
                if not op_id:
                    continue
                m_upper = method.upper()
                requires_idempotency_key = op_id in RETRIABLE_EFFECT_OPERATIONS
                requires_if_match = op_id in VERSIONED_MUTATION_OPERATIONS
                operations.append({
                    "spec": spec_kind,
                    "operation_id": op_id,
                    "method": m_upper,
                    "path": route_path,
                    "summary": details.get("summary", ""),
                    "requires_idempotency_key": requires_idempotency_key,
                    "requires_if_match": requires_if_match,
                })
    operations.sort(key=lambda x: (x["spec"], x["operation_id"]))
    return operations, schema_names


def generate_rust_contracts(root: Path, spec_sha: str, operations, schema_names) -> str:
    schemas_dir = root / "specs/001-syllabus-platform/contracts"
    json_schemas = sorted(schemas_dir.glob("*.schema.json"))
    lines = [
        f"// {GENERATED_HEADER}",
        f"// Canonical Specification SHA-256: {spec_sha}",
        "",
        "/// Canonical SHA-256 digest of `specs/product.md`.",
        f"pub const CANONICAL_SPEC_SHA256: &str = \"{spec_sha}\";",
        "",
        "/// Descriptor for an embedded JSON Schema Draft 2020-12 contract.",
        "#[derive(Debug, Clone, Copy, PartialEq, Eq)]",
        "pub struct JsonSchemaDescriptor {",
        "    pub name: &'static str,",
        "    pub relative_path: &'static str,",
        "    pub sha256: &'static str,",
        "}",
        "",
        "/// Descriptor for an OpenAPI HTTP operation and its T01 concurrency policy.",
        "#[derive(Debug, Clone, Copy, PartialEq, Eq)]",
        "pub struct OpenApiOperationDescriptor {",
        "    pub contract: &'static str,",
        "    pub operation_id: &'static str,",
        "    pub method: &'static str,",
        "    pub path: &'static str,",
        "    pub requires_idempotency_key: bool,",
        "    pub requires_if_match: bool,",
        "}",
        "",
        f"pub const JSON_SCHEMA_DESCRIPTORS: [JsonSchemaDescriptor; {len(json_schemas)}] = [",
    ]
    for s in json_schemas:
        rel = s.relative_to(root).as_posix()
        digest = sha256_file(s)
        lines.append("    JsonSchemaDescriptor {")
        lines.append(f"        name: \"{s.name}\",")
        lines.append(f"        relative_path: \"{rel}\",")
        lines.append(f"        sha256: \"{digest}\",")
        lines.append("    },")
    lines.append("];")
    lines.append("")
    lines.append(f"pub const OPENAPI_OPERATIONS: [OpenApiOperationDescriptor; {len(operations)}] = [")
    for op in operations:
        lines.append("    OpenApiOperationDescriptor {")
        lines.append(f"        contract: \"{op['spec']}\",")
        lines.append(f"        operation_id: \"{op['operation_id']}\",")
        lines.append(f"        method: \"{op['method']}\",")
        lines.append(f"        path: \"{op['path']}\",")
        lines.append(f"        requires_idempotency_key: {str(op['requires_idempotency_key']).lower()},")
        lines.append(f"        requires_if_match: {str(op['requires_if_match']).lower()},")
        lines.append("    },")
    lines.append("];")
    lines.append("")
    lines.append(f"pub const CORE_COMPONENT_SCHEMA_NAMES: [&str; {len(schema_names['core'])}] = [")
    for name in schema_names["core"]:
        lines.append(f"    \"{name}\",")
    lines.append("];")
    lines.append("")
    lines.append(f"pub const COMPANION_COMPONENT_SCHEMA_NAMES: [&str; {len(schema_names['companion'])}] = [")
    for name in schema_names["companion"]:
        lines.append(f"    \"{name}\",")
    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def generate_ts_contracts(spec_sha: str, operations, schema_names) -> str:
    lines = [
        f"// {GENERATED_HEADER}",
        f"// Canonical Specification SHA-256: {spec_sha}",
        "",
        f"export const CANONICAL_SPEC_SHA256 = \"{spec_sha}\" as const;",
        "",
        "export type ContractSource = \"core\" | \"companion\";",
        "export type HttpMethod = \"GET\" | \"POST\" | \"PUT\" | \"PATCH\" | \"DELETE\";",
        "",
        "export interface OperationSpec {",
        "  readonly contract: ContractSource;",
        "  readonly operationId: OperationId;",
        "  readonly method: HttpMethod;",
        "  readonly path: string;",
        "  readonly summary: string;",
        "  readonly requiresIdempotencyKey: boolean;",
        "  readonly requiresIfMatch: boolean;",
        "}",
        "",
        "export type OperationId =",
    ]
    for op in operations:
        lines.append(f"  | \"{op['operation_id']}\"")
    lines[-1] = lines[-1] + ";"
    lines.append("")
    lines.append("export type CoreComponentSchemaName =")
    for name in schema_names["core"]:
        lines.append(f"  | \"{name}\"")
    lines[-1] = lines[-1] + ";"
    lines.append("")
    lines.append("export type CompanionComponentSchemaName =")
    for name in schema_names["companion"]:
        lines.append(f"  | \"{name}\"")
    lines[-1] = lines[-1] + ";"
    lines.append("")
    lines.append("export const OPENAPI_OPERATIONS: Readonly<Record<OperationId, OperationSpec>> = {")
    for op in operations:
        summary_escaped = op["summary"].replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f"  {op['operation_id']}: {{")
        lines.append(f"    contract: \"{op['spec']}\",")
        lines.append(f"    operationId: \"{op['operation_id']}\",")
        lines.append(f"    method: \"{op['method']}\",")
        lines.append(f"    path: \"{op['path']}\",")
        lines.append(f"    summary: \"{summary_escaped}\",")
        lines.append(f"    requiresIdempotencyKey: {str(op['requires_idempotency_key']).lower()},")
        lines.append(f"    requiresIfMatch: {str(op['requires_if_match']).lower()},")
        lines.append("  },")
    lines.append("} as const;")
    lines.append("")
    return "\n".join(lines)


def generate_ui_tokens(root: Path, spec_sha: str):
    tokens_path = root / "design/ui-tokens.json"
    tokens = json.loads(tokens_path.read_text(encoding="utf-8"))

    css_lines = [
        f"/* {GENERATED_HEADER} */",
        f"/* Canonical Specification SHA-256: {spec_sha} */",
        "",
        ":root,",
        "[data-theme=\"light\"] {",
    ]
    for key, val in sorted(tokens["colors"].items()):
        css_var = key.replace("_", "-")
        css_lines.append(f"  --color-{css_var}: {val['light']};")
    for idx, px in enumerate(tokens.get("spacing_css_px", []), start=1):
        css_lines.append(f"  --space-{idx}: {px}px;")
    for key, val in sorted(tokens.get("layout_css_px", {}).items()):
        css_lines.append(f"  --layout-{key.replace('_', '-')}: {val}px;")
    css_lines.append("}")
    css_lines.append("")
    css_lines.append("[data-theme=\"dark\"] {")
    for key, val in sorted(tokens["colors"].items()):
        css_var = key.replace("_", "-")
        css_lines.append(f"  --color-{css_var}: {val['dark']};")
    css_lines.append("}")
    css_lines.append("")
    css_lines.extend([
        "/* Solid fallback when backdrop-filter is unsupported or reduced transparency is active */",
        "@supports not (backdrop-filter: blur(1px)) {",
        "  .nav-chrome-glass {",
        "    background-color: var(--color-surface) !important;",
        "    backdrop-filter: none !important;",
        "  }",
        "}",
        "",
        "@media (prefers-reduced-transparency: reduce) {",
        "  .nav-chrome-glass {",
        "    background-color: var(--color-surface) !important;",
        "    backdrop-filter: none !important;",
        "  }",
        "}",
        "",
    ])

    ts_lines = [
        f"// {GENERATED_HEADER}",
        f"// Canonical Specification SHA-256: {spec_sha}",
        "",
        f"export const UI_TOKENS = {json.dumps(tokens, indent=2)} as const;",
        "",
        "export type ThemeMode = \"light\" | \"dark\";",
        "export type SemanticColorToken = keyof typeof UI_TOKENS.colors;",
        "",
    ]
    return "\n".join(css_lines), "\n".join(ts_lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check that generated files match without writing")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    spec_path = root / "specs/product.md"
    spec_sha = sha256_file(spec_path)
    operations, schema_names = collect_openapi_operations(root)

    rust_code = generate_rust_contracts(root, spec_sha, operations, schema_names)
    ts_code = generate_ts_contracts(spec_sha, operations, schema_names)
    css_tokens, ts_tokens = generate_ui_tokens(root, spec_sha)

    outputs = {
        root / "crates/contracts/src/generated.rs": rust_code,
        root / "packages/api-client/src/generated.ts": ts_code,
        root / "packages/ui/src/tokens.css": css_tokens,
        root / "packages/ui/src/tokens.ts": ts_tokens,
    }

    drifted = []
    for path, content in outputs.items():
        if args.check:
            if not path.exists():
                drifted.append(f"missing: {path.relative_to(root)}")
            elif path.read_text(encoding="utf-8") != content:
                drifted.append(f"drifted: {path.relative_to(root)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")

    if args.check:
        if drifted:
            for item in drifted:
                print(item, file=sys.stderr)
            raise SystemExit(1)
        print(f"Verified {len(outputs)} generated contract and token files (71 HTTP operations, 6 JSON Schemas)")
    else:
        print(f"Generated {len(outputs)} contract and token files (71 HTTP operations, 6 JSON Schemas)")


if __name__ == "__main__":
    main()
