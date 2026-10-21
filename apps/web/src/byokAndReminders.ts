import { buildOperationHeaders } from "../../../packages/api-client/src/index.ts";
import { resolveSurfaceStyle, type ResolvedSurfaceStyle as SurfaceStyle, type ThemeMode } from "../../../packages/ui/src/index.ts";
import { requireNonEmpty } from "./shared.ts";

export type InferenceMode = "byok" | "hosted";

export interface MaskedCredentialRecord {
  credential_ref: string; provider_id: string; label?: string;
  status: "active" | "revoked" | "invalid"; credential_version_ref: string;
  masked_hint: string; masked_suffix: string; version: number; etag?: string; updated_at?: string;
}

export interface ByokInferenceConfig {
  mode: InferenceMode; provider_id?: string; credential_ref?: string; credential_version_ref?: string;
  model_policy_id: string; allow_hosted_fallback: false;
}

export interface ByokProviderFailureBanner {
  provider_id: string; credential_ref: string; errorCode: string; message: string;
  autoFallbackTriggered: false;
  remediationOptions: Array<"retry_byok" | "rotate_key" | "switch_to_hosted_explicitly">;
}

export interface ByokCustodyState {
  mode: InferenceMode; allowHostedFallback: false;
  hasTransientKeyInBuffer: boolean; transientKeyLength: number;
  credentials: MaskedCredentialRecord[]; selectedCredentialRef: string | null;
  modelPolicyId: string; serverCustodyDisclosure: string; externalBillingDisclosure: string;
  providerFailureBanner: ByokProviderFailureBanner | null; surfaceStyle: SurfaceStyle;
}

export interface ByokHttpRequest<TPayload> {
  method: "POST" | "PUT"; path: string; headers: Record<string, string>; body?: TPayload;
}

const SERVER_CUSTODY_DISCLOSURE =
  "Server custody disclosure: Your API key is transmitted over TLS, encrypted at rest in server custody for background generation jobs, and is never stored in browser localStorage, sessionStorage, IndexedDB, or URLs.";
const EXTERNAL_BILLING_DISCLOSURE =
  "External billing disclosure: BYOK generation requests execute against your external provider account and incur usage charges directly on your provider billing plan. Silent fallback to hosted inference is disabled.";

const maskSuffixFromRawKey = (rawKey: string) => {
  const suffix = rawKey.trim().slice(-4) || "••••";
  return { masked_hint: `••••${suffix}`, masked_suffix: suffix };
};

const resolveCredentialEtag = (rec: MaskedCredentialRecord, explicitIfMatch?: string): string =>
  explicitIfMatch?.trim() || rec.etag?.trim() || `"credential-${rec.credential_ref}-v${rec.version}"`;

