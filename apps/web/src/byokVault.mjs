import crypto from "node:crypto";

export const DEFAULT_CREDENTIAL_META = Object.freeze({
  openai: { credentialRef: "cred-openai-1", label: "OpenAI API Key" },
  anthropic: { credentialRef: "cred-anthropic-1", label: "Anthropic Claude Key" },
  google_gemini: { credentialRef: "cred-gemini-1", label: "Google Gemini Key" },
});

function buildAad(accountId, providerId, version) {
  return Buffer.from(`syllabus-byok:${accountId}:${providerId}:v${version}`, "utf8");
}

/**
 * Resolves a 32-byte AES-256-GCM master key from `BYOK_MASTER_KEY`.
 * Disposable in-memory servers use an ephemeral CSPRNG key.
 */
export function resolveByokMasterKey(options = {}) {
  const rawEnv = options.envKey?.trim();
  if (rawEnv) {
    if (/^[0-9a-fA-F]{64}$/.test(rawEnv)) {
      return Buffer.from(rawEnv, "hex");
    }
    if (/^[A-Za-z0-9+/]{43}=$/.test(rawEnv)) {
      const decoded = Buffer.from(rawEnv, "base64");
      if (decoded.length === 32) return decoded;
    }
    throw new Error("BYOK_MASTER_KEY must be a 32-byte hex or base64 key.");
  }

  if (options.persistent) {
    throw new Error("BYOK_MASTER_KEY is required for persistent account data.");
  }

  return crypto.randomBytes(32);
}

/**
 * Encrypts a learner's raw provider API key with AES-256-GCM and AAD bound to
 * `(accountId, providerId, version)`. The raw secret is never stored in plaintext.
 */
export function sealByokApiKey(params) {
  const trimmedKey = String(params.rawApiKey ?? "").trim();
  if (trimmedKey.length < 8) {
    throw new Error("API key must be at least 8 characters.");
  }
  if (!Buffer.isBuffer(params.masterKey) || params.masterKey.length !== 32) {
    throw new Error("BYOK master key must be 32 bytes for AES-256-GCM.");
  }

  const defaults = DEFAULT_CREDENTIAL_META[params.providerId] ?? {
    credentialRef: `cred-${params.providerId}-1`,
    label: `${params.providerId} API Key`,
  };
  const credentialRef = params.credentialRef?.trim() || defaults.credentialRef;
  const label = params.label?.trim() || defaults.label;
  const version = (params.previousVersion ?? 0) + 1;
  const nowIso = params.nowIso ?? new Date().toISOString();

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", params.masterKey, iv);
  cipher.setAAD(buildAad(params.accountId, params.providerId, version));
  const ciphertext = Buffer.concat([cipher.update(trimmedKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const maskedSuffix = trimmedKey.slice(-4);
  const fingerprint = crypto.createHash("sha256").update(trimmedKey, "utf8").digest("hex");

  return {
    alg: "aes-256-gcm",
    credential_ref: credentialRef,
    provider_id: params.providerId,
    label,
    version,
    masked_suffix: maskedSuffix,
    key_fingerprint_sha256: fingerprint,
    iv_b64: iv.toString("base64"),
    tag_b64: tag.toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
    updated_at: nowIso,
  };
}

/**
 * Decrypts a stored `EncryptedByokEnvelope` just-in-time in memory for an outbound
 * AI provider request. Throws if AAD `(accountId, providerId, version)` or GCM tag fails.
 */
export function openByokApiKey(params) {
  if (!Buffer.isBuffer(params.masterKey) || params.masterKey.length !== 32) {
    throw new Error("BYOK master key must be 32 bytes for AES-256-GCM.");
  }
  const iv = Buffer.from(params.envelope.iv_b64, "base64");
  const tag = Buffer.from(params.envelope.tag_b64, "base64");
  const ciphertext = Buffer.from(params.envelope.ciphertext_b64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", params.masterKey, iv);
  decipher.setAAD(buildAad(params.accountId, params.envelope.provider_id, params.envelope.version));
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Projects a stored envelope into a redacted `MaskedCredentialRecord` safe for UI state and SSR.
 */
export function toMaskedCredentialRecord(envelope) {
  return {
    credential_ref: envelope.credential_ref,
    provider_id: envelope.provider_id,
    label: envelope.label,
    status: "active",
    credential_version_ref: `${envelope.credential_ref}-v${envelope.version}`,
    masked_hint: `••••${envelope.masked_suffix}`,
    masked_suffix: envelope.masked_suffix,
    version: envelope.version,
    etag: `"credential-${envelope.credential_ref}-v${envelope.version}"`,
    updated_at: envelope.updated_at,
  };
}
