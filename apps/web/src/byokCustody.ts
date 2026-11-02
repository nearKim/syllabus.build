import { buildOperationHeaders } from "@syllabus/api-client";
import { resolveSurfaceStyle, type ResolvedSurfaceStyle as SurfaceStyle, type ThemeMode } from "@syllabus/ui";
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
  "Server custody disclosure: Keys are sent to the server and encrypted at rest for background jobs. They are not saved in browser storage or URLs.";
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
