//! Pure domain invariants, DAG validation, workload duration math, and three-layer
//! state separation (`ActivityExecutionState`, `Proficiency`, `ReviewScheduleItem`).
//!
//! Architectural invariant (`D12`): No HTTP, database, or AI provider SDK types
//! are permitted in `curriculum-domain`.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DomainError {
    #[error("invalid playback speed: {0} (must be finite and in 0.5..=3.0)")]
    InvalidPlaybackSpeed(String),
    #[error("component bounds unordered for `{component}`: min={min_minutes}, point={point_minutes}, max={max_minutes}")]
    UnorderedComponentBounds {
        component: String,
        min_minutes: u32,
        point_minutes: u32,
        max_minutes: u32,
    },
    #[error("unknown graph dependency `{dependency}` referenced by `{node}`")]
    UnknownDependency { node: String, dependency: String },
    #[error("cycle detected in directed acyclic graph involving nodes: {cycle_nodes:?}")]
    GraphCycleDetected { cycle_nodes: Vec<String> },
    #[error("duplicate identifier `{0}`")]
    DuplicateIdentifier(String),
    #[error("proficiency invariant violation: {0}")]
    ProficiencyInvariantViolation(String),
}

/// Bounds (`min_minutes <= point_minutes <= max_minutes`) for a single workload component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffortTriplet {
    pub min_minutes: u32,
    pub point_minutes: u32,
    pub max_minutes: u32,
}

impl EffortTriplet {
    pub fn validate(&self, component: &str) -> Result<(), DomainError> {
        if self.min_minutes <= self.point_minutes && self.point_minutes <= self.max_minutes {
            Ok(())
        } else {
            Err(DomainError::UnorderedComponentBounds {
                component: component.to_string(),
                min_minutes: self.min_minutes,
                point_minutes: self.point_minutes,
                max_minutes: self.max_minutes,
            })
        }
    }
}

/// Five-component effort breakdown per activity (`SCHED-001`, `@S20`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityComponentBreakdown {
    pub media: EffortTriplet,
    pub reading: EffortTriplet,
    pub practice: EffortTriplet,
    pub assessment: EffortTriplet,
    pub review: EffortTriplet,
}

impl ActivityComponentBreakdown {
    pub fn validate_bounds(&self) -> Result<(), DomainError> {
        self.media.validate("media")?;
        self.reading.validate("reading")?;
        self.practice.validate("practice")?;
        self.assessment.validate("assessment")?;
        self.review.validate("review")?;
        Ok(())
    }

    /// Computes adjusted `(min, point, max)` effort in integer minutes using the canonical
    /// ceiling formula (`SCHED-001`, `@S20`):
    /// `ceil(media / playback_speed + reading + practice + assessment + review)`
    /// Playback speed scales **only** `media` duration and never compresses reading,
    /// practice, assessment, or spaced review.
    pub fn adjusted_effort(&self, playback_speed: f64) -> Result<EffortTriplet, DomainError> {
        if !playback_speed.is_finite() || !(0.5..=3.0).contains(&playback_speed) {
            return Err(DomainError::InvalidPlaybackSpeed(format!(
                "{playback_speed}"
            )));
        }
        self.validate_bounds()?;

        let calc = |media: u32, reading: u32, practice: u32, assessment: u32, review: u32| -> u32 {
            let scaled_media = (media as f64) / playback_speed;
            let non_media = (reading + practice + assessment + review) as f64;
            (scaled_media + non_media).ceil() as u32
        };

        Ok(EffortTriplet {
            min_minutes: calc(
                self.media.min_minutes,
                self.reading.min_minutes,
                self.practice.min_minutes,
                self.assessment.min_minutes,
                self.review.min_minutes,
            ),
            point_minutes: calc(
                self.media.point_minutes,
                self.reading.point_minutes,
                self.practice.point_minutes,
                self.assessment.point_minutes,
                self.review.point_minutes,
            ),
            max_minutes: calc(
                self.media.max_minutes,
                self.reading.max_minutes,
                self.practice.max_minutes,
                self.assessment.max_minutes,
                self.review.max_minutes,
            ),
        })
    }
}

