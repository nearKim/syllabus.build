//! Shared test fixtures and deterministic test harnesses (`T00`).

use curriculum_contracts::workspace_root;
use serde_json::Value;

/// Loads a synthetic fixture by relative filename under `specs/001-curriculum-platform/examples/`.
#[must_use]
pub fn load_synthetic_fixture(name: &str) -> Value {
    let path = workspace_root()
        .join("specs/001-curriculum-platform/examples")
        .join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read fixture {}: {}", path.display(), e));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("failed to parse fixture {}: {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_canonical_synthetic_curriculum_fixture() {
        let curriculum = load_synthetic_fixture("curriculum.synthetic.json");
        assert_eq!(curriculum["schema_version"].as_str(), Some("0.2.0"));
    }
}
