import net from "node:net";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const RP_NAME = "Syllabus.io";
const CEREMONY_TTL_MS = 5 * 60 * 1000;

// Well-known AAGUIDs used strictly for UX labels in Profile & Settings (never for security or access decisions).
const KNOWN_AAGUID_NAMES = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "Apple Passkeys",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
};

export function resolvePasskeyProviderName(aaguid, credentialDeviceType) {
  const normalized = String(aaguid ?? "").trim().toLowerCase();
  if (KNOWN_AAGUID_NAMES[normalized]) {
    return KNOWN_AAGUID_NAMES[normalized];
  }
  return credentialDeviceType === "multiDevice" ? "Synced passkey" : "Device passkey";
}

/**
 * Resolves the WebAuthn Relying Party ID and expected Origin for the incoming request.
 * WebAuthn requires a domain name (such as `localhost` in local dev or `https://...` in production)
 * and rejects bare IPv4/IPv6 literals like `127.0.0.1`.
 */
export function resolveWebAuthnRpConfig(req, env = process.env, explicitOrigin = undefined) {
  const originHeader = typeof req.headers?.origin === "string" ? req.headers.origin.trim() : "";
  const hostHeader = typeof req.headers?.host === "string" ? req.headers.host.trim() : "";
  const protoHeader = typeof req.headers?.["x-forwarded-proto"] === "string"
    ? req.headers["x-forwarded-proto"].split(",")[0].trim()
    : "";

  let expectedOrigin = explicitOrigin || originHeader;
  if (!expectedOrigin) {
    if (hostHeader) {
      const scheme = protoHeader || (hostHeader.startsWith("localhost") || hostHeader.startsWith("127.0.0.1") ? "http" : "https");
      expectedOrigin = `${scheme}://${hostHeader}`;
    } else if (env.PUBLIC_WEB_ORIGIN?.trim()) {
      expectedOrigin = env.PUBLIC_WEB_ORIGIN.trim().replace(/\/+$/, "");
    } else {
      expectedOrigin = "http://localhost:3000";
    }
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(expectedOrigin);
  } catch {
    throw new Error("Invalid WebAuthn request origin.");
  }

  const hostname = parsedOrigin.hostname.toLowerCase();
  if (net.isIP(hostname) !== 0) {
    const portSuffix = parsedOrigin.port ? `:${parsedOrigin.port}` : "";
    const err = new Error(
      `Passkeys require http://localhost${portSuffix} instead of IP address ${hostname}.`,
    );
    err.code = "WEBAUTHN_IP_ORIGIN";
    err.localhostOrigin = `${parsedOrigin.protocol}//localhost${portSuffix}`;
    throw err;
  }

  const configuredRpId = env.WEBAUTHN_RP_ID?.trim().toLowerCase();
  const rpID = configuredRpId && (hostname === configuredRpId || hostname.endsWith(`.${configuredRpId}`))
    ? configuredRpId
    : hostname;

  return {
    rpName: RP_NAME,
    rpID,
    expectedOrigin: parsedOrigin.origin,
  };
}

export async function createPasskeyRegistrationOptions({
  rpID,
  rpName = RP_NAME,
  expectedOrigin,
  account,
  existingCredentials = [],
  promotion = false,
  nowMs = Date.now(),
}) {
  const userVerification = "preferred";
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new Uint8Array(Buffer.from(account.accountId, "utf8")),
    userName: account.email,
    userDisplayName: account.username || account.email.split("@")[0] || account.email,
    attestationType: "none",
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.id,
      ...(Array.isArray(cred.transports) && cred.transports.length > 0 ? { transports: cred.transports } : {}),
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification,
      ...(promotion ? { authenticatorAttachment: "platform" } : {}),
    },
  });

  const ceremony = {
    type: "registration",
    challenge: options.challenge,
    rpID,
    expectedOrigin,
    expectedUserVerification: userVerification,
    accountId: account.accountId,
    expiresAt: nowMs + CEREMONY_TTL_MS,
  };

  return { options, ceremony };
}