/// Validates that a directed graph `node -> prerequisites` has unique nodes,
/// resolvable prerequisite references, and zero cycles using Kahn's algorithm.
pub fn validate_dag_acyclic(
    edges: &[(String, Vec<String>)],
) -> Result<Vec<String>, DomainError> {
    let mut node_set = BTreeSet::new();
    for (node, _) in edges {
        if !node_set.insert(node.clone()) {
            return Err(DomainError::DuplicateIdentifier(node.clone()));
        }
    }

    let mut in_degree: BTreeMap<String, usize> = BTreeMap::new();
    let mut dependents: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for (node, prereqs) in edges {
        in_degree.entry(node.clone()).or_insert(0);
        for prereq in prereqs {
            if !node_set.contains(prereq) {
                return Err(DomainError::UnknownDependency {
                    node: node.clone(),
                    dependency: prereq.clone(),
                });
            }
            *in_degree.entry(node.clone()).or_insert(0) += 1;
            dependents
                .entry(prereq.clone())
                .or_default()
                .push(node.clone());
        }
    }

    let mut queue: VecDeque<String> = in_degree
        .iter()
        .filter_map(|(k, &deg)| if deg == 0 { Some(k.clone()) } else { None })
        .collect();

    let mut topo_order = Vec::with_capacity(edges.len());
    while let Some(curr) = queue.pop_front() {
        topo_order.push(curr.clone());
        if let Some(children) = dependents.get(&curr) {
            for child in children {
                if let Some(deg) = in_degree.get_mut(child) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(child.clone());
                    }
                }
            }
        }
    }

    if topo_order.len() != edges.len() {
        let cycle_nodes: Vec<String> = in_degree
            .into_iter()
            .filter_map(|(n, deg)| if deg > 0 { Some(n) } else { None })
            .collect();
        return Err(DomainError::GraphCycleDetected { cycle_nodes });
    }

    Ok(topo_order)
}

/// Layer 1: Activity execution state (`PROG-002`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityExecutionStatus {
    NotStarted,
    InProgress,
    SelfReportedCompleted,
    Completed,
    Waived,
}

/// Layer 2: Objective proficiency evidence state (`PED-004`, `PED-006`, `PROG-002`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveProficiencyState {
    Unassessed,
    SelfReported,
    InProgress,
    NeedsReview,
    Demonstrated,
}

/// Evidence source attempting to update objective proficiency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceOrigin {
    SelfReportedActivityCompletion,
    FormativePracticeCompletion,
    UnverifiedDiagnosticClaim,
    ReviewedAnchorAssessmentPass { independent_performance: bool },
}

