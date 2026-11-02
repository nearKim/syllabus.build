import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readBoundedJson } from "../src/boundedResponse.ts";
import { resolveByokMasterKey } from "../src/byokVault.mjs";
import { createWebAppServer } from "../src/server.mjs";
import { backendSessionResponse, cookieHeader, signInWithDevOAuth } from "./helpers/devOAuth.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("Persistent BYOK custody requires an explicit 32-byte key", () => {
  assert.throws(() => resolveByokMasterKey({ persistent: true }), /BYOK_MASTER_KEY is required/);
  assert.throws(() => resolveByokMasterKey({ envKey: "a passphrase" }), /32-byte hex or base64/);
  assert.equal(resolveByokMasterKey({ envKey: "ab".repeat(32), persistent: true }).length, 32);
  assert.equal(resolveByokMasterKey().length, 32);
});

test("Provider JSON responses stop at the byte limit", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { canceled = true; },
  });
  await assert.rejects(readBoundedJson(new Response(body)), /Remote response is too large/);
  assert.equal(canceled, true);
});

test("Production requires a verified sign-in configuration", () => {
  assert.throws(() => createWebAppServer({ env: { APP_ENV: "production" } }), /Configure Google, Apple, or GitHub OAuth/);
  assert.throws(() => createWebAppServer({ env: {} }), /Configure Google, Apple, or GitHub OAuth/);
  assert.throws(() => createWebAppServer({ env: { APP_ENV: "typo" } }), /Configure Google, Apple, or GitHub OAuth/);
  assert.throws(() => createWebAppServer({
    env: { APP_ENV: "production", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" },
  }), /AUTH_EXCHANGE_SECRET is required/);
  assert.throws(() => createWebAppServer({
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "short-secret" },
  }), /AUTH_EXCHANGE_SECRET must be 32 bytes/);
});

test("Production never exposes the development identity provider", async () => {
  const { server } = createWebAppServer({
    env: {
      APP_ENV: "production",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      AUTH_EXCHANGE_SECRET: "ef".repeat(32),
    },
    byokMasterKey: "ab".repeat(32),
  });
  const baseUrl = await listen(server);
  try {
    const start = await fetch(`${baseUrl}/auth/oauth/google`, { redirect: "manual" });
    assert.equal(start.status, 302);
    assert.equal(new URL(start.headers.get("location")).hostname, "accounts.google.com");
    const devIdp = await fetch(`${baseUrl}/auth/dev-idp/google/authorize`);
    assert.equal(devIdp.status, 404);
    const unavailableProvider = await fetch(`${baseUrl}/auth/oauth/github`, { redirect: "manual" });
    assert.equal(unavailableProvider.status, 302);
    assert.equal(unavailableProvider.headers.get("location"), "/");
  } finally {
    await close(server);
  }
});

test("The /v1 proxy keeps the configured upstream origin", async () => {
  let attackerRequests = 0;
  const attacker = http.createServer((_req, res) => {
    attackerRequests += 1;
    res.end("attacker");
  });
  const upstream = http.createServer((req, res) => {
    assert.equal(req.url, "/v1/health?probe=1");
    assert.equal(req.headers["x-auth-exchange-secret"], undefined);
    res.end("upstream");
  });
  const attackerUrl = await listen(attacker);
  const upstreamUrl = await listen(upstream);
  const { server } = createWebAppServer({ env: { APP_ENV: "development" }, apiBaseUrl: upstreamUrl });
  const webUrl = await listen(server);
  try {
    const body = await new Promise((resolve, reject) => {
      http.get(`${webUrl}/`, {
        path: `${attackerUrl}/v1/health?probe=1`,
        headers: { "x-auth-exchange-secret": "attacker-supplied" },
      }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve(text));
      }).on("error", reject);
    });
    assert.equal(body, "upstream");
    assert.equal(attackerRequests, 0);
  } finally {
    await close(server);
    await close(upstream);
    await close(attacker);
  }
});

