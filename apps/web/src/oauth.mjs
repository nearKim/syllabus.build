import crypto from "node:crypto";
import fs from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { GitHubMark, GoogleMark, PERSONAS } from "./components/AuthDialog.tsx";
import { initialsOf, usernameOf } from "./auth.ts";

export const OAUTH_PROVIDERS = ["google", "github"];

export function isOAuthProvider(value) {
  return value === "google" || value === "github";
}

export function oauthProviderLabel(provider) {
  return provider === "google" ? "Google" : "GitHub";
}

/** Loads key=value pairs from a `.env` file without overwriting existing `process.env` keys. */
export function loadDotEnvIfPresent(envFilePath, targetEnv = process.env) {
  if (!fs.existsSync(envFilePath)) return;
  const raw = fs.readFileSync(envFilePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && targetEnv[key] === undefined) {
      targetEnv[key] = val;
    }
  }
}

export function generateRandomBase64Url(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function computePkceS256Challenge(codeVerifier) {
  return crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export function generatePkcePair() {
  const codeVerifier = generateRandomBase64Url(32);
  return {
    codeVerifier,
    codeChallenge: computePkceS256Challenge(codeVerifier),
  };
}

export function verifyPkceS256(codeVerifier, expectedChallenge) {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const actual = Buffer.from(computePkceS256Challenge(codeVerifier), "utf8");
  const expected = Buffer.from(expectedChallenge.trim(), "utf8");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function signOAuthStateCookie(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(encoded, "ascii").digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyOAuthStateCookie(cookieValue, secret, nowMs = Date.now()) {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return null;
  const encoded = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expectedSig = crypto.createHmac("sha256", secret).update(encoded, "ascii").digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.state !== "string" || !isOAuthProvider(parsed.provider)) return null;
    if (typeof parsed.codeVerifier !== "string" || typeof parsed.exp !== "number" || parsed.exp < nowMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hashAccountPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyAccountPassword(password, storedHash) {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1] ?? "";
  const expectedHex = parts[2] ?? "";
  if (!salt || expectedHex.length !== 64) return false;
  const actual = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function resolveProviderCredentials(provider, env = process.env) {
  const clientId = (provider === "google" ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID)?.trim() ?? "";
  const clientSecret = (provider === "google" ? env.GOOGLE_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET)?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isLocalDevEnv(env = process.env) {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  return appEnv !== "production" && appEnv !== "staging";
}

export function buildOAuthCallbackUrl(publicOrigin, provider) {
  return `${publicOrigin.replace(/\/+$/, "")}/auth/oauth/${provider}/callback`;
}

export function buildOAuthAuthorizeRedirect(options) {
  const env = options.env ?? process.env;
  const live = resolveProviderCredentials(options.provider, env);
  const redirectUri = buildOAuthCallbackUrl(options.publicOrigin, options.provider);

  if (live) {
    const base =
      options.provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : "https://github.com/login/oauth/authorize";
    const url = new URL(base);
    url.searchParams.set("client_id", live.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      options.provider === "google" ? "openid email profile" : "read:user user:email",
    );
    url.searchParams.set("state", options.state);
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (options.provider === "google") {
      url.searchParams.set("prompt", "select_account");
    }
    return { mode: "live", url: url.toString() };
  }

  if (!isLocalDevEnv(env)) {
    throw new Error(`OAuth credentials are not configured for ${oauthProviderLabel(options.provider)}.`);
  }

  const sandboxUrl = new URL(
    `${options.publicOrigin.replace(/\/+$/, "")}/auth/dev-idp/${options.provider}/authorize`,
  );
  sandboxUrl.searchParams.set("client_id", `dev-${options.provider}-client`);
  sandboxUrl.searchParams.set("redirect_uri", redirectUri);
  sandboxUrl.searchParams.set("response_type", "code");
  sandboxUrl.searchParams.set(
    "scope",
    options.provider === "google" ? "openid email profile" : "read:user user:email",
  );
  sandboxUrl.searchParams.set("state", options.state);
  sandboxUrl.searchParams.set("code_challenge", options.codeChallenge);
  sandboxUrl.searchParams.set("code_challenge_method", "S256");
  return { mode: "dev_sandbox", url: sandboxUrl.toString() };
}

export async function exchangeLiveOAuthCode(options) {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const creds = resolveProviderCredentials(options.provider, options.env);
  if (!creds) {
    throw new Error(`Missing OAuth client credentials for ${options.provider}`);
  }

  if (options.provider === "google") {
    const tokenRes = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code: options.code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: options.redirectUri,
        grant_type: "authorization_code",
        code_verifier: options.codeVerifier,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`Google token exchange failed (${tokenRes.status})`);
    }
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) throw new Error("Google token response did not include access_token");

    const profileRes = await fetchFn("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/json" },
    });
    if (!profileRes.ok) {
      throw new Error(`Google userinfo request failed (${profileRes.status})`);
    }
    const profile = await profileRes.json();
    if (!profile.sub || !profile.email) {
      throw new Error("Google userinfo did not return required `sub` and `email` claims");
    }
    return {
      provider: "google",
      providerSubject: String(profile.sub),
      email: String(profile.email).trim().toLowerCase(),
      emailVerified: profile.email_verified !== false,
      displayName: profile.name?.trim() || undefined,
      avatarUrl: profile.picture?.trim() || undefined,
    };
  }

  // GitHub OAuth 2.0 exchange
  const tokenRes = await fetchFn("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`GitHub token exchange failed (${tokenRes.status})`);
  }
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error(tokenJson.error || "GitHub token response did not include access_token");
  }

  const ghHeaders = {
    Authorization: `Bearer ${tokenJson.access_token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Syllabus.build-OAuth",
  };
  const userRes = await fetchFn("https://api.github.com/user", { headers: ghHeaders });
  if (!userRes.ok) {
    throw new Error(`GitHub user profile request failed (${userRes.status})`);
  }
  const ghUser = await userRes.json();
  let email = ghUser.email?.trim().toLowerCase() ?? "";
  let emailVerified = Boolean(email);

  if (!email) {
    const emailsRes = await fetchFn("https://api.github.com/user/emails", { headers: ghHeaders });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const chosen =
        emails.find((e) => e.primary && e.verified) ??
        emails.find((e) => e.verified) ??
        emails[0];
      if (chosen?.email) {
        email = String(chosen.email).trim().toLowerCase();
        emailVerified = chosen.verified !== false;
      }
    }
  }
  if (!ghUser.id || !email) {
    throw new Error("GitHub account did not expose a verified email address");
  }

  return {
    provider: "github",
    providerSubject: String(ghUser.id),
    email,
    emailVerified,
    displayName: (ghUser.name ?? ghUser.login ?? "").trim() || undefined,
    avatarUrl: ghUser.avatar_url?.trim() || undefined,
  };
}

export function createDevIdpCodeStore() {
  const codes = new Map();

  return {
    issueCode(input) {
      const now = Date.now();
      for (const [k, rec] of codes) {
        if (rec.expiresAt < now) codes.delete(k);
      }
      const code = `devcode_${generateRandomBase64Url(24)}`;
      codes.set(code, {
        provider: input.provider,
        codeChallenge: input.codeChallenge,
        redirectUri: input.redirectUri,
        profile: input.profile,
        expiresAt: now + (input.ttlMs ?? 5 * 60 * 1000),
      });
      return code;
    },

    exchangeCode(input) {
      const record = codes.get(input.code);
      codes.delete(input.code);
      if (!record || record.expiresAt < Date.now()) {
        throw new Error("Authorization code expired or already used");
      }
      if (record.provider !== input.provider || record.redirectUri !== input.redirectUri) {
        throw new Error("Authorization code provider or redirect_uri mismatch");
      }
      if (!verifyPkceS256(input.codeVerifier, record.codeChallenge)) {
        throw new Error("PKCE S256 code_verifier check failed");
      }
      return record.profile;
    },
  };
}

function escapeAttr(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const PLUS_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
const CHEVRON_SVG =
  '<svg class="dev-oauth-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/**
 * The local dev identity provider's account chooser. Each persona row posts its own authorize form. "Use another
 * account" opens a form for any email address. Cancel returns to the app's callback with `access_denied`.
 */
export function renderDevOAuthConsentHtml(params) {
  const label = escapeAttr(oauthProviderLabel(params.provider));
  const envPrefix = params.provider === "google" ? "GOOGLE" : "GITHUB";
  const theme = params.theme === "dark" ? "dark" : "light";
  const action = `/auth/dev-idp/${escapeAttr(params.provider)}/authorize`;
  const providerMark = renderToString(h(params.provider === "google" ? GoogleMark : GitHubMark, {}));
  const flowFields = `<input type="hidden" name="redirect_uri" value="${escapeAttr(params.redirectUri)}" />
          <input type="hidden" name="state" value="${escapeAttr(params.state)}" />
          <input type="hidden" name="code_challenge" value="${escapeAttr(params.codeChallenge)}" />`;
  const personaRows = Object.values(PERSONAS)
    .map(
      (persona) => `
      <li>
        <form method="POST" action="${action}">
          ${flowFields}
          <input type="hidden" name="email" value="${escapeAttr(persona.email)}" />
          <button type="submit" class="dev-oauth-account">
            <span class="dev-oauth-avatar" data-tone="${escapeAttr(persona.role)}" aria-hidden="true">${escapeAttr(initialsOf(persona))}</span>
            <span class="dev-oauth-account-text">
              <span class="dev-oauth-account-name">@${escapeAttr(usernameOf(persona))}</span>
              <span class="dev-oauth-account-email">${escapeAttr(persona.email)}</span>
            </span>
            <span class="dev-oauth-account-role">${escapeAttr(persona.role)}</span>
          </button>
        </form>
      </li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="${theme}" />
  <title>Continue with ${label} · Syllabus.build</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="dev-oauth-shell">
    <section class="dev-oauth-card" aria-labelledby="dev-oauth-title">
      <span class="dev-oauth-provider-mark" aria-hidden="true">${providerMark}</span>
      <h1 id="dev-oauth-title" class="dev-oauth-title">Continue with ${label}</h1>
      <p class="dev-oauth-lede">Choose an account for <strong>Syllabus.build</strong>.</p>

      <ul class="dev-oauth-accounts">${personaRows}
        <li>
          <details class="dev-oauth-other">
            <summary class="dev-oauth-account">
              <span class="dev-oauth-avatar" data-tone="add" aria-hidden="true">${PLUS_SVG}</span>
              <span class="dev-oauth-account-name">Use another account</span>
              ${CHEVRON_SVG}
            </summary>
            <form method="POST" action="${action}" class="dev-oauth-other-form">
              ${flowFields}
              <div class="auth-field">
                <label class="auth-label" for="dev-oauth-email">Email</label>
                <input id="dev-oauth-email" type="email" name="email" autocomplete="email" spellcheck="false" autocapitalize="off" placeholder="you@example.com" required />
              </div>
              <button type="submit" class="btn-primary auth-submit-btn">Continue as this account</button>
            </form>
          </details>
        </li>
      </ul>

      <div class="dev-oauth-foot">
        <a class="dev-oauth-cancel" href="${escapeAttr(params.redirectUri)}?error=access_denied&amp;state=${encodeURIComponent(params.state)}">Cancel</a>
      </div>
    </section>
    <p class="dev-oauth-note">
      Local OAuth 2.0 sandbox with PKCE (S256). Set <code>${envPrefix}_CLIENT_ID</code> and <code>${envPrefix}_CLIENT_SECRET</code> in <code>.env</code> to sign in with live ${label}.
    </p>
  </main>
</body>
</html>`;
}