export function createByokCustodyController(
  options: {
    initialMode?: InferenceMode; initialCredentials?: MaskedCredentialRecord[];
    selectedCredentialRef?: string | null; modelPolicyId?: string; themeMode?: ThemeMode;
  } = {},
) {
  const surfaceStyle = resolveSurfaceStyle("consent", { themePreference: options.themeMode ?? "light" });
  let mode: InferenceMode = options.initialMode ?? "byok";
  let credentials: MaskedCredentialRecord[] = (options.initialCredentials ?? []).map((c) => ({ ...c }));
  let selectedCredentialRef: string | null =
    options.selectedCredentialRef ?? credentials.find((c) => c.status === "active")?.credential_ref ?? null;
  const modelPolicyId = options.modelPolicyId ?? "synthetic-model-policy";
  let transientSecretBuffer: string | null = null;
  let providerFailureBanner: ByokProviderFailureBanner | null = null;

  const snapshot = (): ByokCustodyState => ({
    mode, allowHostedFallback: false,
    hasTransientKeyInBuffer: Boolean(transientSecretBuffer?.length),
    transientKeyLength: transientSecretBuffer ? transientSecretBuffer.length : 0,
    credentials: credentials.map((c) => ({ ...c })), selectedCredentialRef, modelPolicyId,
    serverCustodyDisclosure: SERVER_CUSTODY_DISCLOSURE, externalBillingDisclosure: EXTERNAL_BILLING_DISCLOSURE,
    providerFailureBanner: providerFailureBanner
      ? { ...providerFailureBanner, remediationOptions: [...providerFailureBanner.remediationOptions] }
      : null,
    surfaceStyle,
  });

  const findCredentialOrThrow = (ref: string): MaskedCredentialRecord => {
    const existing = credentials.find((c) => c.credential_ref === ref);
    if (!existing) throw new Error(`Unknown credential_ref: ${ref}`);
    return existing;
  };

  return {
    getState: snapshot,
    setInferenceMode(nextMode: InferenceMode): ByokCustodyState {
      mode = nextMode;
      if (nextMode === "hosted") providerFailureBanner = null;
      return snapshot();
    },
    selectCredential(credentialRef: string): ByokCustodyState {
      const target = findCredentialOrThrow(credentialRef);
      if (target.status === "revoked") throw new Error(`Cannot select revoked credential "${credentialRef}" for active inference.`);
      selectedCredentialRef = credentialRef;
      providerFailureBanner = null;
      return snapshot();
    },
    setTransientApiKey(rawKey: string): ByokCustodyState {
      transientSecretBuffer = requireNonEmpty(rawKey, "Transient API key cannot be empty.");
      return snapshot();
    },
    clearTransientApiKey(): ByokCustodyState {
      transientSecretBuffer = null;
      return snapshot();
    },
    buildCreateCredentialRequest(input: { provider_id: string; label?: string }): ByokHttpRequest<{
      provider_id: string; label?: string; api_key: string; custody_acknowledged: true; external_billing_acknowledged: true;
    }> {
      const secret = transientSecretBuffer;
      if (!secret) throw new Error("No transient API key in write-only buffer to submit for createCredential.");
      const { masked_hint, masked_suffix } = maskSuffixFromRawKey(secret);
      transientSecretBuffer = null;

      const newRef = `cred-${input.provider_id}-${credentials.length + 1}`;
      credentials = [
        ...credentials,
        {
          credential_ref: newRef, provider_id: input.provider_id,
          ...(input.label ? { label: input.label } : {}),
          status: "active", credential_version_ref: `${newRef}-v1`,
          masked_hint, masked_suffix, version: 1, etag: `"credential-${newRef}-v1"`,
        },
      ];
      selectedCredentialRef = newRef;
      providerFailureBanner = null;

      return {
        method: "POST", path: "/v1/me/credentials",
        headers: buildOperationHeaders("createCredential"),
        body: {
          provider_id: input.provider_id, ...(input.label ? { label: input.label } : {}),
          api_key: secret, custody_acknowledged: true, external_billing_acknowledged: true,
        },
      };
    },
    buildRotateCredentialRequest(input: { credential_ref: string; ifMatch?: string }): ByokHttpRequest<{
      api_key: string; custody_acknowledged: true;
    }> {
      const secret = transientSecretBuffer;
      if (!secret) throw new Error("No transient API key in write-only buffer to submit for rotateCredential.");
      const existing = credentials.find((c) => c.credential_ref === input.credential_ref);
      if (!existing) {
        transientSecretBuffer = null;
        throw new Error(`Unknown credential_ref: ${input.credential_ref}`);
      }
      const ifMatch = resolveCredentialEtag(existing, input.ifMatch);
      const { masked_hint, masked_suffix } = maskSuffixFromRawKey(secret);
      transientSecretBuffer = null;

      const nextVer = existing.version + 1;
      credentials = credentials.map((c) =>
        c.credential_ref === input.credential_ref
          ? {
              ...c, status: "active", version: nextVer, credential_version_ref: `${c.credential_ref}-v${nextVer}`,
              masked_hint, masked_suffix, etag: `"credential-${c.credential_ref}-v${nextVer}"`,
            }
          : c,
      );
      providerFailureBanner = null;

      return {
        method: "POST",
        path: `/v1/me/credentials/${encodeURIComponent(input.credential_ref)}/rotate`,
        headers: buildOperationHeaders("rotateCredential", { ifMatch }),
        body: { api_key: secret, custody_acknowledged: true },
      };
    },
    buildRevokeCredentialRequest(input: { credential_ref: string; ifMatch?: string; reason?: string }): ByokHttpRequest<{ reason?: string }> {
      const existing = findCredentialOrThrow(input.credential_ref);
      const ifMatch = resolveCredentialEtag(existing, input.ifMatch);
      const nextVer = existing.version + 1;
      credentials = credentials.map((c) =>
        c.credential_ref === input.credential_ref
          ? { ...c, status: "revoked", version: nextVer, etag: `"credential-${c.credential_ref}-v${nextVer}"` }
          : c,
      );
      if (selectedCredentialRef === input.credential_ref) {
        selectedCredentialRef = credentials.find((c) => c.status === "active")?.credential_ref ?? null;
      }
      return {
        method: "POST",
        path: `/v1/me/credentials/${encodeURIComponent(input.credential_ref)}/revoke`,
        headers: buildOperationHeaders("revokeCredential", { ifMatch }),
        body: input.reason ? { reason: input.reason } : {},
      };
    },
    applyServerCredentialMetadata(record: MaskedCredentialRecord): ByokCustodyState {
      const exists = credentials.some((c) => c.credential_ref === record.credential_ref);
      credentials = exists
        ? credentials.map((c) => (c.credential_ref === record.credential_ref ? { ...record } : c))
        : [...credentials, { ...record }];
      if (!selectedCredentialRef && record.status === "active") selectedCredentialRef = record.credential_ref;
      return snapshot();
    },
    buildGenerationInferenceConfig(): ByokInferenceConfig {
      if (mode === "hosted") return { mode: "hosted", model_policy_id: modelPolicyId, allow_hosted_fallback: false };
      const activeCred = credentials.find((c) => c.credential_ref === selectedCredentialRef);
      if (!activeCred || activeCred.status !== "active") {
        throw new Error("BYOK mode requires an active credential; silent fallback to hosted inference is forbidden (@S28).");
      }
      return {
        mode: "byok", provider_id: activeCred.provider_id, credential_ref: activeCred.credential_ref,
        credential_version_ref: activeCred.credential_version_ref, model_policy_id: modelPolicyId, allow_hosted_fallback: false,
      };
    },
    handleByokProviderFailure(input: { errorCode: string; message: string }): ByokCustodyState {
      const activeCred = credentials.find((c) => c.credential_ref === selectedCredentialRef);
      providerFailureBanner = {
        provider_id: activeCred?.provider_id ?? "unknown-provider",
        credential_ref: selectedCredentialRef ?? "unselected",
        errorCode: input.errorCode, message: input.message, autoFallbackTriggered: false,
        remediationOptions: ["retry_byok", "rotate_key", "switch_to_hosted_explicitly"],
      };
      return snapshot();
    },
  };
}
export type ByokCustodyController = ReturnType<typeof createByokCustodyController>;

