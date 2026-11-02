import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createWebAppServer } from "../src/server.mjs";
import { exchangeLiveOAuthCode } from "../src/oauth.mjs";
import { backendSessionResponse, cookieHeader, signInWithDevOAuth } from "./helpers/devOAuth.mjs";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const signingKey = { ...publicKey.export({ format: "jwk" }), kid: "apple-test-key", alg: "RS256", use: "sig" };
const exchangeSecret = "ef".repeat(32);
const appleEnv = { APPLE_CLIENT_ID: "org.example.service", APPLE_CLIENT_SECRET: "test-client-secret" };

function identityToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: signingKey.kid })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://appleid.apple.com", aud: appleEnv.APPLE_CLIENT_ID,
    sub: "apple-subject", nonce: "expected-nonce", iat: now, exp: now + 300,
    email: "apple@example.test", email_verified: true, ...overrides,
  })).toString("base64url");
  const input = `${header}.${claims}`;
  return `${input}.${crypto.sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

function saveCookies(response, jar) {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const split = pair.indexOf("=");
    const name = pair.slice(0, split);
    const value = pair.slice(split + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("Apple sandbox signs in through the backend as a User", async () => {
  const mockFetch = async (url) => {
    if (String(url).endsWith("/v1/auth/oauth/apple/callback")) {
      return new Response(JSON.stringify({ account_id: "apple-account", session_token: "test-session", roles: ["user"], expires_at: new Date(Date.now() + 60_000).toISOString() }), { status: 200 });
    }
    if (String(url).endsWith("/v1/auth/session")) return backendSessionResponse("apple-account");
    return new Response("{}", { status: 503 });
  };
  const { server } = createWebAppServer({
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: exchangeSecret },
    fetchImpl: mockFetch,
    apiBaseUrl: "http://127.0.0.1:9",
  });
  const baseUrl = await listen(server);
  const jar = new Map();
  try {
    const clientJs = await (await fetch(`${baseUrl}/client.js`)).text();
    const pendingStart = clientJs.indexOf("function markAuthPending(");
    const pendingEnd = clientJs.indexOf("function applyServerPayload(", pendingStart);
    assert.ok(pendingStart >= 0 && pendingEnd > pendingStart);
    const markPending = new Function(`${clientJs.slice(pendingStart, pendingEnd)}; return markAuthPending;`)();
    const surface = { dataset: {} };
    const control = {
      closest: (selector) => selector === ".auth-surface" ? surface : null,
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
    };
    const clear = markPending(control);
    assert.equal(typeof clear, "function");
    assert.equal(surface.dataset.pending, "true");
    assert.equal(markPending(control), null);
    clear();
    assert.equal(surface.dataset.pending, undefined);

    await signInWithDevOAuth(baseUrl, jar, "apple@example.test", "apple");
    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: cookieHeader(jar) },
      body: JSON.stringify({ action: "noop" }),
    });
    const payload = await response.json();
    assert.equal(payload.state.authStatus, "authenticated");
    assert.equal(payload.state.account.role, "User");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Apple form callback validates state and restores the original session", async () => {
  let nonce;
  let tokenRequests = 0;
  let backendProfile;
  const mockFetch = async (url, init = {}) => {
    const target = String(url);
    if (target === "https://appleid.apple.com/auth/token") {
      tokenRequests += 1;
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("client_id"), appleEnv.APPLE_CLIENT_ID);
      assert.equal(body.get("redirect_uri"), "https://app.example.test/auth/oauth/apple/callback");
      assert.equal(body.get("grant_type"), "authorization_code");
      return new Response(JSON.stringify({ id_token: identityToken({ nonce }) }), { status: 200 });
    }
    if (target === "https://appleid.apple.com/auth/keys") {
      return new Response(JSON.stringify({ keys: [signingKey] }), { status: 200 });
    }
    if (target.endsWith("/v1/auth/oauth/apple/callback")) {
      backendProfile = JSON.parse(init.body);
      assert.equal(init.headers["x-auth-exchange-secret"], exchangeSecret);
      return new Response(JSON.stringify({ account_id: "apple-account", session_token: "test-session", roles: ["user"], expires_at: new Date(Date.now() + 60_000).toISOString() }), { status: 200 });
    }
    if (target.endsWith("/v1/auth/session")) return backendSessionResponse("apple-account");
    return new Response("{}", { status: 503 });
  };
  const { server } = createWebAppServer({
    env: { APP_ENV: "production", ...appleEnv, AUTH_EXCHANGE_SECRET: exchangeSecret, PUBLIC_WEB_ORIGIN: "https://app.example.test" },
    byokMasterKey: "ab".repeat(32),
    fetchImpl: mockFetch,
    apiBaseUrl: "http://127.0.0.1:9",
  });
  const baseUrl = await listen(server);
  const jar = new Map();
  try {
    const start = await fetch(`${baseUrl}/auth/oauth/apple`, { redirect: "manual" });
    saveCookies(start, jar);
    const originalSid = jar.get("cio_sid");
    const stateCookie = start.headers.getSetCookie().find((cookie) => cookie.startsWith("cio_oauth="));
    assert.match(stateCookie, /SameSite=None; Secure/);
    const authorize = new URL(start.headers.get("location"));
    assert.equal(authorize.origin, "https://appleid.apple.com");
    assert.equal(authorize.searchParams.get("response_mode"), "form_post");
    assert.equal(authorize.searchParams.get("scope"), "email");
    assert.equal(authorize.searchParams.has("code_challenge"), false);
    nonce = authorize.searchParams.get("nonce");
    const state = authorize.searchParams.get("state");
    const headers = { "content-type": "application/x-www-form-urlencoded", Cookie: `cio_oauth=${jar.get("cio_oauth")}`, Origin: "https://appleid.apple.com", "Sec-Fetch-Site": "cross-site" };
    const forged = await fetch(`${baseUrl}/auth/oauth/apple/callback`, {
      method: "POST", headers, body: new URLSearchParams({ code: "forged", state: "wrong" }), redirect: "manual",
    });
    assert.equal(forged.status, 400);
    assert.equal(forged.headers.getSetCookie().length, 0);
    assert.equal(tokenRequests, 0);

    const callback = await fetch(`${baseUrl}/auth/oauth/apple/callback`, {
      method: "POST", headers, body: new URLSearchParams({ code: "apple-code", state }), redirect: "manual",
    });
    assert.equal(callback.status, 302);
    saveCookies(callback, jar);
    assert.equal(jar.get("cio_sid"), originalSid);
    assert.equal(tokenRequests, 1);
    assert.equal(backendProfile.provider_subject, "apple-subject");
    assert.equal(backendProfile.email_verified, true);

    const stateResponse = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST", headers: { "content-type": "application/json", Cookie: cookieHeader(jar) },
      body: JSON.stringify({ action: "noop" }),
    });
    const payload = await stateResponse.json();
    assert.equal(payload.state.authStatus, "authenticated");
    assert.equal(payload.state.account.role, "User");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Apple identity verification rejects invalid claims and signatures", async () => {
  const now = Math.floor(Date.now() / 1000);
  const valid = identityToken();
  const parts = valid.split(".");
  const badSignature = `${parts[0]}.${parts[1]}.${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  const invalidTokens = [
    identityToken({ nonce: "wrong" }),
    identityToken({ aud: "other-client" }),
    identityToken({ exp: now - 1 }),
    identityToken({ email_verified: false }),
    badSignature,
  ];
  for (const token of invalidTokens) {
    const fetchImpl = async (url) => new Response(JSON.stringify(
      String(url).endsWith("/auth/keys") ? { keys: [signingKey] } : { id_token: token },
    ), { status: 200 });
    await assert.rejects(exchangeLiveOAuthCode({
      provider: "apple", code: "test-code", nonce: "expected-nonce",
      redirectUri: "https://app.example.test/auth/oauth/apple/callback", env: appleEnv, fetchImpl,
    }), /Apple/);
  }
});
