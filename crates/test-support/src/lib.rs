//! Shared test fixtures and deterministic test harnesses (`T00`).

use syllabus_contracts::workspace_root;
use serde_json::Value;

/// Loads a synthetic fixture by relative filename under `specs/001-syllabus-platform/examples/`.
#[must_use]
pub fn load_synthetic_fixture(name: &str) -> Value {
    let path = workspace_root()
        .join("specs/001-syllabus-platform/examples")
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
    fn loads_canonical_synthetic_syllabus_fixture() {
        let syllabus = load_synthetic_fixture("syllabus.synthetic.json");
        assert_eq!(syllabus["schema_version"].as_str(), Some("0.2.0"));
    }
}
