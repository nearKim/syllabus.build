//! BYOK credential vault custody, notification preferences, reminders, hosted credit wallet, and billing ledger.

use serde_json::Value;
use syllabus_security::{verify_webhook_hmac_sha256, AuthenticatedPrincipal};

use syllabus_domain::{
    authorize_credit_reservation, compute_next_reminder_utc, compute_reservation_settlement,
    evaluate_ambiguous_timeout_reconciliation, format_epoch_utc_iso, AmbiguousProviderOutcome,
    BillingModeKind, CostBucketKind, CreditReservation, DstResolutionPolicy,
    FourCostBucketBreakdown, LedgerEntry, LedgerEntryKind, ReminderScheduleDecision,
    ReminderScheduleInput, ReservationStatus, UsageQuote,
};

use crate::models::{
    evaluate_if_match, CheckoutSessionRecord, CredentialMetadataView, CreditReservationRecord,
    HostedCreditWalletRecord, InferenceUsageRecord, NotificationPreferencesRecord,
    PaymentWebhookReceiptRecord, PersistenceError, PushSubscriptionRecord,
    ReminderOccurrenceRecord, StoredCredentialRecord, UsageQuoteRecord,
};
use crate::store::{credential_map_key, InMemoryTransactionalStore, StoreInner};

#[allow(clippy::too_many_arguments)]
impl InMemoryTransactionalStore {
    // =========================================================================
    // T07A: Encrypted BYOK Credential Vault Operations & Usage Tracking
    // =========================================================================

    #[must_use]
    pub fn list_credential_metadata(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<CredentialMetadataView> {
        let guard = self.read_inner();
        guard
            .credentials
            .values()
            .filter(|c| c.owner_account_id == principal.account_id && !c.revoked)
            .map(CredentialMetadataView::from)
            .collect()
    }

    /// Rotates a BYOK credential under `If-Match` concurrency control (`T07A`, `BILL-007`, `@S28`, `@S66`).
    /// Increments `version`, re-encrypts the new secret bound to the new version in `CredentialVault`,
    /// and updates the resource ETag.
    pub fn rotate_credential(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        if_match: Option<&str>,
        new_raw_api_key: &str,
        new_label: Option<&str>,
    ) -> Result<CredentialMetadataView, PersistenceError> {
        let mut guard = self.write_inner();
        let key = credential_map_key(&principal.account_id, credential_ref);
        let (owner_id, current_etag, current_ver) = {
            let record = guard
                .credentials
                .get(&key)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "credential",
                    resource_id: credential_ref.to_string(),
                })?;
            if record.revoked {
                return Err(PersistenceError::NotFound {
                    resource_type: "credential",
                    resource_id: credential_ref.to_string(),
                });
            }
            (
                record.owner_account_id.clone(),
                record.etag.clone(),
                record.version,
            )
        };
        principal.require_learner_ownership(&owner_id)?;
        evaluate_if_match(if_match, &current_etag)?;

        let next_version = current_ver + 1;
        let sealed = guard.credential_vault.seal_credential(
            &principal.account_id,
            credential_ref,
            next_version,
            new_raw_api_key,
        )?;
        let masked_hint = sealed.key_last4_redacted.clone();
        let fingerprint = sealed.key_fingerprint_sha256.clone();

        guard.credential_envelopes.insert(key.clone(), sealed);

        let record = guard.credentials.get_mut(&key).expect("checked above");
        record.version = next_version;
        record.masked_hint = masked_hint.clone();
        record.key_fingerprint_sha256 = fingerprint;
        if let Some(lbl) = new_label {
            if !lbl.trim().is_empty() {
                record.label = lbl.trim().to_string();
            }
        }
        record.etag = format!("\"cred-v{next_version}\"");

