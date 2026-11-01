//! Contract validation and schema compilation error types.

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
    #[error("schema SHA-256 drift detected for `{schema_name}`: expected `{expected_sha256}`, got `{actual_sha256}`")]
    SchemaDigestDrift {
        schema_name: String,
        expected_sha256: String,
        actual_sha256: String,
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
