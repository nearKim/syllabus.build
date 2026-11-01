//! Learner goal intake, heuristic parsing, time feasibility, and specification generation (`T03`, `GOAL-001`..`GOAL-005`).

use serde::{Deserialize, Serialize};
use syllabus_contracts::ContractRegistry;
use syllabus_domain::GoalSpecification;
use syllabus_persistence::{
    serde_json::{json, Value},
    PersistenceError,
};

/// Output of goal interpretation and clarification (`T03`, `GOAL-001`..`GOAL-005`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoalInterpretationResult {
    pub goal_specification: GoalSpecification,
    pub feasibility_status: String,
    pub recovery_options: Vec<String>,
    pub normalized_generation_request: Value,
}

/// Strongly-typed value object representing a learner's goal intake request.
/// Encapsulates field normalization, alias resolution, defaults, and invariant checks (`introduce-value-objects`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalIntakeInput {
    pub prompt: String,
    pub target_role_or_outcome: String,
    pub prior_background_level: String,
    pub weekly_available_minutes: u32,
    pub horizon_weeks: u32,
    pub free_only: bool,
    pub budget_currency: String,
    pub max_budget_minor_units: u64,
    pub owned_subscription_ids: Vec<String>,
    pub allow_paid_fallback: bool,
    pub include_optional_certification: bool,
    pub explicit_constraints_omitted: bool,
}

