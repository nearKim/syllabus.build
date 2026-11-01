//! Segregated trait ports (SPIs) and transactional store adapters (`T02`, `T03`, `T04`, ISP/DIP).

use syllabus_persistence::{
    serde_json::Value, CandidateArchiveRecord, CatalogFilterOutcome, CatalogFilterQuery,
    CatalogResourceVersionRecord, GenerationJobRecord, InMemoryTransactionalStore,
    PersistenceError, SyllabusRevisionRecord,
};
use syllabus_security::AuthenticatedPrincipal;

/// Segregated port for deterministic catalog metadata filtering and lookup (`T02`, ISP/DIP).
pub trait CatalogRetrievalPort {
    fn filter_catalog_resources(
        &self,
        query: &CatalogFilterQuery,
    ) -> Result<CatalogFilterOutcome, PersistenceError>;

    fn get_catalog_resource_version(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError>;
}

/// Segregated port for archiving raw model candidates and committing validated revisions (`T03`, ISP/DIP).
pub trait SyllabusRevisionPersistencePort {
    fn record_candidate_archive(&self, archive: CandidateArchiveRecord);

    fn commit_validated_syllabus_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        revision_id: &str,
        candidate_sha256: &str,
        payload: Value,
        initial_is_active: bool,
    ) -> Result<SyllabusRevisionRecord, PersistenceError>;
}

/// Segregated port for asynchronous generation job state transitions (`T03`, `T04`, ISP/DIP).
pub trait GenerationJobRepositoryPort {
    fn upsert_generation_job(&self, job: GenerationJobRecord);

    fn get_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError>;
}

impl CatalogRetrievalPort for InMemoryTransactionalStore {
    fn filter_catalog_resources(
        &self,
        query: &CatalogFilterQuery,
    ) -> Result<CatalogFilterOutcome, PersistenceError> {
        InMemoryTransactionalStore::filter_catalog_resources(self, query)
    }

    fn get_catalog_resource_version(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        InMemoryTransactionalStore::get_catalog_resource_version(self, resource_version_id)
    }
}

impl SyllabusRevisionPersistencePort for InMemoryTransactionalStore {
    fn record_candidate_archive(&self, archive: CandidateArchiveRecord) {
        InMemoryTransactionalStore::record_candidate_archive(self, archive);
    }

    fn commit_validated_syllabus_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        revision_id: &str,
        candidate_sha256: &str,
        payload: Value,
        initial_is_active: bool,
    ) -> Result<SyllabusRevisionRecord, PersistenceError> {
        InMemoryTransactionalStore::commit_validated_syllabus_revision(
            self,
            principal,
            syllabus_id,
            revision_id,
            candidate_sha256,
            payload,
            initial_is_active,
        )
    }
}

impl GenerationJobRepositoryPort for InMemoryTransactionalStore {
    fn upsert_generation_job(&self, job: GenerationJobRecord) {
        InMemoryTransactionalStore::upsert_generation_job(self, job);
    }

    fn get_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError> {
        InMemoryTransactionalStore::get_generation_job(self, principal, job_id)
    }
}