test("Guest sessions cannot sign in by email, buy credits, or send unbounded bodies", async () => {
  const { server } = createWebAppServer({ env: { APP_ENV: "development" }, apiBaseUrl: "http://127.0.0.1:9" });
  const baseUrl = await listen(server);
  try {
    const providers = await (await fetch(`${baseUrl}/auth/providers`)).json();
    assert.equal(providers.email_password_enabled, false);

    const signIn = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "submit-sign-in", email: "admin@example.test" }),
    });
    assert.equal((await signIn.json()).state.authStatus, "guest");

    const checkout = await fetch(`${baseUrl}/api/billing/checkout`, { method: "POST", body: "{}" });
    assert.equal(checkout.status, 503);

    for (const upstreamPath of ["/v1/auth/oauth/google/callback", "/v1/me/wallet", "/v1/me/schedule"]) {
      const unavailable = await fetch(`${baseUrl}${upstreamPath}`);
      assert.equal(unavailable.status, 502);
      assert.equal(unavailable.headers.get("x-syllabus-synthetic-fallback"), null);
    }

    const large = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      body: "x".repeat(8 * 1024 * 1024 + 1),
    });
    assert.equal(large.status, 413);
  } finally {
    await close(server);
  }
});

test("OAuth requires a successful backend exchange and an unexpired session", async () => {
  for (const backendState of ["offline", "expired", "unvalidated", "valid"]) {
    const mockFetch = async (url, init) => {
      if (String(url).endsWith("/v1/auth/session")) {
        return backendState === "unvalidated" ? new Response("{}", { status: 503 }) : backendSessionResponse("test-user-id");
      }
      if (String(url).endsWith("/v1/auth/oauth/google/callback")) {
        assert.equal(init.headers["x-auth-exchange-secret"], "ef".repeat(32));
        if (backendState === "offline") return new Response("{}", { status: 503 });
        return new Response(JSON.stringify({
          account_id: "test-user-id",
          session_token: "test-session-token",
          expires_at: new Date(Date.now() + (backendState === "expired" ? -1_000 : 3_600_000)).toISOString(),
          roles: ["user"],
        }), { status: 200 });
      }
      return new Response("{}", { status: 503 });
    };
    const { server } = createWebAppServer({
      env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "ef".repeat(32) },
      apiBaseUrl: "http://127.0.0.1:9",
      fetchImpl: mockFetch,
    });
    const baseUrl = await listen(server);
    try {
      const jar = new Map();
      await signInWithDevOAuth(baseUrl, jar, "test-user@example.test");
      const state = await (await fetch(`${baseUrl}/api/ui-state`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
        body: "{}",
      })).json();
      assert.equal(state.state.authStatus, backendState === "valid" ? "authenticated" : "guest");
    } finally {
      await close(server);
    }
  }
});

test("Saved web cookies lose authenticated access after server restart", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syllabus-session-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = {
    storePath: path.join(dir, "web-store.json"),
    byokMasterKey: "ab".repeat(32),
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "ef".repeat(32) },
    apiBaseUrl: "http://127.0.0.1:9",
    fetchImpl: async (url, init) => String(url).endsWith("/v1/me/wallet")
      ? new Response(JSON.stringify({ currency: "USD", available_minor_units: 0, reserved_minor_units: 0 }), { status: 200 })
      : String(url).endsWith("/v1/auth/session")
      ? backendSessionResponse("test-user-id")
      : String(url).endsWith("/v1/auth/oauth/google/callback")
        ? new Response(JSON.stringify({
          account_id: "test-user-id",
          session_token: "test-session-token",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          roles: ["user"],
        }), { status: 200 })
      : new Response("{}", { status: 503 }),
  };
  fs.writeFileSync(options.storePath, JSON.stringify({
    accountWorkspaces: { "test-user-id": { wallet: { currency: "USD", available_minor: 5000, reserved_minor: 0, live_billing_enabled: true } } },
  }));
  const jar = new Map();
  const first = createWebAppServer(options).server;
  const firstUrl = await listen(first);
  try {
    await signInWithDevOAuth(firstUrl, jar, "test-user@example.test");
    assert.equal((await fetch(`${firstUrl}/api/account/export`, { headers: { cookie: cookieHeader(jar) } })).status, 200);
    const state = await (await fetch(`${firstUrl}/api/ui-state`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
      body: "{}",
    })).json();
    assert.equal(state.state.wallet.available_minor, 0);
    assert.equal(state.state.wallet.live_billing_enabled, false);
  } finally {
    await close(first);
  }

  const second = createWebAppServer(options).server;
  const secondUrl = await listen(second);
  try {
    assert.equal((await fetch(`${secondUrl}/api/account/export`, { headers: { cookie: cookieHeader(jar) } })).status, 401);
    const registration = await fetch(`${secondUrl}/auth/passkey/register/options`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `http://localhost:${second.address().port}`, cookie: cookieHeader(jar) },
      body: "{}",
    });
    assert.equal(registration.status, 401);
  } finally {
    await close(second);
  }
});

