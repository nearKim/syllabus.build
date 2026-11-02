//! Identity, account credentials, authentication sessions, passkeys, and web workspaces.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use syllabus_contracts::jcs::sha256_bytes_hex;
use syllabus_security::{AuthenticatedPrincipal, OAuthProvider, PrincipalRole, SecurityError};
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

use crate::models::{
    evaluate_if_match, AccountRecord, AuthRecoveryTokenIssued, AuthRecoveryTokenRecord,
    AuthSessionRecord, CredentialMetadataView, DeletionTombstone, LearnerProficiencyProjection,
    OAuthIdentityRecord, OAuthLoginOutcome, PersistenceError, StoredCredentialRecord,
    TombstoneEntityType, WebPasskeyRecord, WebWorkspaceRecord,
};
use crate::store::{credential_map_key, InMemoryTransactionalStore, StoreInner};

impl InMemoryTransactionalStore {
    pub fn upsert_account(&self, account: AccountRecord) {
        let mut guard = self.write_inner();
        guard
            .proficiency_by_account
            .entry(account.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: account.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });
        guard.accounts.insert(account.account_id.clone(), account);
    }

    fn ensure_proficiency_locked(guard: &mut StoreInner, account_id: &str) {
        guard
            .proficiency_by_account
            .entry(account_id.to_string())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: account_id.to_string(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });
    }

    fn issue_session_locked(
        guard: &mut StoreInner,
        seq: u64,
        account_id: String,
        roles: Vec<PrincipalRole>,
    ) -> AuthSessionRecord {
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).expect("OS random source is required for auth sessions");
        let token = sha256_bytes_hex(&random);
        let token_sha256 = sha256_bytes_hex(token.as_bytes());
        let record = AuthSessionRecord {
            session_id: format!("sess-{seq}"),
            token,
            token_sha256: token_sha256.clone(),
            account_id,
            roles,
            expires_at: (OffsetDateTime::now_utc() + Duration::hours(24))
                .format(&Rfc3339)
                .expect("UTC expiry formats as RFC 3339"),
            revoked: false,
        };
        guard
            .sessions_by_token_sha
            .insert(token_sha256, record.clone());
        record
    }

    fn normalize_email(raw: &str) -> Result<String, PersistenceError> {
        let email = raw.trim().to_ascii_lowercase();
        let mut parts = email.split('@');
        let local = parts.next().unwrap_or("");
        let domain = parts.next().unwrap_or("");
        if local.is_empty()
            || domain.is_empty()
            || !domain.contains('.')
            || parts.next().is_some()
            || email.chars().any(char::is_whitespace)
        {
            return Err(PersistenceError::Validation(
                "valid email address is required".to_string(),
            ));
        }
        Ok(email)
    }

    /// Looks up an active (non-deleted) `AccountRecord` by `account_id`.
    #[must_use]
    pub fn get_account_by_id(&self, account_id: &str) -> Option<AccountRecord> {
        let guard = self.read_inner();
        guard
            .accounts
            .get(account_id)
            .filter(|acct| acct.deleted_at_ms.is_none())
            .cloned()
    }

    /// Links or creates an account from a verified OAuth 2.0 / OIDC identity
    /// and mints a fresh `AuthSessionRecord`.
    pub fn authenticate_oauth_identity(
        &self,
        provider: OAuthProvider,
        provider_subject: &str,
        email: &str,
        email_verified: bool,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<OAuthLoginOutcome, PersistenceError> {
        let subject = provider_subject.trim();
        if subject.is_empty() {
            return Err(PersistenceError::Security(
                SecurityError::InvalidOAuthGrant("provider_subject must be non-empty".to_string()),
            ));
        }
        let normalized_email = Self::normalize_email(email)?;
        let default_username = normalized_email
            .split('@')
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let cleaned_name = display_name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or(default_username);
        let cleaned_avatar = avatar_url
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let mut guard = self.write_inner();
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let key = (provider, subject.to_string());

        // 1. Existing federated identity binding -> resolve linked account directly.
        let existing_account_id = guard
            .oauth_identities
            .get(&key)
            .map(|record| record.account_id.clone());

        let (account, is_new_account) = if let Some(acct_id) = existing_account_id {
            let Some(acct) = guard.accounts.get_mut(&acct_id) else {
                return Err(PersistenceError::Security(SecurityError::Unauthenticated));
            };
            if acct.deleted_at_ms.is_some() {
                return Err(PersistenceError::Security(SecurityError::Unauthenticated));
            }
            if acct.display_name.is_none() && cleaned_name.is_some() {
                acct.display_name.clone_from(&cleaned_name);
            }
            if acct.avatar_url.is_none() && cleaned_avatar.is_some() {
                acct.avatar_url.clone_from(&cleaned_avatar);
            }
            if email_verified {
                acct.email_verified = true;
            }
            (acct.clone(), false)
        } else if email_verified
            && guard.accounts.values().any(|a| {
                a.email.eq_ignore_ascii_case(&normalized_email) && a.deleted_at_ms.is_none()
            })
        {
            // 2. Verified email matches an active local account -> link OAuth identity seamlessly.
            let acct = guard
                .accounts
                .values_mut()
                .find(|a| {
                    a.email.eq_ignore_ascii_case(&normalized_email) && a.deleted_at_ms.is_none()
                })
                .expect("checked existence above");
            acct.email_verified = true;
            if acct.display_name.is_none() && cleaned_name.is_some() {
                acct.display_name.clone_from(&cleaned_name);
            }
            if acct.avatar_url.is_none() && cleaned_avatar.is_some() {
                acct.avatar_url.clone_from(&cleaned_avatar);
            }
            (acct.clone(), false)
        } else {
            // 3. Brand-new OAuth signup -> create a fresh account.
            let account_id = format!("usr-{seq:06}");
            let roles = vec![PrincipalRole::User];
            let acct = AccountRecord {
                account_id: account_id.clone(),
                email: normalized_email.clone(),
                email_verified,
                roles,
                display_name: cleaned_name.clone(),
                avatar_url: cleaned_avatar.clone(),
                password_hash: None,
                deleted_at_ms: None,
            };
            guard.accounts.insert(account_id.clone(), acct.clone());
            Self::ensure_proficiency_locked(&mut guard, &account_id);
            (acct, true)
        };

        guard.oauth_identities.insert(
            key,
            OAuthIdentityRecord {
                provider,
                provider_subject: subject.to_string(),
                account_id: account.account_id.clone(),
                email: normalized_email,
                display_name: cleaned_name,
                avatar_url: cleaned_avatar,
            },
        );

        let session = Self::issue_session_locked(
            &mut guard,
            seq,
            account.account_id.clone(),
            account.roles.clone(),
        );
        Ok(OAuthLoginOutcome {
            account,
            session,
            is_new_account,
            provider,
        })
    }

    pub fn resolve_session_token(
        &self,
        bearer_token: &str,
    ) -> Result<Option<AuthenticatedPrincipal>, PersistenceError> {
        if bearer_token.starts_with("sess-token-") {
            return Err(PersistenceError::Security(SecurityError::Unauthenticated));
        }
        let token_sha256 = sha256_bytes_hex(bearer_token.as_bytes());
        let guard = self.read_inner();
        if let Some(sess) = guard.sessions_by_token_sha.get(&token_sha256) {
            if sess.revoked
                || OffsetDateTime::parse(&sess.expires_at, &Rfc3339)
                    .map_or(true, |expiry| expiry <= OffsetDateTime::now_utc())
            {
                return Err(PersistenceError::Security(SecurityError::Unauthenticated));
            }
            let acct = guard
                .accounts
                .get(&sess.account_id)
                .filter(|account| account.deleted_at_ms.is_none())
                .ok_or(PersistenceError::Security(SecurityError::Unauthenticated))?;
            return Ok(Some(AuthenticatedPrincipal {
                account_id: sess.account_id.clone(),
                roles: acct.roles.clone(),
                is_development_only_identity: false,
            }));
        }
        Ok(None)
    }

    #[must_use]
    pub fn session_expiry_for_token(&self, bearer_token: &str) -> Option<String> {
        let token_sha256 = sha256_bytes_hex(bearer_token.as_bytes());
        self.read_inner()
            .sessions_by_token_sha
            .get(&token_sha256)
            .map(|session| session.expires_at.clone())
    }

    pub fn revoke_session_token(
        &self,
        bearer_token: &str,
        now_ms: u64,
    ) -> Result<(), PersistenceError> {
        let token_sha256 = sha256_bytes_hex(bearer_token.as_bytes());
        let mut guard = self.write_inner();
        if let Some(sess) = guard.sessions_by_token_sha.get_mut(&token_sha256) {
            sess.revoked = true;
            let session_id = sess.session_id.clone();
            let account_id = sess.account_id.clone();
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard.deletion_tombstones.push(DeletionTombstone {
                tombstone_id: format!("tomb-sess-{seq}"),
                entity_type: TombstoneEntityType::SessionRevoked,
                account_id,
                target_id: token_sha256,
                reason: format!("session `{session_id}` explicitly signed out"),
                recorded_at_ms: now_ms,
                applied_after_restore_at_ms: None,
            });
            Ok(())
        } else {
            Ok(())
        }
    }

    /// Creates a tenant-scoped BYOK credential record without exposing the raw secret in metadata (`@S29`, `@S66`, `@S82`).
    pub fn create_credential(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        provider_id: &str,
        label: &str,
        raw_api_key: &str,
    ) -> Result<CredentialMetadataView, PersistenceError> {
        let mut guard = self.write_inner();
        let key = credential_map_key(&principal.account_id, credential_ref);
        if guard.credentials.contains_key(&key) {
            return Err(PersistenceError::Conflict {
                code: "credential_ref_exists",
                message: format!("credential reference `{credential_ref}` already exists"),
            });
        }
        let sealed = guard.credential_vault.seal_credential(
            &principal.account_id,
            credential_ref,
            1,
            raw_api_key,
        )?;
        let masked_hint = sealed.key_last4_redacted.clone();
        let key_fingerprint_sha256 = sealed.key_fingerprint_sha256.clone();

        let record = StoredCredentialRecord {
            credential_ref: credential_ref.to_string(),
            owner_account_id: principal.account_id.clone(),
            provider_id: provider_id.to_string(),
            label: label.to_string(),
            masked_hint: masked_hint.clone(),
            key_fingerprint_sha256,
            version: 1,
            etag: "\"cred-v1\"".to_string(),
            revoked: false,
        };
        let view = CredentialMetadataView::from(&record);
        guard.credential_envelopes.insert(key.clone(), sealed);
        guard.credentials.insert(key, record);
        Ok(view)
    }

    pub fn get_credential_metadata(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
    ) -> Result<CredentialMetadataView, PersistenceError> {
        let guard = self.read_inner();
        let key = credential_map_key(&principal.account_id, credential_ref);
        let record = guard
            .credentials
            .get(&key)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credential",
                resource_id: credential_ref.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        if record.revoked {
            return Err(PersistenceError::NotFound {
                resource_type: "credential",
                resource_id: credential_ref.to_string(),
            });
        }
        Ok(CredentialMetadataView::from(record))
    }

    pub fn revoke_credential(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        if_match: Option<&str>,
        now_ms: u64,
    ) -> Result<(), PersistenceError> {
        let mut guard = self.write_inner();
        let key = credential_map_key(&principal.account_id, credential_ref);
        let record = guard
            .credentials
            .get_mut(&key)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credential",
                resource_id: credential_ref.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        evaluate_if_match(if_match, &record.etag)?;
        record.revoked = true;
        let owner_account_id = record.owner_account_id.clone();

        guard.next_seq += 1;
        let seq = guard.next_seq;
        guard.deletion_tombstones.push(DeletionTombstone {
            tombstone_id: format!("tomb-cred-{seq}"),
            entity_type: TombstoneEntityType::CredentialRevoked,
            account_id: owner_account_id,
            target_id: credential_ref.to_string(),
            reason: "learner revoked credential".to_string(),
            recorded_at_ms: now_ms,
            applied_after_restore_at_ms: None,
        });
        Ok(())
    }

    /// Marks an account deleted and appends an immutable `AccountDeleted` tombstone (`@S43`, `@S45`, `OPS-004`).
    pub fn delete_account(
        &self,
        principal: &AuthenticatedPrincipal,
        target_account_id: &str,
        now_ms: u64,
    ) -> Result<(), PersistenceError> {
        principal.require_learner_ownership(target_account_id)?;
        let mut guard = self.write_inner();
        if let Some(acct) = guard.accounts.get_mut(target_account_id) {
            acct.deleted_at_ms = Some(now_ms);
        }
        for cred in guard.credentials.values_mut() {
            if cred.owner_account_id == target_account_id {
                cred.revoked = true;
            }
        }
        for sess in guard.sessions_by_token_sha.values_mut() {
            if sess.account_id == target_account_id {
                sess.revoked = true;
            }
        }
        guard.next_seq += 1;
        let seq = guard.next_seq;
        guard.deletion_tombstones.push(DeletionTombstone {
            tombstone_id: format!("tomb-acct-{seq}"),
            entity_type: TombstoneEntityType::AccountDeleted,
            account_id: target_account_id.to_string(),
            target_id: target_account_id.to_string(),
            reason: "learner requested account deletion".to_string(),
            recorded_at_ms: now_ms,
            applied_after_restore_at_ms: None,
        });
        Ok(())
    }

    #[must_use]
    pub fn get_web_workspace(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Option<WebWorkspaceRecord> {
        let guard = self.read_inner();
        guard.web_workspaces.get(&principal.account_id).cloned()
    }

    pub fn put_web_workspace(
        &self,
        principal: &AuthenticatedPrincipal,
        workspace_json: Value,
        expected_revision: Option<u64>,
        now_ms: u64,
    ) -> Result<WebWorkspaceRecord, PersistenceError> {
        if !workspace_json.is_object() {
            return Err(PersistenceError::Validation(
                "workspace_json must be a JSON object".to_string(),
            ));
        }
        let mut guard = self.write_inner();
        let email = guard
            .accounts
            .get(&principal.account_id)
            .filter(|a| a.deleted_at_ms.is_none())
            .map(|a| a.email.clone())
            .unwrap_or_else(|| format!("{}@syllabus.local", principal.account_id));

        let current_rev = guard
            .web_workspaces
            .get(&principal.account_id)
            .map(|w| w.revision)
            .unwrap_or(0);
        if let Some(expected) = expected_revision {
            if expected != current_rev {
                return Err(PersistenceError::PreconditionFailed {
                    expected_etag: format!("\"ws-v{expected}\""),
                    actual_etag: format!("\"ws-v{current_rev}\""),
                });
            }
        }
        let record = WebWorkspaceRecord {
            account_id: principal.account_id.clone(),
            email,
            workspace_json,
            revision: current_rev + 1,
            updated_at_ms: now_ms,
        };
        guard
            .web_workspaces
            .insert(principal.account_id.clone(), record.clone());
        Ok(record)
    }

    pub fn delete_web_workspace(&self, principal: &AuthenticatedPrincipal) -> bool {
        let mut guard = self.write_inner();
        guard.web_workspaces.remove(&principal.account_id).is_some()
    }

    pub fn update_account_profile(
        &self,
        principal: &AuthenticatedPrincipal,
        email: Option<&str>,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<AccountRecord, PersistenceError> {
        let normalized_email_opt = match email.map(str::trim).filter(|s| !s.is_empty()) {
            Some(raw) => Some(Self::normalize_email(raw)?),
            None => None,
        };

        let mut guard = self.write_inner();
        if let Some(ref next_email) = normalized_email_opt {
            let conflict = guard.accounts.values().any(|a| {
                a.account_id != principal.account_id
                    && a.deleted_at_ms.is_none()
                    && a.email.eq_ignore_ascii_case(next_email)
            });
            if conflict {
                return Err(PersistenceError::Conflict {
                    code: "email_already_in_use",
                    message: format!("email `{next_email}` is already bound to another account"),
                });
            }
        }

        let acct = guard
            .accounts
            .get_mut(&principal.account_id)
            .filter(|a| a.deleted_at_ms.is_none())
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "account",
                resource_id: principal.account_id.clone(),
            })?;

        if let Some(next_email) = normalized_email_opt {
            if !acct.email.eq_ignore_ascii_case(&next_email) {
                acct.email = next_email.clone();
                acct.email_verified = false;
            }
        }
        if let Some(name) = display_name {
            let trimmed = name.trim();
            acct.display_name = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
        }
        if let Some(avatar) = avatar_url {
            let trimmed = avatar.trim();
            acct.avatar_url = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
        }
        let updated = acct.clone();
        if let Some(ws) = guard.web_workspaces.get_mut(&principal.account_id) {
            ws.email = updated.email.clone();
        }
        for pk in guard.web_passkeys.values_mut() {
            if pk.account_id == principal.account_id {
                pk.email = updated.email.clone();
            }
        }
        Ok(updated)
    }

    #[must_use]
    pub fn list_web_passkeys(&self, principal: &AuthenticatedPrincipal) -> Vec<WebPasskeyRecord> {
        let guard = self.read_inner();
        guard
            .web_passkeys
            .values()
            .filter(|p| p.account_id == principal.account_id)
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn list_web_passkeys_by_email(&self, email: &str) -> Vec<WebPasskeyRecord> {
        let trimmed = email.trim();
        let guard = self.read_inner();
        guard
            .web_passkeys
            .values()
            .filter(|p| trimmed.is_empty() || p.email.eq_ignore_ascii_case(trimmed))
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn get_web_passkey_by_credential_id(
        &self,
        credential_id: &str,
    ) -> Option<WebPasskeyRecord> {
        let guard = self.read_inner();
        guard.web_passkeys.get(credential_id).cloned()
    }

    pub fn put_web_passkey(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_id: &str,
        credential_json: Value,
        now_ms: u64,
    ) -> Result<WebPasskeyRecord, PersistenceError> {
        let cred_id = credential_id.trim();
        if cred_id.is_empty() {
            return Err(PersistenceError::Validation(
                "credential_id must be non-empty".to_string(),
            ));
        }
        let mut guard = self.write_inner();
        if let Some(existing) = guard.web_passkeys.get(cred_id) {
            if existing.account_id != principal.account_id {
                return Err(PersistenceError::Security(
                    SecurityError::CrossTenantAccessDenied {
                        principal_id: principal.account_id.clone(),
                        owner_id: existing.account_id.clone(),
                    },
                ));
            }
        }
        let email = guard
            .accounts
            .get(&principal.account_id)
            .map(|a| a.email.clone())
            .unwrap_or_else(|| format!("{}@syllabus.local", principal.account_id));
        let rec = WebPasskeyRecord {
            credential_id: cred_id.to_string(),
            account_id: principal.account_id.clone(),
            email,
            credential_json,
            updated_at_ms: now_ms,
        };
        guard.web_passkeys.insert(cred_id.to_string(), rec.clone());
        Ok(rec)
    }

    pub fn delete_web_passkey(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_id: &str,
    ) -> Result<bool, PersistenceError> {
        let mut guard = self.write_inner();
        if let Some(existing) = guard.web_passkeys.get(credential_id) {
            principal.require_learner_ownership(&existing.account_id)?;
        } else {
            return Ok(false);
        }
        Ok(guard.web_passkeys.remove(credential_id).is_some())
    }

    pub fn create_passkey_session(
        &self,
        credential_id: &str,
        updated_counter: Option<u64>,
        now_ms: u64,
    ) -> Result<(AccountRecord, AuthSessionRecord), PersistenceError> {
        let mut guard = self.write_inner();
        let account_id = {
            let pk = guard
                .web_passkeys
                .get_mut(credential_id)
                .ok_or(PersistenceError::Security(SecurityError::Unauthenticated))?;
            if let Some(counter) = updated_counter {
                if let Some(obj) = pk.credential_json.as_object_mut() {
                    obj.insert("counter".to_string(), json!(counter));
                }
                pk.updated_at_ms = now_ms;
            }
            pk.account_id.clone()
        };
        let acct = guard
            .accounts
            .get(&account_id)
            .filter(|a| a.deleted_at_ms.is_none())
            .cloned()
            .ok_or(PersistenceError::Security(SecurityError::Unauthenticated))?;
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let session = Self::issue_session_locked(
            &mut guard,
            seq,
            acct.account_id.clone(),
            acct.roles.clone(),
        );
        Ok((acct, session))
    }

    fn generate_recovery_code(seq: u64, account_id: &str, purpose: &str, now_ms: u64) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let entropy = format!("recovery-v1|{seq}|{account_id}|{purpose}|{now_ms}|{nanos}");
        let digest = sha256_bytes_hex(entropy.as_bytes());
        let num = u32::from_str_radix(&digest[..8], 16).unwrap_or(100_000) % 900_000 + 100_000;
        format!("{num:06}")
    }

    pub fn issue_email_verification_token(
        &self,
        principal: &AuthenticatedPrincipal,
        now_ms: u64,
        ttl_ms: u64,
    ) -> Result<AuthRecoveryTokenIssued, PersistenceError> {
        let mut guard = self.write_inner();
        let acct = guard
            .accounts
            .get(&principal.account_id)
            .filter(|a| a.deleted_at_ms.is_none())
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "account",
                resource_id: principal.account_id.clone(),
            })?;
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let code =
            Self::generate_recovery_code(seq, &acct.account_id, "email_verification", now_ms);
        let token_key = format!("email_verification:{code}");
        let token_sha256 = sha256_bytes_hex(token_key.as_bytes());
        let expires_at_ms = now_ms.saturating_add(ttl_ms);

        guard.auth_recovery_tokens.insert(
            token_sha256.clone(),
            AuthRecoveryTokenRecord {
                token_sha256,
                account_id: acct.account_id.clone(),
                email: acct.email.clone(),
                purpose: "email_verification".to_string(),
                expires_at_ms,
                consumed_at_ms: None,
            },
        );
        Ok(AuthRecoveryTokenIssued {
            token: code,
            account_id: acct.account_id,
            email: acct.email,
            purpose: "email_verification".to_string(),
            expires_at_ms,
        })
    }

    pub fn confirm_email_verification_token(
        &self,
        token: &str,
        now_ms: u64,
    ) -> Result<AccountRecord, PersistenceError> {
        let cleaned = token.trim();
        if cleaned.is_empty() {
            return Err(PersistenceError::Validation(
                "verification token is required".to_string(),
            ));
        }
        let mut guard = self.write_inner();
        let token_key = format!("email_verification:{cleaned}");
        let token_sha256 = sha256_bytes_hex(token_key.as_bytes());

        let (account_id, verified_email) = {
            let rec = guard
                .auth_recovery_tokens
                .get_mut(&token_sha256)
                .ok_or(PersistenceError::Security(SecurityError::Unauthenticated))?;
            if rec.consumed_at_ms.is_some()
                || rec.expires_at_ms < now_ms
                || rec.purpose != "email_verification"
            {
                return Err(PersistenceError::Security(SecurityError::Unauthenticated));
            }
            rec.consumed_at_ms = Some(now_ms);
            (rec.account_id.clone(), rec.email.clone())
        };

        let acct = guard
            .accounts
            .get_mut(&account_id)
            .filter(|a| a.deleted_at_ms.is_none())
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "account",
                resource_id: account_id.clone(),
            })?;
        if acct.email.eq_ignore_ascii_case(&verified_email) {
            acct.email_verified = true;
        }
        Ok(acct.clone())
    }
}