/// Enforces the canonical separation between activity completion and objective proficiency:
/// neither `self_reported_completed` nor formative practice can ever yield `Demonstrated`.
pub fn derive_proficiency_transition(
    current: ObjectiveProficiencyState,
    origin: EvidenceOrigin,
) -> Result<ObjectiveProficiencyState, DomainError> {
    match origin {
        EvidenceOrigin::SelfReportedActivityCompletion => Ok(match current {
            ObjectiveProficiencyState::Demonstrated => ObjectiveProficiencyState::Demonstrated,
            ObjectiveProficiencyState::NeedsReview => ObjectiveProficiencyState::NeedsReview,
            ObjectiveProficiencyState::InProgress => ObjectiveProficiencyState::InProgress,
            ObjectiveProficiencyState::Unassessed | ObjectiveProficiencyState::SelfReported => {
                ObjectiveProficiencyState::SelfReported
            }
        }),
        EvidenceOrigin::FormativePracticeCompletion => Ok(match current {
            ObjectiveProficiencyState::Demonstrated => ObjectiveProficiencyState::Demonstrated,
            ObjectiveProficiencyState::NeedsReview => ObjectiveProficiencyState::NeedsReview,
            _ => ObjectiveProficiencyState::InProgress,
        }),
        EvidenceOrigin::UnverifiedDiagnosticClaim => Ok(match current {
            ObjectiveProficiencyState::Demonstrated => ObjectiveProficiencyState::Demonstrated,
            _ => ObjectiveProficiencyState::SelfReported,
        }),
        EvidenceOrigin::ReviewedAnchorAssessmentPass {
            independent_performance: true,
        } => Ok(ObjectiveProficiencyState::Demonstrated),
        EvidenceOrigin::ReviewedAnchorAssessmentPass {
            independent_performance: false,
        } => Ok(ObjectiveProficiencyState::InProgress),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s20_playback_speed_scales_only_media_with_ceiling_rounding() {
        // @S20: 60m media + 50m reading + 45m practice + 30m assessment + 15m review = 200m at 1.0x
        // At 2.0x playback speed, media becomes 30m -> 170m total.
        let breakdown = ActivityComponentBreakdown {
            media: EffortTriplet {
                min_minutes: 50,
                point_minutes: 60,
                max_minutes: 70,
            },
            reading: EffortTriplet {
                min_minutes: 40,
                point_minutes: 50,
                max_minutes: 60,
            },
            practice: EffortTriplet {
                min_minutes: 35,
                point_minutes: 45,
                max_minutes: 60,
            },
            assessment: EffortTriplet {
                min_minutes: 20,
                point_minutes: 30,
                max_minutes: 40,
            },
            review: EffortTriplet {
                min_minutes: 10,
                point_minutes: 15,
                max_minutes: 20,
            },
        };

        let at_1x = breakdown.adjusted_effort(1.0).expect("valid 1.0x");
        assert_eq!(at_1x.point_minutes, 200);

        let at_2x = breakdown.adjusted_effort(2.0).expect("valid 2.0x");
        assert_eq!(at_2x.point_minutes, 170);
        assert_eq!(at_2x.min_minutes, 130);
        assert_eq!(at_2x.max_minutes, 215);
    }

    #[test]
    fn dag_validator_accepts_acyclic_and_rejects_cycles() {
        let acyclic = vec![
            ("obj-1".to_string(), vec![]),
            ("obj-2".to_string(), vec!["obj-1".to_string()]),
            ("obj-3".to_string(), vec!["obj-2".to_string()]),
        ];
        let order = validate_dag_acyclic(&acyclic).expect("acyclic graph should pass");
        assert_eq!(order, vec!["obj-1", "obj-2", "obj-3"]);

        let cyclic = vec![
            ("obj-1".to_string(), vec!["obj-3".to_string()]),
            ("obj-2".to_string(), vec!["obj-1".to_string()]),
            ("obj-3".to_string(), vec!["obj-2".to_string()]),
        ];
        let err = validate_dag_acyclic(&cyclic).expect_err("cycle must fail");
        assert!(matches!(err, DomainError::GraphCycleDetected { .. }));
    }

    #[test]
    fn self_reported_and_formative_completion_never_create_demonstrated_proficiency() {
        let s1 = derive_proficiency_transition(
            ObjectiveProficiencyState::Unassessed,
            EvidenceOrigin::SelfReportedActivityCompletion,
        )
        .unwrap();
        assert_eq!(s1, ObjectiveProficiencyState::SelfReported);

        let s2 = derive_proficiency_transition(s1, EvidenceOrigin::FormativePracticeCompletion)
            .unwrap();
        assert_eq!(s2, ObjectiveProficiencyState::InProgress);

        let assisted = derive_proficiency_transition(
            s2,
            EvidenceOrigin::ReviewedAnchorAssessmentPass {
                independent_performance: false,
            },
        )
        .unwrap();
        assert_eq!(assisted, ObjectiveProficiencyState::InProgress);

        let demonstrated = derive_proficiency_transition(
            assisted,
            EvidenceOrigin::ReviewedAnchorAssessmentPass {
                independent_performance: true,
            },
        )
        .unwrap();
        assert_eq!(demonstrated, ObjectiveProficiencyState::Demonstrated);
    }
}