export type ReminderChannel = "email" | "web_push";

export interface QuietHoursWindow {
  start_local_time: string; end_local_time: string;
}

export interface NotificationPreferenceFixture {
  enabled: boolean; channels: ReminderChannel[]; timezone: string;
  quiet_hours: QuietHoursWindow; lead_time_minutes: number; version: number; etag?: string;
}

export interface ReminderOccurrenceRecord {
  occurrence_id: string; session_id: string; scheduled_for: string;
  status: "scheduled" | "snoozed" | "sent" | "suppressed_quiet_hours" | "cancelled";
  snoozed_until?: string | null;
}

export interface ReminderPreferenceState extends NotificationPreferenceFixture {
  occurrences: ReminderOccurrenceRecord[]; bestEffortDeliveryDisclosure: string; surfaceStyle: SurfaceStyle;
}

const BEST_EFFORT_REMINDER_DISCLOSURE =
  "Best-effort delivery disclosure: Study reminders respect your local timezone and quiet hours as opt-in nudges. Delivery is best-effort and missed reminders never lock or penalize your curriculum.";
const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertValidTimezone(tz: string): void {
  const t = tz.trim();
  if (!t || (!t.includes("/") && t !== "UTC")) throw new Error(`Invalid IANA timezone identifier: "${tz}"`);
}

