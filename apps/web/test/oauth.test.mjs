import assert from "node:assert/strict";
import test from "node:test";
import { createSyllabusWebAppController } from "../src/index.ts";
import { createWebAppServer } from "../src/server.mjs";

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

test("AuthDialog toggles between Log in and Sign up modes with Email + Password first, OAuth/Passkey below, and no Name input", () => {
  const app = createSyllabusWebAppController({ authStatus: "guest", topLevel: "Explore" });
  app.openDialog("dialog-auth", "login");
  let html = authDialogOf(app.renderHtml());
  // Centered brand lockup and headline. No header bar, horizontal divider, or Name field.
  assert.match(html, /<div class="auth-head"><div class="brand-cluster">[\s\S]*?<span class="brand-title">Syllabus\.io<\/span><\/div><h2 id="dialog-auth-title" class="auth-title">Sign in with email<\/h2><\/div>/);
  assert.equal(/<hr|dialog-header|auth-divider|auth-name-input/.test(html), false);
  assert.ok(html.includes('data-action="submit-sign-in" novalidate'), "the product's own messages replace browser bubbles");
  assert.ok(html.includes('autocomplete="current-password"'));
  assert.ok(html.includes(">Log in</button>"));
  assert.ok(html.includes('href="/auth/oauth/google"'));
  assert.ok(html.includes('href="/auth/oauth/github"'));
  assert.ok(html.includes('data-action="sign-in-passkey"><svg'));
  assert.ok(html.includes('data-action="switch-auth-mode" data-auth-mode="signup">Sign up</button>'));
  // Email + Password + primary CTA appear before secondary federated/passkey buttons, and close button comes last.
  assert.ok(html.indexOf('id="auth-email-input"') < html.indexOf('id="auth-password-input"'));
  assert.ok(html.indexOf('id="auth-password-input"') < html.indexOf('class="btn-primary auth-submit-btn"'));
  assert.ok(html.indexOf('class="btn-primary auth-submit-btn"') < html.indexOf('href="/auth/oauth/google"'));
  assert.ok(html.indexOf('class="btn-primary auth-submit-btn"') < html.indexOf('class="auth-close-btn"'));

  app.applyUiAction("toggle-auth-password");
  html = authDialogOf(app.renderHtml());
  assert.ok(html.includes('id="auth-password-input" type="text"'));
  assert.ok(html.includes('aria-pressed="true" aria-label="Hide password"'));

  // Sign up keeps email + password only (no Name input), clears stale messages, and omits passkey sign-in.
  app.applyUiAction("submit-sign-in", { email: "not-an-email" });
  assert.ok(authDialogOf(app.renderHtml()).includes('<p class="field-error" role="alert">Enter a valid email address.</p>'));
  app.applyUiAction("switch-auth-mode", { authMode: "signup" });
  html = authDialogOf(app.renderHtml());
  assert.ok(html.includes(">Create your account</h2>"));
  assert.equal(html.includes("field-error"), false);
  assert.equal(html.includes('id="auth-name-input"'), false, "Sign up requires only email and password");
  assert.ok(html.includes('autocomplete="new-password"'));
  assert.ok(html.includes(">Create account</button>"));
  assert.equal(html.includes("sign-in-passkey"), false);
  assert.ok(html.includes('data-action="switch-auth-mode" data-auth-mode="login">Log in</button>'));
});

test("Local Dev OAuth 2.0 + PKCE S256 sandbox completes full redirect, consent, callback, and session login", async () => {
  const { server } = createWebAppServer({
    initialState: { authStatus: "guest", topLevel: "Explore" },
    env: { APP_ENV: "development" },
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
    for (const persona of ["alex@syllabus.io", "ada@syllabus.io", "mo@syllabus.io"]) {
      assert.ok(consentHtml.includes(`name="email" value="${persona}"`), `${persona} has no row`);
    }
    assert.equal(consentHtml.match(/action="\/auth\/dev-idp\/google\/authorize"/g)?.length, 4);
    assert.equal(consentHtml.match(/name="code_challenge" value="/g)?.length, 4);
    assert.ok(consentHtml.includes('<span class="dev-oauth-avatar" data-tone="Curator" aria-hidden="true">AD</span>'));
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

test("Live Google OAuth 2.0 + PKCE S256 exchanges token and userinfo when GOOGLE_CLIENT_ID is configured, and links existing email signup account", async () => {
  let capturedVerifier = "";
  const mockFetch = async (url, init) => {
    const u = String(url);
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
    throw new Error(`offline: ${u}`);
  };

  const { server } = createWebAppServer({
    initialState: { authStatus: "guest", topLevel: "Explore" },
    env: {
      APP_ENV: "production",
      GOOGLE_CLIENT_ID: "live-google-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "live-google-secret",
    },
    fetchImpl: mockFetch,
    apiBaseUrl: "http://127.0.0.1:9",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  try {
    // 1. Sign up with email + password first
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

    const signedUp = await postUi({
      action: "submit-sign-up",
      email: "claire@example.com",
      password: "ClaireStrongPassword!",
    });
    assert.equal(signedUp.state.authStatus, "authenticated");
    assert.equal(signedUp.state.account.username, "claire");
    const originalAccountId = signedUp.state.account.accountId;

    // 2. Sign out, verify wrong password fails and duplicate signup fails
    await postUi({ action: "sign-out" });
    const badPw = await postUi({
      action: "submit-sign-in",
      email: "claire@example.com",
      password: "WrongPassword!",
    });
    assert.equal(badPw.state.authStatus, "guest");
    assert.equal(badPw.state.authNotice, "Incorrect email or password.");

    const dupSignup = await postUi({
      action: "submit-sign-up",
      email: "claire@example.com",
      password: "AnotherStrongPassword!",
    });
    assert.equal(dupSignup.state.authStatus, "guest");
    assert.match(dupSignup.state.authNotice, /already exists/);

    // 3. Sign in with Live Google OAuth -> links to Claire's existing accountId!
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
    assert.equal(afterOAuth.state.account.accountId, originalAccountId);
    assert.equal(afterOAuth.state.account.username, "claire");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