        Ok(CredentialMetadataView::from(&*record))
    }

    /// Decrypts a BYOK credential just-in-time for a pinned `(credential_ref, expected_version)` inference call (`T07A`, `BILL-007`).
    pub fn open_credential_for_pinned_inference(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        expected_version: u64,
    ) -> Result<(String, StoredCredentialRecord), PersistenceError> {
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
            return Err(PersistenceError::Conflict {
                code: "credential_revoked",
                message: format!(
                    "BYOK credential `{credential_ref}` is revoked; no hosted fallback permitted"
                ),
            });
        }
        let envelope =
            guard
                .credential_envelopes
                .get(&key)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "credential_envelope",
                    resource_id: credential_ref.to_string(),
                })?;
        let raw_secret = guard.credential_vault.open_credential(
            envelope,
            &principal.account_id,
            credential_ref,
            expected_version,
        )?;
        Ok((raw_secret, record.clone()))
    }

    /// Records a BYOK inference usage entry (`T07A`, `BILL-004`, `BILL-008`, `@S68`).
    pub fn record_inference_usage(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        credential_version: u64,
        provider_id: &str,
        model_id: &str,
        operation_kind: &str,
        prompt_tokens: u64,
        completion_tokens: u64,
        usage_source: &str,
    ) -> Result<InferenceUsageRecord, PersistenceError> {
        let mut guard = self.write_inner();
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let total_tokens = prompt_tokens + completion_tokens;
        // Estimate provider cost in USD micros (e.g. $2.50/1M input + $10.00/1M output for GPT-4o)
        let estimated_provider_cost_usd_micros =
            (prompt_tokens * 25 + completion_tokens * 100) / 10;
        let record = InferenceUsageRecord {
            usage_record_id: format!("usage-{seq}"),
            account_id: principal.account_id.clone(),
            credential_ref: credential_ref.to_string(),
            credential_version,
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            operation_kind: operation_kind.to_string(),
            prompt_tokens,
            completion_tokens,
            total_tokens,
            usage_source: usage_source.to_string(),
            estimated_provider_cost_usd_micros,
            hosted_service_charge_usd_micros: 0,
            recorded_at: "2026-04-02T19:00:00Z".to_string(),
        };
        guard.inference_usage_records.push(record.clone());
        Ok(record)
    }

    pub fn list_inference_usage(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<InferenceUsageRecord> {
        let guard = self.read_inner();
        guard
            .inference_usage_records
            .iter()
            .filter(|r| r.account_id == principal.account_id)
            .cloned()
            .collect()
    }

    // =========================================================================
    // T08: Notification Preferences, Push Subscriptions & Reminder Occurrences
    // =========================================================================

    pub fn get_notification_preferences(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> NotificationPreferencesRecord {
        let mut guard = self.write_inner();
        guard
            .notification_preferences
            .entry(principal.account_id.clone())
            .or_insert_with(|| NotificationPreferencesRecord {
                account_id: principal.account_id.clone(),
                enabled: false,
                channel: "in_app".to_string(),
                iana_timezone: "UTC".to_string(),
                local_time_hhmm: "19:00".to_string(),
                days_of_week: vec![1, 2, 3, 4, 5],
                quiet_hours_start_hhmm: None,
                quiet_hours_end_hhmm: None,
                etag_version: 1,
                etag: "\"notif-v1\"".to_string(),
            })
            .clone()
    }

    pub fn update_notification_preferences(
        &self,
        principal: &AuthenticatedPrincipal,
        if_match: Option<&str>,
        enabled: bool,
        channel: &str,
        iana_timezone: &str,
        local_time_hhmm: &str,
        days_of_week: Vec<u8>,
        quiet_hours_start_hhmm: Option<String>,
        quiet_hours_end_hhmm: Option<String>,
    ) -> Result<NotificationPreferencesRecord, PersistenceError> {
        // Validate timezone and time format via pure domain policy
        let _ = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: true,
            iana_timezone: iana_timezone.to_string(),
            local_date_yyyy_mm_dd: "2026-04-02".to_string(),
            local_time_hhmm: local_time_hhmm.to_string(),
            quiet_hours_start_hhmm: quiet_hours_start_hhmm.clone(),
            quiet_hours_end_hhmm: quiet_hours_end_hhmm.clone(),
            today_study_completed: false,
            now_utc_epoch_seconds: 1_775_000_000,
        })
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let mut guard = self.write_inner();
        let entry = guard
            .notification_preferences
            .entry(principal.account_id.clone())
            .or_insert_with(|| NotificationPreferencesRecord {
                account_id: principal.account_id.clone(),
                enabled: false,
                channel: "in_app".to_string(),
                iana_timezone: "UTC".to_string(),
                local_time_hhmm: "19:00".to_string(),
                days_of_week: vec![1, 2, 3, 4, 5],
                quiet_hours_start_hhmm: None,
                quiet_hours_end_hhmm: None,
                etag_version: 1,
                etag: "\"notif-v1\"".to_string(),
            });

        evaluate_if_match(if_match, &entry.etag)?;

        entry.enabled = enabled;
        entry.channel = channel.to_string();
        entry.iana_timezone = iana_timezone.to_string();
        entry.local_time_hhmm = local_time_hhmm.to_string();
        entry.days_of_week = days_of_week;
        entry.quiet_hours_start_hhmm = quiet_hours_start_hhmm;
        entry.quiet_hours_end_hhmm = quiet_hours_end_hhmm;
        entry.etag_version += 1;
        entry.etag = format!("\"notif-v{}\"", entry.etag_version);

        Ok(entry.clone())
    }

    pub fn upsert_push_subscription(
        &self,
        principal: &AuthenticatedPrincipal,
        subscription_id: &str,
        endpoint_url: &str,
        p256dh_key: &str,
        auth_secret: &str,
    ) -> Result<PushSubscriptionRecord, PersistenceError> {
        if !endpoint_url.trim().starts_with("https://") {
            return Err(PersistenceError::Validation(
                "push subscription endpoint_url must use https://".to_string(),
            ));
        }
        let mut guard = self.write_inner();
        let rec = PushSubscriptionRecord {
            subscription_id: subscription_id.to_string(),
            account_id: principal.account_id.clone(),
            endpoint_url: endpoint_url.trim().to_string(),
            p256dh_key: p256dh_key.to_string(),
            auth_secret: auth_secret.to_string(),
            active: true,
        };
        guard
            .push_subscriptions
            .insert(subscription_id.to_string(), rec.clone());
        Ok(rec)
    }

    pub fn delete_push_subscription(
        &self,
        principal: &AuthenticatedPrincipal,
        subscription_id: &str,
    ) -> Result<(), PersistenceError> {
        let mut guard = self.write_inner();
        if let Some(sub) = guard.push_subscriptions.get_mut(subscription_id) {
            principal.require_learner_ownership(&sub.account_id)?;
            sub.active = false;
            return Ok(());
        }
        // Also support revoking all active subscriptions for the principal when subscription_id is "current" or "default"
        for sub in guard.push_subscriptions.values_mut() {
            if sub.account_id == principal.account_id {
                sub.active = false;
            }
        }
        Ok(())
    }

    /// Evaluates or schedules a reminder occurrence for `local_date_yyyy_mm_dd` (`T08`, `@S27`, `@S33`, `@S34`, `@S60`).
    pub fn evaluate_or_schedule_reminder(
        &self,
        principal: &AuthenticatedPrincipal,
        occurrence_id: &str,
        local_date_yyyy_mm_dd: &str,
        now_utc_epoch_seconds: i64,
    ) -> Result<ReminderScheduleDecision, PersistenceError> {
        let prefs = self.get_notification_preferences(principal);
        let mut guard = self.write_inner();

        let today_study_completed = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .map(|p| !p.completed_activities.is_empty() && p.total_time_spent_minutes > 0)
            .unwrap_or(false);

        let decision = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: prefs.enabled,
            iana_timezone: prefs.iana_timezone,
            local_date_yyyy_mm_dd: local_date_yyyy_mm_dd.to_string(),
            local_time_hhmm: prefs.local_time_hhmm,
            quiet_hours_start_hhmm: prefs.quiet_hours_start_hhmm,
            quiet_hours_end_hhmm: prefs.quiet_hours_end_hhmm,
            today_study_completed,
            now_utc_epoch_seconds,
        })
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        if let ReminderScheduleDecision::Scheduled {
            scheduled_utc_epoch,
            ref scheduled_utc_iso,
            expires_utc_epoch,
            ref expires_utc_iso,
            dst_resolution_policy,
            ..
        } = decision
        {
            guard.reminder_occurrences.insert(
                occurrence_id.to_string(),
                ReminderOccurrenceRecord {
                    occurrence_id: occurrence_id.to_string(),
                    account_id: principal.account_id.clone(),
                    syllabus_id: None,
                    scheduled_local_date: local_date_yyyy_mm_dd.to_string(),
                    scheduled_utc_iso: scheduled_utc_iso.clone(),
                    scheduled_utc_epoch,
                    expires_utc_iso: expires_utc_iso.clone(),
                    expires_utc_epoch,
                    snoozed_until_utc_iso: None,
                    status: "scheduled".to_string(),
                    dst_resolution_policy,
                },
            );
        }

        Ok(decision)
    }

    /// Snoozes a reminder occurrence (`T08`, `REM-004`).
    pub fn snooze_reminder_occurrence(
        &self,
        principal: &AuthenticatedPrincipal,
        occurrence_id: &str,
        snooze_minutes: u32,
        now_utc_epoch_seconds: i64,
    ) -> Result<ReminderOccurrenceRecord, PersistenceError> {
        if snooze_minutes == 0 || snooze_minutes > 1_440 {
            return Err(PersistenceError::Validation(
                "snooze_minutes must be between 1 and 1440".to_string(),
            ));
        }
        let mut guard = self.write_inner();
        let occ = guard
            .reminder_occurrences
            .entry(occurrence_id.to_string())
            .or_insert_with(|| ReminderOccurrenceRecord {
                occurrence_id: occurrence_id.to_string(),
                account_id: principal.account_id.clone(),
                syllabus_id: None,
                scheduled_local_date: "2026-04-02".to_string(),
                scheduled_utc_iso: format_epoch_utc_iso(now_utc_epoch_seconds),
                scheduled_utc_epoch: now_utc_epoch_seconds,
                expires_utc_iso: format_epoch_utc_iso(now_utc_epoch_seconds + 12 * 3600),
                expires_utc_epoch: now_utc_epoch_seconds + 12 * 3600,
                snoozed_until_utc_iso: None,
                status: "scheduled".to_string(),
                dst_resolution_policy: DstResolutionPolicy::ExactLocalTime,
            });
        principal.require_learner_ownership(&occ.account_id)?;

        let snoozed_epoch = now_utc_epoch_seconds + (snooze_minutes as i64) * 60;
        let snoozed_iso = format_epoch_utc_iso(snoozed_epoch);
        occ.snoozed_until_utc_iso = Some(snoozed_iso);
        occ.status = "snoozed".to_string();
        Ok(occ.clone())
    }

    // =========================================================================
    // T07B & T07D: Hosted Credit Wallet, Quotes, Reservations, Settlements,
    //              Checkout Sessions, Signed Webhooks & Timeout Reconciliation
    // =========================================================================

    pub(crate) fn ensure_wallet_mut<'a>(
        guard: &'a mut StoreInner,
        account_id: &str,
    ) -> &'a mut HostedCreditWalletRecord {
        let byok_micros: u64 = guard
            .inference_usage_records
            .iter()
            .filter(|u| u.account_id == account_id)
            .map(|u| u.estimated_provider_cost_usd_micros)
            .sum();
        let byok_minor = (byok_micros / 10_000) as i64;
        let wallet = guard
            .hosted_credit_wallets
            .entry(account_id.to_string())
            .or_insert_with(|| HostedCreditWalletRecord {
                account_id: account_id.to_string(),
                currency: "USD".to_string(),
                available_minor_units: 0,
                reserved_minor_units: 0,
                lifetime_purchased_minor_units: 0,
                lifetime_settled_minor_units: 0,
                lifetime_refunded_minor_units: 0,
                four_cost_buckets: FourCostBucketBreakdown {
                    currency: "USD".to_string(),
                    service_access_minor_units: 0,
                    hosted_ai_inference_minor_units: 0,
                    external_byok_estimate_minor_units: byok_minor,
                    learning_materials_and_exams_minor_units: 0,
                },
                etag_version: 1,
                etag: "\"wallet-v1\"".to_string(),
                updated_at: "2026-04-02T19:00:00Z".to_string(),
            });
        wallet.four_cost_buckets.external_byok_estimate_minor_units = byok_minor;
        wallet.four_cost_buckets.hosted_ai_inference_minor_units =
            wallet.lifetime_settled_minor_units;
        wallet
    }

    pub fn get_hosted_credit_wallet(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> HostedCreditWalletRecord {
        let mut guard = self.write_inner();
        Self::ensure_wallet_mut(&mut guard, &principal.account_id).clone()
    }

    #[cfg(test)]
    pub(crate) fn set_wallet_balance_for_test(
        &self,
        account_id: &str,
        available_minor_units: i64,
        reserved_minor_units: i64,
    ) -> HostedCreditWalletRecord {
        let mut guard = self.write_inner();
        let wallet = Self::ensure_wallet_mut(&mut guard, account_id);
        wallet.available_minor_units = available_minor_units;
        wallet.reserved_minor_units = reserved_minor_units;
        wallet.etag_version += 1;
        wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
        wallet.clone()
    }

    /// Creates a pre-execution `UsageQuote` (`T07B`, `BILL-003`, `BILL-004`, `@S06`, `@S28`, `@S30`, `@S74`).
    pub fn create_usage_quote(
        &self,
        principal: &AuthenticatedPrincipal,
        quote_id: Option<&str>,
        operation_kind: &str,
        billing_mode: BillingModeKind,
        provider_id: &str,
        model_id: &str,
        estimated_minor_units: i64,
        max_reservable_minor_units: i64,
        external_byok_estimated_minor_units: i64,
        learning_materials_estimated_minor_units: i64,
        now_epoch_seconds: i64,
        ttl_seconds: i64,
    ) -> Result<UsageQuoteRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let mut seq = guard.next_seq + 1;
        let resolved_quote_id = quote_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| loop {
                let generated = format!("quote-{seq}");
                if !guard.usage_quotes.contains_key(&generated) {
                    break generated;
                }
                seq += 1;
            });
        if guard.usage_quotes.contains_key(&resolved_quote_id) {
            return Err(PersistenceError::Conflict {
                code: "usage_quote_id_exists",
                message: format!("usage quote `{resolved_quote_id}` already exists"),
            });
        }

        let (est_hosted, max_hosted, est_byok) = match billing_mode {
            BillingModeKind::HostedCredits => (
                estimated_minor_units,
                max_reservable_minor_units,
                external_byok_estimated_minor_units,
            ),
            BillingModeKind::Byok => (
                0,
                0,
                if external_byok_estimated_minor_units > 0 {
                    external_byok_estimated_minor_units
                } else {
                    estimated_minor_units.max(25)
                },
            ),
        };

        let expires_at_epoch_seconds = now_epoch_seconds + ttl_seconds;
        let quote = UsageQuote {
            quote_id: resolved_quote_id.clone(),
            account_id: principal.account_id.clone(),
            operation_kind: operation_kind.to_string(),
            billing_mode,
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            currency: "USD".to_string(),
            estimated_minor_units: est_hosted,
            max_reservable_minor_units: max_hosted,
            external_byok_estimated_minor_units: est_byok,
            learning_materials_estimated_minor_units,
            pricing_snapshot_version: "pricing-2026-03-v1".to_string(),
            expires_at_epoch_seconds,
        };
        quote
            .validate(now_epoch_seconds)
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let four_cost_buckets = FourCostBucketBreakdown {
            currency: "USD".to_string(),
            service_access_minor_units: 0,
            hosted_ai_inference_minor_units: est_hosted,
            external_byok_estimate_minor_units: est_byok,
            learning_materials_and_exams_minor_units: learning_materials_estimated_minor_units,
        };
        four_cost_buckets
            .validate()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let record = UsageQuoteRecord {
            quote,
            four_cost_buckets,
            created_at: format_epoch_utc_iso(now_epoch_seconds),
            expires_at: format_epoch_utc_iso(expires_at_epoch_seconds),
        };
        guard.next_seq = seq;
        guard.usage_quotes.insert(resolved_quote_id, record.clone());
        Ok(record)
    }

    /// Reserves hosted credits prior to provider execution (`T07B`, `BILL-003`, `BILL-005`, `BILL-008`, `@S28`, `@S30`, `@S68`).
    pub fn create_credit_reservation(
        &self,
        principal: &AuthenticatedPrincipal,
        reservation_id: Option<&str>,
        quote_id: &str,
        idempotency_key: &str,
        requested_reserve_minor_units: Option<i64>,
        now_epoch_seconds: i64,
    ) -> Result<CreditReservationRecord, PersistenceError> {
        let idem_trimmed = idempotency_key.trim();
        if idem_trimmed.is_empty() {
            return Err(PersistenceError::IdempotencyKeyRequired {
                operation_id: "reserveInferenceBudget".to_string(),
            });
        }

        let mut guard = self.write_inner();
        let idem_lookup = (principal.account_id.clone(), idem_trimmed.to_string());
        if let Some(existing_id) = guard.reservations_by_idempotency.get(&idem_lookup).cloned() {
            if let Some(existing_rec) = guard.credit_reservations.get(&existing_id).cloned() {
                if existing_rec.reservation.quote_id != quote_id {
                    return Err(PersistenceError::IdempotencyPayloadMismatch {
                        operation_id: "reserveInferenceBudget".to_string(),
                        idempotency_key: idem_trimmed.to_string(),
                    });
                }
                return Ok(existing_rec);
            }
        }

        let quote_rec = guard.usage_quotes.get(quote_id).cloned().ok_or_else(|| {
            PersistenceError::NotFound {
                resource_type: "usage_quote",
                resource_id: quote_id.to_string(),
            }
        })?;
        principal.require_learner_ownership(&quote_rec.quote.account_id)?;

        if now_epoch_seconds > quote_rec.quote.expires_at_epoch_seconds {
            return Err(PersistenceError::Conflict {
                code: "quote_expired",
                message: format!(
                    "usage quote `{quote_id}` expired at `{}`",
                    quote_rec.expires_at
                ),
            });
        }

        let mut seq = guard.next_seq + 1;
        let resolved_reservation_id = reservation_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| loop {
                let generated = format!("resv-{seq}");
                if !guard.credit_reservations.contains_key(&generated) {
                    break generated;
                }
                seq += 1;
            });
        if guard
            .credit_reservations
            .contains_key(&resolved_reservation_id)
        {
            return Err(PersistenceError::Conflict {
                code: "credit_reservation_id_exists",
                message: format!("credit reservation `{resolved_reservation_id}` already exists"),
            });
        }

        let reserve_amount =
            requested_reserve_minor_units.unwrap_or(quote_rec.quote.max_reservable_minor_units);

        let (cur_avail, cur_res) = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            (wallet.available_minor_units, wallet.reserved_minor_units)
        };

        let (new_avail, new_res) = authorize_credit_reservation(
            cur_avail,
            cur_res,
            &quote_rec.quote,
            reserve_amount,
            now_epoch_seconds,
        )
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("insufficient available hosted credits") {
                PersistenceError::PaymentRequired {
                    code: "insufficient_hosted_credits",
                    message: msg,
                }
            } else {
                PersistenceError::Validation(msg)
            }
        })?;

        guard.next_seq = seq;

        {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            wallet.available_minor_units = new_avail;
            wallet.reserved_minor_units = new_res;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = format_epoch_utc_iso(now_epoch_seconds);
        }

        let reservation = CreditReservation {
            reservation_id: resolved_reservation_id.clone(),
            account_id: principal.account_id.clone(),
            quote_id: quote_id.to_string(),
            idempotency_key: idem_trimmed.to_string(),
            operation_kind: quote_rec.quote.operation_kind.clone(),
            provider_id: quote_rec.quote.provider_id.clone(),
            model_id: quote_rec.quote.model_id.clone(),
            currency: "USD".to_string(),
            reserved_minor_units: reserve_amount,
            settled_minor_units: 0,
            released_minor_units: 0,
            status: ReservationStatus::Reserved,
            expires_at_epoch_seconds: now_epoch_seconds + 900,
        };
        let record = CreditReservationRecord {
            reservation,
            created_at: format_epoch_utc_iso(now_epoch_seconds),
            finalized_at: None,
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-hold-{seq}"),
            account_id: principal.account_id.clone(),
            entry_kind: LedgerEntryKind::ReservationHold,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: -reserve_amount,
            delta_reserved_minor_units: reserve_amount,
            balance_after_available_minor_units: new_avail,
            balance_after_reserved_minor_units: new_res,
            quote_id: Some(quote_id.to_string()),
            reservation_id: Some(resolved_reservation_id.clone()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!("Pre-execution credit hold for quote `{quote_id}`"),
            created_at_iso: format_epoch_utc_iso(now_epoch_seconds),
        });

        guard
            .reservations_by_idempotency
            .insert(idem_lookup, resolved_reservation_id.clone());
        guard
            .credit_reservations
            .insert(resolved_reservation_id, record.clone());
        Ok(record)
    }

    /// Settles a reservation upon committed artifact completion, capping settlement at `reserved_minor_units`
    /// and releasing any unused remainder (`T07B`, `BILL-003`, `BILL-005`, `@S30`, `@S68`).
    pub fn settle_credit_reservation(
        &self,
        principal: &AuthenticatedPrincipal,
        reservation_id: &str,
        actual_usage_minor_units: i64,
        now_epoch_seconds: i64,
    ) -> Result<(CreditReservationRecord, HostedCreditWalletRecord), PersistenceError> {
        let mut guard = self.write_inner();
        let existing = guard
            .credit_reservations
            .get(reservation_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credit_reservation",
                resource_id: reservation_id.to_string(),
            })?;
        principal.require_learner_ownership(&existing.reservation.account_id)?;

        if existing.reservation.status == ReservationStatus::Settled {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id).clone();
            return Ok((existing, wallet));
        }
        if existing.reservation.status != ReservationStatus::Reserved {
            return Err(PersistenceError::Conflict {
                code: "reservation_not_active",
                message: format!(
                    "reservation `{reservation_id}` is already `{}`",
                    existing.reservation.status.as_str()
                ),
            });
        }

        let reserved = existing.reservation.reserved_minor_units;
        let (settled, released) =
            compute_reservation_settlement(reserved, actual_usage_minor_units)
                .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let now_iso = format_epoch_utc_iso(now_epoch_seconds);

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            wallet.reserved_minor_units = (wallet.reserved_minor_units - reserved).max(0);
            wallet.available_minor_units += released;
            wallet.lifetime_settled_minor_units += settled;
            wallet.four_cost_buckets.hosted_ai_inference_minor_units =
                wallet.lifetime_settled_minor_units;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = now_iso.clone();
            wallet.clone()
        };

        let updated_res = {
            let res_mut = guard
                .credit_reservations
                .get_mut(reservation_id)
                .expect("checked above");
            res_mut.reservation.settled_minor_units = settled;
            res_mut.reservation.released_minor_units = released;
            res_mut.reservation.status = ReservationStatus::Settled;
            res_mut.finalized_at = Some(now_iso.clone());
            res_mut.clone()
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-settle-{seq}"),
            account_id: principal.account_id.clone(),
            entry_kind: LedgerEntryKind::ReservationSettlement,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: released,
            delta_reserved_minor_units: -reserved,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: Some(updated_res.reservation.quote_id.clone()),
            reservation_id: Some(reservation_id.to_string()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!(
                "Settled {settled} minor units and released {released} minor units for reservation `{reservation_id}`"
            ),
            created_at_iso: now_iso,
        });

        Ok((updated_res, updated_wallet))
    }

    /// Releases 100% of a credit reservation on validation failure, cancellation, or provider failure (`T07B`, `BILL-005`, `@S68`).
    pub fn release_credit_reservation(
        &self,
        principal: &AuthenticatedPrincipal,
        reservation_id: &str,
        reason: &str,
        now_epoch_seconds: i64,
    ) -> Result<(CreditReservationRecord, HostedCreditWalletRecord), PersistenceError> {
        let mut guard = self.write_inner();
        let existing = guard
            .credit_reservations
            .get(reservation_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credit_reservation",
                resource_id: reservation_id.to_string(),
            })?;
        principal.require_learner_ownership(&existing.reservation.account_id)?;

        if existing.reservation.status == ReservationStatus::Released {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id).clone();
            return Ok((existing, wallet));
        }
        if existing.reservation.status != ReservationStatus::Reserved {
            return Err(PersistenceError::Conflict {
                code: "reservation_already_settled",
                message: format!(
                    "reservation `{reservation_id}` is already `{}`",
                    existing.reservation.status.as_str()
                ),
            });
        }

        let reserved = existing.reservation.reserved_minor_units;
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let now_iso = format_epoch_utc_iso(now_epoch_seconds);

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            wallet.reserved_minor_units = (wallet.reserved_minor_units - reserved).max(0);
            wallet.available_minor_units += reserved;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = now_iso.clone();
            wallet.clone()
        };

        let updated_res = {
            let res_mut = guard
                .credit_reservations
                .get_mut(reservation_id)
                .expect("checked above");
            res_mut.reservation.settled_minor_units = 0;
            res_mut.reservation.released_minor_units = reserved;
            res_mut.reservation.status = ReservationStatus::Released;
            res_mut.finalized_at = Some(now_iso.clone());
            res_mut.clone()
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-release-{seq}"),
            account_id: principal.account_id.clone(),
            entry_kind: LedgerEntryKind::ReservationRelease,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: reserved,
            delta_reserved_minor_units: -reserved,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: Some(updated_res.reservation.quote_id.clone()),
            reservation_id: Some(reservation_id.to_string()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!("Released reservation `{reservation_id}`: {reason}"),
            created_at_iso: now_iso,
        });

        Ok((updated_res, updated_wallet))
    }

    /// Reconciles an ambiguous or timed-out provider call (`T07D`, `BILL-008`, `NFR-006`, `@S43`, `@S68`).
    /// Never settles a charge unless `committed_artifact_persisted == true` and the provider confirmed completion.
    pub fn reconcile_ambiguous_provider_timeout(
        &self,
        principal: &AuthenticatedPrincipal,
        reservation_id: &str,
        committed_artifact_persisted: bool,
        outcome: AmbiguousProviderOutcome,
        now_epoch_seconds: i64,
    ) -> Result<(CreditReservationRecord, HostedCreditWalletRecord), PersistenceError> {
        let mut guard = self.write_inner();
        let existing = guard
            .credit_reservations
            .get(reservation_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credit_reservation",
                resource_id: reservation_id.to_string(),
            })?;

        principal.require_learner_ownership(&existing.reservation.account_id)?;
        let account_id = existing.reservation.account_id.clone();
        if existing.reservation.status != ReservationStatus::Reserved {
            let wallet = Self::ensure_wallet_mut(&mut guard, &account_id).clone();
            return Ok((existing, wallet));
        }

        let reserved = existing.reservation.reserved_minor_units;
        let (target_status, settled, released) = evaluate_ambiguous_timeout_reconciliation(
            reserved,
            committed_artifact_persisted,
            outcome,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let now_iso = format_epoch_utc_iso(now_epoch_seconds);

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &account_id);
            wallet.reserved_minor_units = (wallet.reserved_minor_units - reserved).max(0);
            wallet.available_minor_units += released;
            wallet.lifetime_settled_minor_units += settled;
            wallet.four_cost_buckets.hosted_ai_inference_minor_units =
                wallet.lifetime_settled_minor_units;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = now_iso.clone();
            wallet.clone()
        };

        let updated_res = {
            let res_mut = guard
                .credit_reservations
                .get_mut(reservation_id)
                .expect("checked above");
            res_mut.reservation.settled_minor_units = settled;
            res_mut.reservation.released_minor_units = released;
            res_mut.reservation.status = target_status;
            res_mut.finalized_at = Some(now_iso.clone());
            res_mut.clone()
        };

        let entry_kind = if target_status == ReservationStatus::Settled {
            LedgerEntryKind::ReservationSettlement
        } else {
            LedgerEntryKind::ReconciliationRelease
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-reconcile-{seq}"),
            account_id,
            entry_kind,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: released,
            delta_reserved_minor_units: -reserved,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: Some(updated_res.reservation.quote_id.clone()),
            reservation_id: Some(reservation_id.to_string()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!(
                "Ambiguous provider timeout reconciliation for `{reservation_id}`: status={}",
                target_status.as_str()
            ),
            created_at_iso: now_iso,
        });

        Ok((updated_res, updated_wallet))
    }

    pub fn list_ledger_entries(&self, principal: &AuthenticatedPrincipal) -> Vec<LedgerEntry> {
        let guard = self.read_inner();
        guard
            .ledger_entries
            .iter()
            .filter(|e| e.account_id == principal.account_id)
            .cloned()
            .collect()
    }

    /// Creates a hosted credit top-up checkout session (`T07D`, `BILL-003`, `UI-020`, `@S84`).
    pub fn create_checkout_session(
        &self,
        principal: &AuthenticatedPrincipal,
        checkout_session_id: Option<&str>,
        package_id: &str,
        idempotency_key: &str,
        amount_minor_units: i64,
        credit_minor_units: i64,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<CheckoutSessionRecord, PersistenceError> {
        let idem_trimmed = idempotency_key.trim();
        if idem_trimmed.is_empty() {
            return Err(PersistenceError::IdempotencyKeyRequired {
                operation_id: "createBillingCheckoutSession".to_string(),
            });
        }
        if amount_minor_units <= 0 || credit_minor_units != amount_minor_units {
            return Err(PersistenceError::Validation(
                "checkout amount_minor_units must be positive and equal credit_minor_units"
                    .to_string(),
            ));
        }
        if !success_url.starts_with("https://") || !cancel_url.starts_with("https://") {
            return Err(PersistenceError::Validation(
                "checkout success_url and cancel_url must use https://".to_string(),
            ));
        }

        let mut guard = self.write_inner();
        let idem_key = (principal.account_id.clone(), idem_trimmed.to_string());
        if let Some(existing_id) = guard.checkout_by_idempotency.get(&idem_key).cloned() {
            if let Some(existing_sess) = guard.checkout_sessions.get(&existing_id).cloned() {
                if existing_sess.package_id != package_id
                    || existing_sess.amount_minor_units != amount_minor_units
                {
                    return Err(PersistenceError::IdempotencyPayloadMismatch {
                        operation_id: "createBillingCheckoutSession".to_string(),
                        idempotency_key: idem_trimmed.to_string(),
                    });
                }
                return Ok(existing_sess);
            }
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_id = checkout_session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("cs_test_{seq}"));
        if guard.checkout_sessions.contains_key(&resolved_id) {
            return Err(PersistenceError::Conflict {
                code: "checkout_session_id_exists",
                message: format!("checkout session `{resolved_id}` already exists"),
            });
        }

        let record = CheckoutSessionRecord {
            checkout_session_id: resolved_id.clone(),
            account_id: principal.account_id.clone(),
            package_id: package_id.to_string(),
            idempotency_key: idem_trimmed.to_string(),
            currency: "USD".to_string(),
            amount_minor_units,
            credit_minor_units,
            status: "pending".to_string(),
            checkout_url: format!("https://checkout.stripe.example.test/pay/{resolved_id}"),
            success_url: success_url.to_string(),
            cancel_url: cancel_url.to_string(),
            created_at: "2026-04-02T19:00:00Z".to_string(),
            completed_at: None,
        };

        guard
            .checkout_by_idempotency
            .insert(idem_key, resolved_id.clone());
        guard.checkout_sessions.insert(resolved_id, record.clone());
        Ok(record)
    }

    /// Processes a signed payment provider webhook idempotently by `provider_event_id` (`T07D`, `BILL-005`, `NFR-006`, `@S43`, `@S67`, `@S68`).
    pub fn process_payment_webhook(
        &self,
        webhook_secret: &[u8],
        raw_payload: &[u8],
        signature_header: &str,
    ) -> Result<PaymentWebhookReceiptRecord, PersistenceError> {
        // 1. Verify HMAC-SHA256 over raw payload BEFORE parsing or mutating state
        let _verified_sig_hex =
            verify_webhook_hmac_sha256(webhook_secret, raw_payload, signature_header)?;

        let payload: Value = serde_json::from_slice(raw_payload).map_err(|e| {
            PersistenceError::Validation(format!("invalid webhook JSON payload: {e}"))
        })?;

        let provider_event_id = payload
            .get("provider_event_id")
            .or_else(|| payload.get("webhook_event_id"))
            .or_else(|| payload.get("event_id"))
            .or_else(|| payload.get("id"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                PersistenceError::Validation("missing provider_event_id in webhook".to_string())
            })?
            .to_string();

        let event_type = payload
            .get("event_type")
            .or_else(|| payload.get("type"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                PersistenceError::Validation("missing event_type in webhook".to_string())
            })?
            .to_string();

        let checkout_session_id = payload
            .get("checkout_session_id")
            .or_else(|| payload.get("session_id"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                PersistenceError::Validation("missing checkout_session_id in webhook".to_string())
            })?
            .to_string();

        let mut guard = self.write_inner();

        // 2. Deduplicate by provider_event_id (idempotent replay with zero duplicate ledger mutation)
        if let Some(existing_receipt) = guard
            .payment_webhook_events
            .get(&provider_event_id)
            .cloned()
        {
            let mut replayed = existing_receipt;
            replayed.replayed = true;
            return Ok(replayed);
        }

        let sess = guard
            .checkout_sessions
            .get(&checkout_session_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "checkout_session",
                resource_id: checkout_session_id.clone(),
            })?;

        let amount_minor_units = payload
            .get("amount_minor_units")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| {
                PersistenceError::Validation("missing amount_minor_units in webhook".to_string())
            })?;

        if amount_minor_units != sess.amount_minor_units {
            return Err(PersistenceError::Validation(
                "webhook amount_minor_units does not match checkout amount".to_string(),
            ));
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let account_id = sess.account_id.clone();

        let (entry_kind, delta_avail, new_sess_status, description) = match event_type.as_str() {
            "checkout.session.completed" if sess.status == "pending" => (
                LedgerEntryKind::TopUpCredit,
                sess.credit_minor_units,
                "completed",
                format!("Hosted credit top-up from checkout session `{checkout_session_id}`"),
            ),
            "charge.refunded" if sess.status == "completed" => (
                LedgerEntryKind::RefundDebit,
                -sess.credit_minor_units,
                "refunded",
                format!("Refund debit for checkout session `{checkout_session_id}`"),
            ),
            "charge.dispute.created" if sess.status == "completed" => (
                LedgerEntryKind::ChargebackDebit,
                -sess.credit_minor_units,
                "disputed",
                format!("Chargeback dispute debit for checkout session `{checkout_session_id}`"),
            ),
            "checkout.session.completed" | "charge.refunded" | "charge.dispute.created" => {
                return Err(PersistenceError::Conflict {
                    code: "checkout_event_out_of_order",
                    message: format!(
                        "checkout session `{checkout_session_id}` is already `{}`",
                        sess.status
                    ),
                });
            }
            other => {
                return Err(PersistenceError::Validation(format!(
                    "unsupported payment webhook event_type `{other}`"
                )));
            }
        };

        if let Some(sess_mut) = guard.checkout_sessions.get_mut(&checkout_session_id) {
            sess_mut.status = new_sess_status.to_string();
            if new_sess_status == "completed" {
                sess_mut.completed_at = Some("2026-04-02T19:05:00Z".to_string());
            }
        }

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &account_id);
            wallet.available_minor_units += delta_avail;
            if delta_avail > 0 {
                wallet.lifetime_purchased_minor_units += delta_avail;
            } else {
                wallet.lifetime_refunded_minor_units += -delta_avail;
            }
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = "2026-04-02T19:05:00Z".to_string();
            wallet.clone()
        };

        let ledger_entry_id = format!("ledg-wh-{seq}");
        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: ledger_entry_id.clone(),
            account_id: account_id.clone(),
            entry_kind,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: delta_avail,
            delta_reserved_minor_units: 0,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: None,
            reservation_id: None,
            checkout_session_id: Some(checkout_session_id.clone()),
            webhook_event_id: Some(provider_event_id.clone()),
            description,
            created_at_iso: "2026-04-02T19:05:00Z".to_string(),
        });

        let receipt = PaymentWebhookReceiptRecord {
            provider_event_id: provider_event_id.clone(),
            event_type,
            checkout_session_id,
            account_id,
            amount_minor_units,
            ledger_entry_id,
            replayed: false,
            wallet: updated_wallet,
        };
        guard
            .payment_webhook_events
            .insert(provider_event_id, receipt.clone());
        Ok(receipt)
    }
}
