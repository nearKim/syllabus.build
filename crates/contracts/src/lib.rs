//! Authoritative runtime JSON Schema Draft 2020-12 contract validation,
//! RFC 8785 JCS digest verification, and generated contract descriptors (`T00`, `NFR-002`, `NFR-005`).

pub mod error;
pub mod generated;
pub mod jcs;
pub mod registry;

pub use error::ContractValidationError;
pub use registry::{workspace_root, ContractRegistry};