impl GoalIntakeInput {
    /// Constructs a `GoalIntakeInput` by extracting and normalizing fields from an untrusted JSON payload.
    /// Handles legacy aliases (`topic`, `goal_text`, `generation_options.planning_horizon_days`, etc.).
    pub fn from_value(raw: &Value) -> Result<Self, PersistenceError> {
        let prompt = raw
            .get("goal")
            .and_then(|g| {
                if let Some(s) = g.as_str() {
                    Some(s)
                } else {
                    g.get("prompt").and_then(|p| p.as_str())
                }
            })
            .or_else(|| raw.get("topic").and_then(|v| v.as_str()))
            .or_else(|| raw.get("prompt").and_then(|v| v.as_str()))
            .or_else(|| raw.get("goal_text").and_then(|v| v.as_str()))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                PersistenceError::Validation(
                    "goal prompt or topic is required and cannot be empty".to_string(),
                )
            })?
            .to_string();

        let target_role_or_outcome = raw
            .get("target_role_or_outcome")
            .and_then(|v| v.as_str())
            .or_else(|| {
                raw.get("goal")
                    .and_then(|g| g.get("desired_outcomes"))
                    .and_then(|arr| arr.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.as_str())
            })
            .unwrap_or(
                "Build and evaluate a retrieval-augmented generation (RAG) pipeline in Python",
            )
            .to_string();

        let prior_background_level = raw
            .get("prior_background_level")
            .and_then(|v| v.as_str())
            .or_else(|| {
                raw.get("learner_profile")
                    .and_then(|lp| lp.get("experience_level"))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("intermediate")
            .to_string();

        let weekly_available_minutes = raw
            .get("weekly_available_minutes")
            .and_then(|v| v.as_u64())
            .or_else(|| raw.get("weekly_minutes").and_then(|v| v.as_u64()))
            .or_else(|| {
                raw.get("constraints")
                    .and_then(|c| c.get("weekly_minutes"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(180) as u32;

        if weekly_available_minutes == 0 {
            return Err(PersistenceError::Validation(
                "weekly_available_minutes must be at least 1".to_string(),
            ));
        }

        let horizon_weeks = raw
            .get("horizon_weeks")
            .and_then(|v| v.as_u64())
            .or_else(|| raw.get("target_weeks").and_then(|v| v.as_u64()))
            .or_else(|| {
                raw.get("generation_options")
                    .and_then(|o| o.get("planning_horizon_days"))
                    .and_then(|v| v.as_u64())
                    .map(|days| days.max(7) / 7)
            })
            .unwrap_or(4)
            .max(1) as u32;

        let free_only = raw
            .get("free_only")
            .and_then(|v| v.as_bool())
            .or_else(|| {
                raw.get("access_policy")
                    .and_then(|ap| ap.get("mode"))
                    .and_then(|v| v.as_str())
                    .map(|m| m == "free_only")
            })
            .unwrap_or(true);

        let budget_currency = raw
            .get("budget_currency")
            .and_then(|v| v.as_str())
            .or_else(|| {
                raw.get("budgets")
                    .and_then(|b| b.get("materials"))
                    .and_then(|m| m.get("currency"))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("USD")
            .to_string();

        let max_budget_minor_units = raw
            .get("max_budget_minor_units")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                raw.get("budgets")
                    .and_then(|b| b.get("materials"))
                    .and_then(|m| m.get("max_minor_units"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(if free_only { 0 } else { 10_000 });

        let owned_subscription_ids: Vec<String> = raw
            .get("owned_subscription_ids")
            .or_else(|| {
                raw.get("access_policy")
                    .and_then(|ap| ap.get("owned_subscription_ids"))
            })
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let allow_paid_fallback = raw
            .get("allow_paid_fallback")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let include_optional_certification = raw
            .get("include_optional_certification")
            .or_else(|| {
                raw.get("generation_options")
                    .and_then(|go| go.get("include_optional_certification"))
            })
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let explicit_constraints_omitted =
            raw.get("weekly_available_minutes").is_none() && raw.get("constraints").is_none();

        Ok(Self {
            prompt,
            target_role_or_outcome,
            prior_background_level,
            weekly_available_minutes,
            horizon_weeks,
            free_only,
            budget_currency,
            max_budget_minor_units,
            owned_subscription_ids,
            allow_paid_fallback,
            include_optional_certification,
            explicit_constraints_omitted,
        })
    }

    /// Derives canonical topic identifier from prompt heuristics.
    #[must_use]
    pub fn derive_topic(&self) -> String {
        let prompt_lower = self.prompt.to_ascii_lowercase();
        if prompt_lower.contains("rag")
            || prompt_lower.contains("token")
            || prompt_lower.contains("retrieval")
            || prompt_lower.contains("python")
        {
            "rag-python".to_string()
        } else {
            self.prompt.clone()
        }
    }

    /// Generates default objectives for the derived topic.
    #[must_use]
    pub fn derive_proposed_objectives(&self, topic: &str) -> Vec<String> {
        if topic == "rag-python" {
            vec![
                "objective-tokenization".to_string(),
                "objective-vector-retrieval".to_string(),
                "objective-rag-evaluation".to_string(),
            ]
        } else {
            vec![format!(
                "objective-{}",
                topic
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() {
                        c.to_ascii_lowercase()
                    } else {
                        '-'
                    })
                    .collect::<String>()
                    .trim_matches('-')
            )]
        }
    }

    /// Generates clarifying questions if the prompt is underspecified or constraints were omitted (`@S01`).
    #[must_use]
    pub fn generate_clarifying_questions(&self) -> Vec<String> {
        let mut clarifying_questions = Vec::new();
        let prompt_lower = self.prompt.to_ascii_lowercase();
        if self.prompt.split_whitespace().count() <= 3
            || prompt_lower == "learn ai"
            || prompt_lower == "machine learning"
            || prompt_lower == "python"
        {
            clarifying_questions.push(
                "Which concrete application focus do you want first (e.g., RAG document retrieval in Python vs. model fine-tuning)?"
                    .to_string(),
            );
            clarifying_questions.push(
                "What is your current Python and linear algebra comfort level (beginner, intermediate, or advanced)?"
                    .to_string(),
            );
        }
        if self.explicit_constraints_omitted {
            clarifying_questions.push(
                "How many minutes per week can you realistically dedicate to reading, coding practice, and assessments?"
                    .to_string(),
            );
        }
        clarifying_questions
    }

    /// Evaluates time budget feasibility and provides recovery options when infeasible (`@S02`).
    #[must_use]
    pub fn evaluate_feasibility(&self) -> (String, Option<String>, Vec<String>) {
        let total_available_minutes = self
            .weekly_available_minutes
            .saturating_mul(self.horizon_weeks);
        let minimum_required_minutes = 48u32;
        if total_available_minutes < minimum_required_minutes {
            (
                "infeasible".to_string(),
                Some(format!(
                    "Available study budget ({total_available_minutes} minutes across {} weeks) is below minimum required triad effort ({minimum_required_minutes} minutes).",
                    self.horizon_weeks
                )),
                vec![
                    "reduced_scope".to_string(),
                    "extended_time".to_string(),
                    "increased_availability".to_string(),
                ],
            )
        } else {
            ("feasible".to_string(), None, Vec::new())
        }
    }

    /// Assembles and contract-validates the normalized `generation-request.schema.json` document.
    pub fn build_normalized_generation_request(&self) -> Result<Value, PersistenceError> {
        let exp_level = match self.prior_background_level.as_str() {
            "beginner" | "intermediate" | "advanced" => self.prior_background_level.as_str(),
            _ => "intermediate",
        };

        let normalized = json!({
            "schema_version": "0.2.0",
            "goal": {
                "prompt": self.prompt,
                "desired_outcomes": [self.target_role_or_outcome],
                "scope_mode": "focused",
                "target_certification_ids": []
            },
            "learner_profile": {
                "experience_level": exp_level,
                "background_summary": format!("Learner background: {}", self.prior_background_level),
                "self_reported_known_objective_ids": [],
                "diagnostic_result_refs": [],
                "preferred_language": "en",
                "accessibility_needs": ["captions"],
                "topic_self_reports": [],
                "proficiency_snapshot_ref": null
            },
            "constraints": {
                "weekly_minutes": self.weekly_available_minutes.max(30),
                "start_date": "2026-10-26",
                "target_end_date": "2026-11-23",
                "deadline_policy": "flexible",
                "timezone": "UTC",
                "available_slots": [],
                "max_session_minutes": self.weekly_available_minutes.clamp(30, 60),
                "sequence_preference": "balanced",
                "guidance_preference": "guided",
                "preferred_resource_types": ["article", "documentation", "repository"]
            },
            "access_policy": {
                "mode": if self.free_only { "free_only" } else { "bounded_budget" },
                "owned_resource_ids": [],
                "owned_subscription_ids": self.owned_subscription_ids,
                "unknown_price_policy": "exclude",
                "allow_trial_required_resources": !self.free_only,
                "region": "US"
            },
            "budgets": {
                "materials": {
                    "currency": self.budget_currency,
                    "max_minor_units": self.max_budget_minor_units
                },
                "compute": {
                    "currency": self.budget_currency,
                    "max_minor_units": 0
                },
                "inference": {
                    "currency": self.budget_currency,
                    "max_minor_units": 100
                }
            },
            "inference": {
                "mode": "hosted",
                "model_policy_id": "synthetic-model-policy"
            },
            "generation_options": {
                "include_optional_certification": self.include_optional_certification,
                "playback_speed": 1,
                "planning_horizon_days": self.horizon_weeks * 7,
                "include_hands_on": true
            },
            "instruction_preferences": {
                "math_depth": "applied",
                "topic_math_depth_overrides": [],
                "known_material_review": "condensed"
            },
            "template_origin": null
        });

        let registry =
            ContractRegistry::global().map_err(|e| PersistenceError::Validation(e.to_string()))?;
        registry
            .validate("generation-request.schema.json", &normalized)
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        Ok(normalized)
    }
}

/// Core domain function accepting strongly-typed `GoalIntakeInput` (`introduce-value-objects`).
pub fn interpret_goal_intake(
    input: &GoalIntakeInput,
) -> Result<GoalInterpretationResult, PersistenceError> {
    let topic = input.derive_topic();
    let proposed_objectives = input.derive_proposed_objectives(&topic);
    let clarifying_questions = input.generate_clarifying_questions();
    let (feasibility_status, feasibility_warning, recovery_options) = input.evaluate_feasibility();
    let normalized_generation_request = input.build_normalized_generation_request()?;

    let goal_specification = GoalSpecification {
        topic,
        target_role_or_outcome: input.target_role_or_outcome.clone(),
        prior_background_level: input.prior_background_level.clone(),
        weekly_available_minutes: input.weekly_available_minutes,
        horizon_weeks: input.horizon_weeks,
        free_only: input.free_only,
        budget_currency: input.budget_currency.clone(),
        max_budget_minor_units: input.max_budget_minor_units,
        owned_subscription_ids: input.owned_subscription_ids.clone(),
        allow_paid_fallback: input.allow_paid_fallback,
        include_optional_certification: input.include_optional_certification,
        clarifying_questions,
        proposed_objectives,
        feasibility_warning,
    };

    Ok(GoalInterpretationResult {
        goal_specification,
        feasibility_status,
        recovery_options,
        normalized_generation_request,
    })
}

/// Interprets a learner's free-text or structured goal intake request into a normalized
/// `GoalSpecification` and a contract-validated `generation-request.schema.json` document
/// (`T03`, `GOAL-001`..`GOAL-005`, `@S01`..`@S04`, `@S18`, `@S19`, `@S47`, `@S61`, `@S72`).
pub fn interpret_goal_request(
    raw_request: &Value,
) -> Result<GoalInterpretationResult, PersistenceError> {
    let input = GoalIntakeInput::from_value(raw_request)?;
    interpret_goal_intake(&input)
}
