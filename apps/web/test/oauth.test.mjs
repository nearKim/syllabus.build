import assert from "node:assert/strict";
import test from "node:test";
import { createSyllabusWebAppController } from "../src/index.ts";
import { createWebAppServer } from "../src/server.mjs";
import { backendSessionResponse } from "./helpers/devOAuth.mjs";

function parseCookies(res, jar = new Map()) {
  const setCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  for (const raw of setCookies) {
    const first = raw.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const key = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    if (!val || raw.includes("Max-Age=0")) jar.delete(key);
    else jar.set(key, val);
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

// The sign-in dialog, from its tag to its end.
function authDialogOf(html) {
  const start = html.indexOf('<dialog id="dialog-auth"');
  assert.ok(start >= 0, "sign-in dialog is missing");
  return html.slice(start, html.indexOf("</dialog>", start));
}

test("AuthDialog offers OAuth and passkeys without password or email-code controls", () => {
  const app = createSyllabusWebAppController({ authStatus: "guest", topLevel: "Explore" });
  app.openDialog("dialog-auth");
  const html = authDialogOf(app.renderHtml());
  assert.ok(html.includes('<h2 id="dialog-auth-title" class="auth-title">Continue to Syllabus.build</h2>'));
  assert.ok(html.includes("Sign in or create an account to save your syllabi and progress."));
  assert.ok(html.includes("Continue with Google"));
  assert.ok(html.includes("Continue with GitHub"));
  assert.ok(html.includes("Use a passkey"));
  assert.ok(html.includes('href="/auth/oauth/google"'));
  assert.ok(html.includes('href="/auth/oauth/github"'));
  assert.ok(html.includes('data-action="sign-in-passkey"'));
  assert.equal(/auth-email-input|auth-password-input|submit-sign-up|request-password-reset|confirm-email-verification/.test(html), false);
});

test("Local Dev OAuth 2.0 + PKCE S256 sandbox completes full redirect, consent, callback, and session login", async () => {
  const mockFetch = async (url, init) => {
    if (String(url).endsWith("/v1/auth/session")) return backendSessionResponse("elena-backend-account");
    if (String(url).endsWith("/v1/auth/oauth/google/callback")) {
      assert.equal(init.headers["x-auth-exchange-secret"], "ef".repeat(32));
      return new Response(JSON.stringify({
        account_id: "elena-backend-account",
        session_token: "elena-backend-session",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        roles: ["user"],
      }), { status: 200 });
    }
    return new Response("{}", { status: 503 });
  };
  const { server } = createWebAppServer({
    initialState: { authStatus: "guest", topLevel: "Explore" },
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "ef".repeat(32) },
    fetchImpl: mockFetch,
    apiBaseUrl: "http://127.0.0.1:9",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  try {
    // 1. Start OAuth flow: GET /auth/oauth/google -> 302 to local dev IdP with PKCE S256
    const startRes = await fetch(`${baseUrl}/auth/oauth/google`, { redirect: "manual" });
    assert.equal(startRes.status, 302);
    parseCookies(startRes, jar);
    assert.ok(jar.has("cio_sid") && jar.has("cio_oauth"), "both session and signed OAuth state cookies are set");

    const authzLocation = startRes.headers.get("location");
    assert.ok(authzLocation?.includes("/auth/dev-idp/google/authorize?"));
    const authzUrl = new URL(authzLocation);
    assert.equal(authzUrl.searchParams.get("code_challenge_method"), "S256");
    const state = authzUrl.searchParams.get("state") ?? "";
    const codeChallenge = authzUrl.searchParams.get("code_challenge") ?? "";
    const redirectUri = authzUrl.searchParams.get("redirect_uri") ?? "";

    // 2. Render consent screen
    const consentPage = await fetch(authzLocation, { headers: { Cookie: cookieHeader(jar) } });
    assert.equal(consentPage.status, 200);
    const consentHtml = await consentPage.text();
    assert.ok(consentHtml.includes("Continue with Google"));
    // An account chooser: each dev persona is one row that posts the flow fields, plus another account and Cancel.
    assert.ok(consentHtml.includes('<html lang="en" data-theme="light">'));
    for (const persona of ["alex@syllabus.build", "ada@syllabus.build", "mo@syllabus.build"]) {
      assert.ok(consentHtml.includes(`name="email" value="${persona}"`), `${persona} has no row`);
    }
    assert.equal(consentHtml.match(/action="\/auth\/dev-idp\/google\/authorize"/g)?.length, 4);
    assert.equal(consentHtml.match(/name="code_challenge" value="/g)?.length, 4);
    assert.ok(consentHtml.includes('<span class="dev-oauth-avatar" data-tone="User" aria-hidden="true">AD</span>'));
    assert.equal(consentHtml.includes('id="dev-oauth-name"'), false);
    assert.ok(consentHtml.includes("Use another account</span>"));
    assert.ok(consentHtml.includes(`?error=access_denied&amp;state=${encodeURIComponent(state)}">Cancel</a>`));

    // 3. Submit consent as a brand-new user (email only, no name required) -> 302 back to /auth/oauth/google/callback?code=...&state=...
    const approveRes = await fetch(`${baseUrl}/auth/dev-idp/google/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(jar),
      },
      body: new URLSearchParams({
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        email: "elena.rostova@example.com",
      }).toString(),
    });
    assert.equal(approveRes.status, 302);
    const callbackLocation = approveRes.headers.get("location");
    assert.ok(callbackLocation?.startsWith(`${baseUrl}/auth/oauth/google/callback?`));

    // 4. Follow callback -> verifies PKCE S256 & state, clears cio_oauth cookie, signs user in, redirects to /
    const cbRes = await fetch(callbackLocation, {
      redirect: "manual",
      headers: { Cookie: cookieHeader(jar) },
    });
    assert.equal(cbRes.status, 302);
    assert.equal(cbRes.headers.get("location"), "/");
    parseCookies(cbRes, jar);
    assert.equal(jar.has("cio_oauth"), false, "transient OAuth cookie is cleared on callback");

    // 5. Home page renders authenticated with internal default username derived from email local-part (@elena.rostova) and no navbar full name
    const homeRes = await fetch(`${baseUrl}/`, { headers: { Cookie: cookieHeader(jar) } });
    const homeHtml = await homeRes.text();
    assert.ok(homeHtml.includes('data-auth-status="authenticated"'));
    assert.equal(homeHtml.includes('class="navbar-user-name"'), false);
    assert.ok(homeHtml.includes("@elena.rostova"));
    assert.ok(homeHtml.includes("elena.rostova@example.com"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Live Google OAuth exchanges the code and accepts only a verified backend session", async () => {
  let capturedVerifier = "";
  const mockFetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/v1/auth/session")) return backendSessionResponse("claire-backend-account", ["admin"]);
    if (u === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(String(init?.body ?? ""));
      capturedVerifier = params.get("code_verifier") ?? "";
      assert.equal(params.get("client_id"), "live-google-id.apps.googleusercontent.com");
      assert.equal(params.get("code"), "google-auth-code-123");
      return new Response(JSON.stringify({ access_token: "ya29.mock-token" }), { status: 200 });
    }
    if (u === "https://openidconnect.googleapis.com/v1/userinfo") {
      return new Response(
        JSON.stringify({
          sub: "google-sub-4242",
          email: "claire@example.com",
          email_verified: true,
          name: "Claire Google",
        }),
        { status: 200 },
      );
    }
    if (u.endsWith("/v1/auth/oauth/google/callback")) {
      assert.equal(init.headers["x-auth-exchange-secret"], "ef".repeat(32));
      return new Response(JSON.stringify({
        account_id: "claire-backend-account",
        session_token: "claire-backend-session",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        roles: ["admin"],
      }), { status: 200 });
    }
    throw new Error(`offline: ${u}`);
  };

  const { server } = createWebAppServer({
    initialState: { authStatus: "guest", topLevel: "Explore" },
    env: {
      APP_ENV: "production",
      GOOGLE_CLIENT_ID: "live-google-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "live-google-secret",
      AUTH_EXCHANGE_SECRET: "ef".repeat(32),
    },
    byokMasterKey: "ab".repeat(32),
    fetchImpl: mockFetch,
    apiBaseUrl: "http://127.0.0.1:9",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  try {
    const initRes = await fetch(`${baseUrl}/`);
    parseCookies(initRes, jar);

    const postUi = async (body) => {
      const res = await fetch(`${baseUrl}/api/ui-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
        body: JSON.stringify(body),
      });
      return res.json();
    };

    const oauthStart = await fetch(`${baseUrl}/auth/oauth/google`, {
      redirect: "manual",
      headers: { Cookie: cookieHeader(jar) },
    });
    assert.equal(oauthStart.status, 302);
    parseCookies(oauthStart, jar);
    const googleUrl = new URL(oauthStart.headers.get("location"));
    assert.equal(googleUrl.origin, "https://accounts.google.com");
    const state = googleUrl.searchParams.get("state") ?? "";

    const cbRes = await fetch(
      `${baseUrl}/auth/oauth/google/callback?code=google-auth-code-123&state=${encodeURIComponent(state)}`,
      { redirect: "manual", headers: { Cookie: cookieHeader(jar) } },
    );
    assert.equal(cbRes.status, 302);
    parseCookies(cbRes, jar);
    assert.ok(capturedVerifier.length >= 43, "PKCE code_verifier was sent during token exchange");

    const afterOAuth = await postUi({ action: "close-dialog" });
    assert.equal(afterOAuth.state.authStatus, "authenticated");
    assert.equal(afterOAuth.state.account.accountId, "claire-backend-account");
    assert.equal(afterOAuth.state.account.username, "claire");
    assert.equal(afterOAuth.state.account.role, "Admin");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