function assertValidQuietHours(qh: QuietHoursWindow): void {
  if (!HH_MM_PATTERN.test(qh.start_local_time) || !HH_MM_PATTERN.test(qh.end_local_time)) {
    throw new Error(`Quiet hours must use 24-hour HH:MM local time format (got ${qh.start_local_time} - ${qh.end_local_time}).`);
  }
}

export function createReminderPreferenceController(
  initialPrefs: NotificationPreferenceFixture,
  initialOccurrences: ReminderOccurrenceRecord[] = [],
  mode: ThemeMode = "light",
) {
  assertValidTimezone(initialPrefs.timezone);
  assertValidQuietHours(initialPrefs.quiet_hours);

  const surfaceStyle = resolveSurfaceStyle("study_card", { themePreference: mode });
  let prefs: NotificationPreferenceFixture = {
    ...initialPrefs, channels: [...initialPrefs.channels], quiet_hours: { ...initialPrefs.quiet_hours },
  };
  let occurrences: ReminderOccurrenceRecord[] = initialOccurrences.map((occ) => ({ ...occ }));

  const snapshot = (): ReminderPreferenceState => ({
    ...prefs, channels: [...prefs.channels], quiet_hours: { ...prefs.quiet_hours },
    occurrences: occurrences.map((occ) => ({ ...occ })),
    bestEffortDeliveryDisclosure: BEST_EFFORT_REMINDER_DISCLOSURE, surfaceStyle,
  });

  return {
    getState: snapshot,
    buildUpdatePreferencesRequest(
      patch: Partial<Pick<NotificationPreferenceFixture, "enabled" | "channels" | "timezone" | "quiet_hours" | "lead_time_minutes">>,
      options: { ifMatch?: string } = {},
    ): ByokHttpRequest<{
      enabled: boolean; channels: ReminderChannel[]; timezone: string; quiet_hours: QuietHoursWindow; lead_time_minutes: number;
    }> {
      const nextTimezone = patch.timezone ?? prefs.timezone;
      const nextQuietHours = patch.quiet_hours ? { ...patch.quiet_hours } : { ...prefs.quiet_hours };
      assertValidTimezone(nextTimezone);
      assertValidQuietHours(nextQuietHours);

      const ifMatch = options.ifMatch ?? prefs.etag ?? `"notification-prefs-v${prefs.version}"`;
      const nextVersion = prefs.version + 1;
      prefs = {
        enabled: patch.enabled ?? prefs.enabled,
        channels: patch.channels ? [...patch.channels] : [...prefs.channels],
        timezone: nextTimezone, quiet_hours: nextQuietHours,
        lead_time_minutes: patch.lead_time_minutes ?? prefs.lead_time_minutes,
        version: nextVersion, etag: `"notification-prefs-v${nextVersion}"`,
      };

      return {
        method: "PUT", path: "/v1/me/notification-preferences",
        headers: buildOperationHeaders("updateNotificationPreferences", { ifMatch }),
        body: {
          enabled: prefs.enabled, channels: [...prefs.channels], timezone: prefs.timezone,
          quiet_hours: { ...prefs.quiet_hours }, lead_time_minutes: prefs.lead_time_minutes,
        },
      };
    },
    buildSnoozeReminderRequest(input: {
      occurrence_id: string; snooze_minutes?: number; snooze_until?: string;
    }): ByokHttpRequest<{ snooze_minutes?: number; snooze_until?: string }> {
      const target = occurrences.find((occ) => occ.occurrence_id === input.occurrence_id);
      if (!target) throw new Error(`Unknown reminder occurrence_id: ${input.occurrence_id}`);
      if (input.snooze_minutes !== undefined && (input.snooze_minutes < 5 || input.snooze_minutes > 1440)) {
        throw new Error("snooze_minutes must be between 5 and 1440.");
      }
      if (input.snooze_minutes === undefined && !input.snooze_until?.trim()) {
        throw new Error("Either snooze_minutes or snooze_until must be provided.");
      }

      const computedUntil =
        input.snooze_until ??
        new Date(new Date(target.scheduled_for).getTime() + (input.snooze_minutes ?? 30) * 60_000).toISOString();

      occurrences = occurrences.map((occ) =>
        occ.occurrence_id === input.occurrence_id ? { ...occ, status: "snoozed", snoozed_until: computedUntil } : occ,
      );

      return {
        method: "POST",
        path: `/v1/me/reminders/${encodeURIComponent(input.occurrence_id)}/snooze`,
        headers: buildOperationHeaders("snoozeReminderOccurrence"),
        body: {
          ...(input.snooze_minutes !== undefined ? { snooze_minutes: input.snooze_minutes } : {}),
          ...(input.snooze_until ? { snooze_until: input.snooze_until } : {}),
        },
      };
    },
  };
}
export type ReminderPreferenceController = ReturnType<typeof createReminderPreferenceController>;