test("User resource edits and deletion stay in that account's library", async () => {
  const mockFetch = async (url, init) => {
    const endpoint = String(url);
    if (endpoint.endsWith("/v1/auth/oauth/google/callback")) {
      const email = JSON.parse(init.body).email;
      return new Response(JSON.stringify({
        account_id: email.startsWith("alice") ? "alice-account" : "bob-account",
        session_token: `token-${email}`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        roles: ["user"],
      }), { status: 200 });
    }
    if (endpoint.endsWith("/v1/auth/session")) {
      return backendSessionResponse(init.headers.Authorization.includes("alice") ? "alice-account" : "bob-account");
    }
    return new Response("{}", { status: 503 });
  };
  const { server } = createWebAppServer({
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "ef".repeat(32) },
    apiBaseUrl: "http://127.0.0.1:9",
    fetchImpl: mockFetch,
  });
  const baseUrl = await listen(server);
  const id = "discovered-book-hnsw-vector-v1";
  const globalResource = async () => (await (await fetch(`${baseUrl}/catalog/resources/${id}.json`)).json()).title;
  const postUi = async (jar, command) => {
    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
      body: JSON.stringify(command),
    });
    assert.equal(response.status, 200);
    return (await response.json()).state;
  };
  try {
    const originalTitle = await globalResource();
    const alice = new Map();
    const bob = new Map();
    await signInWithDevOAuth(baseUrl, alice, "alice@example.test");
    await signInWithDevOAuth(baseUrl, bob, "bob@example.test");

    const edited = await postUi(alice, {
      action: "save-resource-edit",
      resourceVersionId: id,
      title: "Alice's private HNSW notes",
      canonicalUrl: "https://example.com/hnsw-notes",
      category: "Book",
      publisher: "Alice",
      accessModel: "free",
      topics: "HNSW",
    });
    assert.equal(edited.catalogResources[id].title, "Alice's private HNSW notes");
    assert.equal(await globalResource(), originalTitle);
    assert.equal((await postUi(bob, { action: "noop" })).catalogResources[id].title, originalTitle);
    assert.equal((await postUi(alice, { action: "noop" })).catalogResources[id].title, "Alice's private HNSW notes");

    const removed = await postUi(alice, { action: "delete-library-resource", resourceId: id });
    assert.equal(removed.userLibraryResourceIds.includes(id), false);
    assert.equal(await globalResource(), originalTitle);
    assert.equal((await postUi(bob, { action: "noop" })).catalogResources[id].title, originalTitle);
  } finally {
    await close(server);
  }
});

