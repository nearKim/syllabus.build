//! Authoritative runtime JSON Schema Draft 2020-12 contract validation,
//! RFC 8785 JCS digest verification, and generated contract descriptors (`T00`, `NFR-002`, `NFR-005`).

pub mod generated;
pub mod jcs;

use jsonschema::Validator;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ContractValidationError {
    #[error("failed to read contract or fixture at `{path}`: {source}")]
    Io {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to parse JSON at `{path}`: {source}")]
    JsonParse {
        path: String,
        source: serde_json::Error,
    },
    #[error("failed to compile JSON Schema `{schema_name}`: {message}")]
    SchemaCompilation {
        schema_name: String,
        message: String,
    },
    #[error("JSON Schema validation failed for `{schema_name}`: {errors:?}")]
    SchemaValidationFailed {
        schema_name: String,
        errors: Vec<String>,
    },
    #[error("unknown schema name `{0}`")]
    UnknownSchema(String),
}

/// Returns the workspace root directory.
pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .to_path_buf()
}

/// Authoritative backend JSON Schema Draft 2020-12 registry loaded from
/// `specs/001-curriculum-platform/contracts/*.schema.json`.
pub struct ContractRegistry {
    validators: BTreeMap<String, Validator>,
}

impl ContractRegistry {
    pub fn load_from_workspace() -> Result<Self, ContractValidationError> {
        Self::load_from_root(&workspace_root())
    }

    pub fn load_from_root(root: &Path) -> Result<Self, ContractValidationError> {
        let mut raw_schemas: Vec<(String, Value)> = Vec::new();
        let mut opts = jsonschema::options().with_draft(jsonschema::Draft::Draft202012);

        for desc in &generated::JSON_SCHEMA_DESCRIPTORS {
            let full_path = root.join(desc.relative_path);
            let bytes = std::fs::read(&full_path).map_err(|source| ContractValidationError::Io {
                path: full_path.display().to_string(),
                source,
            })?;
            let actual_sha = jcs::sha256_bytes_hex(&bytes);
            assert_eq!(
                actual_sha, desc.sha256,
                "schema SHA-256 drift detected for {}",
                desc.name
            );
            let val: Value =
                serde_json::from_slice(&bytes).map_err(|source| ContractValidationError::JsonParse {
                    path: full_path.display().to_string(),
                    source,
                })?;
            if let Some(id) = val.get("$id").and_then(|v| v.as_str()) {
                let res = jsonschema::Resource::from_contents(val.clone()).map_err(|e| {
                    ContractValidationError::SchemaCompilation {
                        schema_name: desc.name.to_string(),
                        message: e.to_string(),
                    }
                })?;
                opts = opts.with_resource(id.to_string(), res);
            }
            raw_schemas.push((desc.name.to_string(), val));
        }

        let mut validators = BTreeMap::new();
        for (name, schema_val) in raw_schemas {
            let compiled = opts.build(&schema_val).map_err(|e| {
                ContractValidationError::SchemaCompilation {
                    schema_name: name.clone(),
                    message: e.to_string(),
                }
            })?;
            validators.insert(name, compiled);
        }

        Ok(Self { validators })
    }