export async function verifyPasskeyRegistration({
  response,
  ceremony,
  account,
  nowMs = Date.now(),
}) {
  if (!ceremony || ceremony.type !== "registration" || ceremony.accountId !== account.accountId) {
    throw new Error("No active passkey registration challenge was found. Try again.");
  }
  if (ceremony.expiresAt < nowMs) {
    throw new Error("Passkey registration timed out. Try again.");
  }
  if (!response || typeof response.id !== "string") {
    throw new Error("Malformed passkey attestation payload.");
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: ceremony.expectedOrigin,
    expectedRPID: ceremony.rpID,
    requireUserPresence: true,
    requireUserVerification: ceremony.expectedUserVerification === "required",
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey attestation signature could not be verified.");
  }

  const { registrationInfo } = verification;
  const transports = Array.isArray(response?.response?.transports)
    ? response.response.transports.filter((t) => typeof t === "string")
    : (registrationInfo.credential.transports ?? []);

  const storedCredential = {
    id: registrationInfo.credential.id,
    passkeyUserId: account.accountId,
    email: account.email,
    credentialPublicKey: Buffer.from(registrationInfo.credential.publicKey).toString("base64url"),
    credentialType: "public-key",
    credentialDeviceType: registrationInfo.credentialDeviceType,
    credentialBackedUp: Boolean(registrationInfo.credentialBackedUp),
    aaguid: registrationInfo.aaguid || "00000000-0000-0000-0000-000000000000",
    name: resolvePasskeyProviderName(registrationInfo.aaguid, registrationInfo.credentialDeviceType),
    transports,
    registeredAt: nowMs,
    counter: registrationInfo.credential.counter,
  };

  return { verified: true, storedCredential };
}

export async function createPasskeyAuthenticationOptions({
  rpID,
  expectedOrigin,
  nowMs = Date.now(),
}) {
  const userVerification = "preferred";
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [],
    userVerification,
  });

  const ceremony = {
    type: "authentication",
    challenge: options.challenge,
    rpID,
    expectedOrigin,
    expectedUserVerification: userVerification,
    expiresAt: nowMs + CEREMONY_TTL_MS,
  };

  return { options, ceremony };
}

export async function verifyPasskeyAuthentication({
  response,
  ceremony,
  lookupCredentialById,
  nowMs = Date.now(),
}) {
  if (!ceremony || ceremony.type !== "authentication") {
    return { status: 400, verified: false, error: "No active passkey sign-in challenge was found. Try again." };
  }
  if (ceremony.expiresAt < nowMs) {
    return { status: 400, verified: false, error: "Passkey sign-in timed out. Try again." };
  }
  if (!response || typeof response.id !== "string") {
    return { status: 400, verified: false, error: "Malformed passkey assertion payload." };
  }

  const storedCredential = lookupCredentialById(response.id);
  if (!storedCredential) {
    // Explicit 404 allows unauthenticated clients to invoke PublicKeyCredential.signalUnknownCredential().
    return {
      status: 404,
      verified: false,
      error: "This passkey is not registered to any account.",
    };
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.expectedOrigin,
      expectedRPID: ceremony.rpID,
      credential: {
        id: storedCredential.id,
        publicKey: new Uint8Array(Buffer.from(storedCredential.credentialPublicKey, "base64url")),
        counter: storedCredential.counter,
        ...(Array.isArray(storedCredential.transports) && storedCredential.transports.length > 0
          ? { transports: storedCredential.transports }
          : {}),
      },
      requireUserVerification: ceremony.expectedUserVerification === "required",
    });

    if (!verification.verified || !verification.authenticationInfo) {
      return { status: 401, verified: false, error: "Passkey verification failed." };
    }

    return {
      status: 200,
      verified: true,
      storedCredential,
      authenticationInfo: verification.authenticationInfo,
    };
  } catch (err) {
    return {
      status: 401,
      verified: false,
      error: err instanceof Error ? err.message : "Passkey signature verification failed.",
    };
  }
}

export function toPublicPasskeySummary(cred) {
  return {
    id: cred.id,
    name: cred.name || resolvePasskeyProviderName(cred.aaguid, cred.credentialDeviceType),
    credentialDeviceType: cred.credentialDeviceType === "multiDevice" ? "multiDevice" : "singleDevice",
    credentialBackedUp: Boolean(cred.credentialBackedUp),
    registeredAt: Number(cred.registeredAt) || 0,
    ...(cred.lastUsedAt ? { lastUsedAt: Number(cred.lastUsedAt) } : {}),
  };
}