export interface PwaCacheCandidateInput {
  path: string; method?: string; cacheControlHeader?: string;
  containsSecretOrCredential?: boolean; containsUnapprovedFullText?: boolean;
  publicationStatus?: "published" | "withdrawn" | "restricted";
}

export interface PwaCacheEligibilityDecision {
  allowCache: boolean; cacheBucket: "static-shell-v1" | "active-study-metadata-v1" | "none"; reason: string;
}

const denyCache = (reason: string): PwaCacheEligibilityDecision => ({ allowCache: false, cacheBucket: "none", reason });

export function evaluatePwaCacheEligibility(input: PwaCacheCandidateInput): PwaCacheEligibilityDecision {
  if ((input.method ?? "GET").toUpperCase() !== "GET") return denyCache("non_get_request");
  if (input.containsSecretOrCredential) return denyCache("contains_secret_or_credential");
  if (input.containsUnapprovedFullText) return denyCache("contains_unapproved_full_text");
  if (input.publicationStatus === "withdrawn" || input.publicationStatus === "restricted") {
    return denyCache(`publication_${input.publicationStatus}`);
  }
  if ((input.cacheControlHeader ?? "").toLowerCase().includes("no-store")) return denyCache("cache_control_no_store");

  const p = input.path.trim();
  if (
    p.startsWith("/v1/me") || p.startsWith("/me/") || p === "/me" ||
    p.startsWith("/v1/auth") || p.startsWith("/auth/") || p.includes("/credentials")
  ) {
    return denyCache("authenticated_identity_or_credential_route");
  }
  if (
    p.startsWith("/assets/") || p.startsWith("/static/") || p === "/manifest.webmanifest" ||
    p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".woff2")
  ) {
    return { allowCache: true, cacheBucket: "static-shell-v1", reason: "static_shell_asset" };
  }
  if (p.startsWith("/v1/curricula/") || p.startsWith("/v1/catalog/")) {
    return { allowCache: true, cacheBucket: "active-study-metadata-v1", reason: "permitted_study_metadata" };
  }
  return denyCache("unclassified_route_default_deny");
}
