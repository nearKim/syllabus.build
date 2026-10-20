//! Background job worker binary (`T00` baseline scaffold).

use curriculum_contracts::ContractRegistry;
use curriculum_jobs::OutboxQueueConfig;
use curriculum_providers::{DeterministicFakeProvider, InferenceProvider};

pub fn verify_worker_bootstrap() -> OutboxQueueConfig {
    let _registry = ContractRegistry::load_from_workspace()
        .expect("contract registry must load cleanly on worker bootstrap");
    let fake_provider = DeterministicFakeProvider::default();
    assert_eq!(fake_provider.capabilities().provider_id, "deterministic-fake");
    OutboxQueueConfig::default()
}

#[tokio::main]
async fn main() {
    let cfg = verify_worker_bootstrap();
    println!(
        "curriculum-worker bootstrap verified (lease={}s, max_attempts={})",
        cfg.lease_duration_seconds, cfg.max_attempts
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_bootstrap_verifies_contracts_and_provider_capabilities() {
        let cfg = verify_worker_bootstrap();
        assert_eq!(cfg.lease_duration_seconds, 60);
    }
}
