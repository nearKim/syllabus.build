//! Pure domain invariants, DAG validation, workload duration math, and three-layer
//! state separation (`ActivityExecutionState`, `Proficiency`, `ReviewScheduleItem`).
//!
//! Architectural invariant (`D12`): No HTTP, database, or AI provider SDK types
//! are permitted in `syllabus-domain`.

pub mod adaptation;
pub mod billing;
pub mod catalog;
pub mod error;
pub mod operations;
pub mod sharing;
pub mod syllabus;

pub use adaptation::*;
pub use billing::*;
pub use catalog::*;
pub use error::DomainError;
pub use operations::*;
pub use sharing::*;
pub use syllabus::*;

#[cfg(test)]
mod tests;