test("User manual ingestion never enters the global catalog or another account", async () => {
  const mockFetch = async (url, init) => {
    const endpoint = String(url);
    if (endpoint.endsWith("/v1/auth/oauth/google/callback")) {
      const email = JSON.parse(init.body).email;
      return new Response(JSON.stringify({
        account_id: email.startsWith("alice") ? "alice-account" : "bob-account",
        session_token: `token-${email}`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        roles: ["user"],
      }), { status: 200 });
    }
    if (endpoint.endsWith("/v1/auth/session")) {
      return backendSessionResponse(init.headers.Authorization.includes("alice") ? "alice-account" : "bob-account");
    }
    return new Response("{}", { status: 503 });
  };
  const { server } = createWebAppServer({
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "ef".repeat(32) },
    apiBaseUrl: "http://127.0.0.1:9",
    fetchImpl: mockFetch,
  });
  const baseUrl = await listen(server);
  const alice = new Map();
  const bob = new Map();
  try {
    await signInWithDevOAuth(baseUrl, alice, "alice@example.test");
    await signInWithDevOAuth(baseUrl, bob, "bob@example.test");
    const add = await fetch(`${baseUrl}/api/resources/manual`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(alice) },
      body: JSON.stringify({ rawText: "https://example.com/alice-private-study-notes" }),
    });
    assert.equal(add.status, 201);
    const added = await add.json();
    const id = added.analyzedDraft.resourceVersionId;
    assert.ok(added.state.userLibraryResourceIds.includes(id));
    assert.equal((await fetch(`${baseUrl}/catalog/resources/${id}.json`)).status, 404);
    const publicCatalog = await (await fetch(`${baseUrl}/catalog/resources.json`)).json();
    assert.equal(publicCatalog.resources.some((entry) => entry.resource_version_id === id), false);

    const bobState = await (await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(bob) },
      body: "{}",
    })).json();
    assert.equal(bobState.state.catalogResources[id], undefined);
    const aliceState = await (await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(alice) },
      body: "{}",
    })).json();
    assert.ok(aliceState.state.catalogResources[id]);
  } finally {
    await close(server);
  }
});

test("Admin catalog edits require backend approval before changing the web catalog", async () => {
  const requests = [];
  const mockFetch = async (url, init) => {
    const endpoint = String(url);
    if (endpoint.endsWith("/v1/auth/oauth/google/callback")) {
      return new Response(JSON.stringify({
        account_id: "admin-account",
        session_token: "admin-token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        roles: ["admin"],
      }), { status: 200 });
    }
    if (endpoint.endsWith("/v1/auth/session")) return backendSessionResponse("admin-account", ["admin"]);
    if (endpoint.includes("/v1/catalog/resources/")) {
      requests.push({ method: init.method, endpoint });
      return new Response(JSON.stringify({ error: "Catalog change rejected" }), {
        status: init.method === "PATCH" ? 403 : 503,
      });
    }
    return new Response("{}", { status: 503 });
  };
  const { server } = createWebAppServer({
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "ef".repeat(32) },
    apiBaseUrl: "http://127.0.0.1:9",
    fetchImpl: mockFetch,
  });
  const baseUrl = await listen(server);
  const jar = new Map();
  const id = "discovered-book-hnsw-vector-v1";
  const publicResource = async () => (await (await fetch(`${baseUrl}/catalog/resources/${id}.json`)).json()).title;
  const postUi = async (command) => fetch(`${baseUrl}/api/ui-state`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify(command),
  });
  try {
    await signInWithDevOAuth(baseUrl, jar, "admin@example.test");
    const originalTitle = await publicResource();
    const edit = await postUi({
      action: "save-resource-edit",
      resourceVersionId: id,
      title: "Unapproved global edit",
      canonicalUrl: "https://example.com/unapproved",
      category: "Book",
      publisher: "Admin",
      accessModel: "free",
      topics: "HNSW",
    });
    assert.equal(edit.status, 403);
    assert.equal(await publicResource(), originalTitle);
    const afterEdit = await (await postUi({ action: "noop" })).json();
    assert.equal(afterEdit.state.catalogResources[id].title, originalTitle);

    const remove = await postUi({ action: "delete-library-resource", resourceId: id });
    assert.equal(remove.status, 502);
    assert.equal(await publicResource(), originalTitle);
    const afterRemove = await (await postUi({ action: "noop" })).json();
    assert.equal(afterRemove.state.catalogResources[id].title, originalTitle);
    assert.deepEqual(requests.map((request) => request.method), ["PATCH", "DELETE"]);
  } finally {
    await close(server);
  }
});