    pub fn validate(&self, schema_name: &str, instance: &Value) -> Result<(), ContractValidationError> {
        let validator = self
            .validators
            .get(schema_name)
            .ok_or_else(|| ContractValidationError::UnknownSchema(schema_name.to_string()))?;

        let errors: Vec<String> = validator
            .iter_errors(instance)
            .map(|e| format!("{} at {}", e, e.instance_path))
            .collect();

        if errors.is_empty() {
            Ok(())
        } else {
            Err(ContractValidationError::SchemaValidationFailed {
                schema_name: schema_name.to_string(),
                errors,
            })
        }
    }
    pub fn validate_def(
        &self,
        schema_name: &str,
        def_name: &str,
        instance: &Value,
    ) -> Result<(), ContractValidationError> {
        let root = workspace_root();
        let mut opts = jsonschema::options().with_draft(jsonschema::Draft::Draft202012);
        for desc in &generated::JSON_SCHEMA_DESCRIPTORS {
            let val: Value =
                serde_json::from_slice(&std::fs::read(root.join(desc.relative_path)).unwrap())
                    .unwrap();
            if let Some(id) = val.get("$id").and_then(|v| v.as_str()).map(str::to_string) {
                let res = jsonschema::Resource::from_contents(val).unwrap();
                opts = opts.with_resource(id, res);
            }
        }
        let target_desc = generated::JSON_SCHEMA_DESCRIPTORS
            .iter()
            .find(|d| d.name == schema_name)
            .ok_or_else(|| ContractValidationError::UnknownSchema(schema_name.to_string()))?;
        let base_schema: Value =
            serde_json::from_slice(&std::fs::read(root.join(target_desc.relative_path)).unwrap())
                .unwrap();
        let base_id = base_schema["$id"].as_str().unwrap();
        let ref_schema = serde_json::json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$ref": format!("{base_id}#/$defs/{def_name}")
        });
        let validator = opts.build(&ref_schema).map_err(|e| {
            ContractValidationError::SchemaCompilation {
                schema_name: format!("{schema_name}#/$defs/{def_name}"),
                message: e.to_string(),
            }
        })?;
        let errors: Vec<String> = validator
            .iter_errors(instance)
            .map(|e| format!("{} at {}", e, e.instance_path))
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(ContractValidationError::SchemaValidationFailed {
                schema_name: format!("{schema_name}#/$defs/{def_name}"),
                errors,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read_json(path: &Path) -> Value {
        let text = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("failed to read {}: {}", path.display(), e));
        serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("failed to parse {}: {}", path.display(), e))
    }

    #[test]
    fn validates_all_six_json_schemas_and_positive_and_negative_fixtures() {
        let root = workspace_root();
        let registry = ContractRegistry::load_from_root(&root).expect("load contract registry");
        let examples = root.join("specs/001-curriculum-platform/examples");

        let positive_standalone = [
            (
                "generation-request.schema.json",
                "generation-request.hosted.synthetic.json",
            ),
            (
                "generation-request.schema.json",
                "generation-request.byok.synthetic.json",
            ),
            (
                "generation-request.schema.json",
                "generation-request.formal-math.synthetic.json",
            ),
            ("resource.schema.json", "resource.synthetic.json"),
            (
                "resource.schema.json",
                "resource-unknown-price.synthetic.json",
            ),
            ("curriculum.schema.json", "curriculum.synthetic.json"),
            ("proficiency.schema.json", "proficiency.synthetic.json"),
            (
                "public-curriculum.schema.json",
                "public-curriculum.synthetic.json",
            ),
            (
                "adaptation-proposal.schema.json",
                "adaptation-proposal.synthetic.json",
            ),
        ];

        for (schema, fixture) in positive_standalone {
            let val = read_json(&examples.join(fixture));
            registry
                .validate(schema, &val)
                .unwrap_or_else(|e| panic!("positive fixture {fixture} failed {schema}: {e}"));
        }

        // Also validate curriculum-candidate against curriculum.schema.json#/$defs/modelCandidate
        let candidate = read_json(&examples.join("curriculum-candidate.synthetic.json"));
        registry
            .validate_def("curriculum.schema.json", "modelCandidate", &candidate)
            .expect("positive curriculum-candidate must validate against modelCandidate");

        // Negative cases (matching check_contracts.py negative mutations)
        let mut bad_candidate = candidate.clone();
        bad_candidate["html"] = json!("<script>alert(1)</script>");
        assert!(registry
            .validate_def("curriculum.schema.json", "modelCandidate", &bad_candidate)
            .is_err());

        let mut bad_curriculum = read_json(&examples.join("curriculum.synthetic.json"));
        bad_curriculum["mastered"] = json!(true);
        assert!(registry
            .validate("curriculum.schema.json", &bad_curriculum)
            .is_err());

        let mut bad_mastery_gated = read_json(&examples.join("curriculum.synthetic.json"));
        bad_mastery_gated["activities"][0]["mastery_gated"] = json!("yes");
        assert!(registry
            .validate("curriculum.schema.json", &bad_mastery_gated)
            .is_err());

        let mut bad_byok = read_json(&examples.join("generation-request.byok.synthetic.json"));
        bad_byok["inference"]["allow_hosted_fallback"] = json!(true);
        assert!(registry
            .validate("generation-request.schema.json", &bad_byok)
            .is_err());

        let mut bad_public = read_json(&examples.join("public-curriculum.synthetic.json"));
        bad_public["account_id"] = json!("private-account-marker");
        assert!(registry
            .validate("public-curriculum.schema.json", &bad_public)
            .is_err());

        let mut bad_prof = read_json(&examples.join("proficiency.synthetic.json"));
        bad_prof["objective_evidence"][1]["status"] = json!("demonstrated");
        assert!(registry
            .validate("proficiency.schema.json", &bad_prof)
            .is_err());
    }

    #[test]
    fn verifies_all_four_cryptographic_sha256_and_rfc8785_jcs_digests() {
        let root = workspace_root();
        let examples = root.join("specs/001-curriculum-platform/examples");

        // 1. Candidate archive raw UTF-8 SHA-256 digest stored in curriculum.synthetic.json provenance
        let candidate_bytes =
            std::fs::read(examples.join("curriculum-candidate.synthetic.json")).unwrap();
        let canonical = read_json(&examples.join("curriculum.synthetic.json"));
        assert_eq!(
            jcs::sha256_bytes_hex(&candidate_bytes),
            canonical["provenance"]["candidate_sha256"].as_str().unwrap()
        );

        // 2. Public curriculum JCS content_sha256 digest
        let public_curriculum = read_json(&examples.join("public-curriculum.synthetic.json"));
        let expected_content_sha = public_curriculum["content_sha256"].as_str().unwrap();
        let actual_content_sha = jcs::jcs_sha256_hex(&public_curriculum["content"]);
        assert_eq!(actual_content_sha, expected_content_sha);

        // 3. Publication preview JCS preview_sha256 digest
        let pub_preview = read_json(&examples.join("publication-preview.synthetic.json"));
        assert_eq!(
            pub_preview["content_sha256"].as_str().unwrap(),
            expected_content_sha
        );
        let preview_payload = json!({
            "content": pub_preview["public_content"],
            "publisher": pub_preview["publisher"],
            "publication_terms": pub_preview["publication_terms"],
            "origin": pub_preview["origin"],
            "visibility": pub_preview["visibility"],
        });
        assert_eq!(
            jcs::jcs_sha256_hex(&preview_payload),
            pub_preview["preview_sha256"].as_str().unwrap()
        );

        // 4. Adaptation proposal JCS proposal_sha256 digest
        let mut adaptation = read_json(&examples.join("adaptation-proposal.synthetic.json"));
        let expected_proposal_sha = adaptation["proposal_sha256"]
            .as_str()
            .unwrap()
            .to_string();
        adaptation
            .as_object_mut()
            .unwrap()
            .remove("proposal_sha256");
        assert_eq!(jcs::jcs_sha256_hex(&adaptation), expected_proposal_sha);
    }

    #[test]
    fn s40_ops006_source_available_licensing_and_synthetic_catalog_boundaries() {
        let root = workspace_root();
        let license_text = std::fs::read_to_string(root.join("LICENSE-PERSONAL-USE.md"))
            .expect("LICENSE-PERSONAL-USE.md must exist");

        // Must explicitly prohibit third-party organizational deployments including noncommercial institutions
        assert!(license_text.contains("third-party organizational deployments are strictly prohibited"));
        assert!(license_text.contains("Nonprofits, foundations, or noncommercial consortia"));
        // Must explicitly state it is NOT OSI open source
        assert!(license_text.contains("NOT"));
        assert!(license_text.contains("OSI-approved open source"));
        // Must keep D15 visible as a deferred release gate
        assert!(license_text.contains("D15"));

        // Synthetic catalog must remain marked is_synthetic_fixture = true
        let synthetic_cat = read_json(
            &root.join("specs/001-curriculum-platform/examples/resource.synthetic.json"),
        );
        assert_eq!(
            synthetic_cat["provenance"]["is_synthetic_fixture"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn t01_http_concurrency_policy_classified_across_all_71_operations() {
        assert_eq!(generated::OPENAPI_OPERATIONS.len(), 71);
        for op in &generated::OPENAPI_OPERATIONS {
            if op.method == "GET" {
                assert!(
                    !op.requires_idempotency_key && !op.requires_if_match,
                    "GET operation {} must require neither Idempotency-Key nor If-Match",
                    op.operation_id
                );
            }
        }
    }
}
