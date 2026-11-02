import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createWebAppServer } from "../src/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

function parseCookies(res, jar) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (!val) jar.delete(name);
      else jar.set(name, val);
    }
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

async function waitForHttpReady(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // retry until ready
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("Live BYOK AI concept checks, hints, worked solutions, interactive diagnostics, adaptation & manual syllabus CRUD", async () => {
  let openAiCalls = 0;
  const mockFetch = async (url, init = {}) => {
    const urlStr = String(url);
    if (urlStr.startsWith("http://127.0.0.1:9")) {
      return new Response("offline", { status: 503 });
    }
    if (urlStr === "https://api.openai.com/v1/responses") {
      openAiCalls += 1;
      const auth = init.headers?.Authorization ?? init.headers?.authorization ?? "";
      assert.equal(auth, "Bearer sk-live-tutor-check-key-7788");
      const generatedJson = JSON.stringify({
        formula: "\\mathrm{Recall}@k = \\frac{|\\mathcal{R}_k \\cap \\mathcal{G}|}{|\\mathcal{G}|}",
        question: "Why does hybrid BM25 + dense vector retrieval improve Recall@k on rare technical identifiers?",
        choices: [
          { value: "exact_lexical_anchor", label: "Exact lexical term matching anchors rare tokens that dense embeddings compress away" },
          { value: "lower_index_dim", label: "BM25 reduces dense vector dimensionality to 16 floats" },
          { value: "zero_latency", label: "Hybrid fusion eliminates cosine similarity normalization" },
        ],
        correctValue: "exact_lexical_anchor",
        hint: "Consider how dense encoders handle out-of-distribution identifiers versus inverted term postings.",
        solution:
          "Dense encoders smooth rare symbols into neighborhood centroids, whereas BM25 preserves exact token postings so Reciprocal Rank Fusion recovers both exact and semantic hits.",
      });
      return new Response(
        JSON.stringify({
          output_text: generatedJson,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch URL: ${urlStr}`);
  };

  const { server } = createWebAppServer({
    env: { APP_ENV: "development" },
    apiBaseUrl: "http://127.0.0.1:9",
    fetchImpl: mockFetch,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  const postUi = async (body) => {
    const res = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
      body: JSON.stringify(body),
    });
    parseCookies(res, jar);
    assert.equal(res.status, 200);
    return res.json();
  };

  try {
    const home = await fetch(`${baseUrl}/`);
    parseCookies(home, jar);

    // 1. Sign up learner & configure BYOK OpenAI key
    const signup = await postUi({
      action: "submit-sign-up",
      email: "tutor-learner@syllabus.build",
      password: "TutorPassword123!",
    });
    assert.equal(signup.state.authStatus, "authenticated");

    await postUi({
      action: "replace-key",
      providerId: "openai",
      keyValue: "sk-live-tutor-check-key-7788",
    });

    // 2. Open worked-example activity drawer & generate live BYOK AI concept check
    await postUi({
      action: "select-plan-activity",
      activityId: "activity-example",
    });
    const genCheck = await postUi({
      action: "generate-activity-check",
      activityId: "activity-example",
    });
    assert.equal(openAiCalls, 1);
    assert.match(genCheck.html, /hybrid BM25 \+ dense vector retrieval/i);

    const withHint = await postUi({ action: "request-hint" });
    assert.equal(withHint.state.hintRequested, true);
    assert.match(withHint.html, /inverted term postings/i);

    const withSolution = await postUi({ action: "study-worked-solution" });
    assert.equal(withSolution.state.workedSolutionRevealed, true);
    assert.match(withSolution.html, /Reciprocal Rank Fusion/i);

    const graded = await postUi({
      action: "submit-practice",
      practiceChoice: "exact_lexical_anchor",
    });
    assert.equal(graded.state.practiceSubmitted, true);
    assert.equal(graded.state.practiceChoice, "exact_lexical_anchor");

    // 3. Interactive #dialog-diagnostic-check -> promote objective-attention -> accept-revision
    const openedDiag = await postUi({
      action: "diagnostic-continue",
      objectiveId: "objective-attention",
    });
    assert.equal(openedDiag.state.openDialogId, "dialog-diagnostic-check");
    assert.match(openedDiag.html, /id="dialog-diagnostic-check"/);

    const diagPassed = await postUi({
      action: "submit-diagnostic-answer",
      objectiveId: "objective-attention",
      diagnosticChoice: "vanish_saturation",
    });
    assert.equal(diagPassed.state.diagnosticFeedback?.passed, true);
    assert.equal(
      diagPassed.state.proficiencyOverrides["objective-attention"]?.status,
      "demonstrated",
    );

    const adapted = await postUi({ action: "accept-revision" });
    assert.equal(adapted.state.adaptationChoice, "accept_reviewed");
    assert.ok(
      adapted.state.skippedActivityIds.length >= 1,
      "expected demonstrated intro theory step to be waived upon accepting adaptation",
    );

    // 4. Manual Syllabus Structure CRUD (edit meta, add/move/delete unit & step, delete adopted/secondary syllabus)
    const openEditor = await postUi({
      action: "open-syllabus-editor",
      syllabusEditMode: "syllabus",
    });
    assert.equal(openEditor.state.openDialogId, "dialog-syllabus-editor");

    const renamed = await postUi({
      action: "save-syllabus-meta",
      title: "Production Hybrid RAG Engineering",
      summary: "Custom structured syllabus with manual units and steps.",
    });
    assert.equal(renamed.state.syllabusEditorError, null);
    assert.match(renamed.html, /Production Hybrid RAG Engineering/);

    const addedUnit = await postUi({
      action: "save-syllabus-module",
      title: "Unit X: Evaluation & Reranking",
      summary: "Cross-encoder reranking and NDCG@10.",
      requirementLevel: "required",
    });
    const newModId = addedUnit.state.selectedModuleId;
    assert.ok(newModId);

    await postUi({
      action: "move-syllabus-module",
      moduleId: newModId,
      direction: "up",
    });

    const addedStep = await postUi({
      action: "save-syllabus-activity",
      moduleId: newModId,
      title: "Benchmark Cross-Encoder Reranker",
      activityType: "coding",
      durationMinutes: "40",
      requirementLevel: "required",
      prompt: "Measure Recall@20 before and after cross-encoder reranking.",
    });
    const newActId = addedStep.state.selectedActivityId;
    assert.ok(newActId);

    await postUi({
      action: "delete-syllabus-activity",
      activityId: newActId,
    });
    await postUi({
      action: "delete-syllabus-module",
      moduleId: newModId,
    });

    // Adopt a second plan so we can verify confirm-delete-syllabus cleanly removes it
    const plansBeforeAdopt = addedStep.state.activePlans?.length ?? 3;
    if (plansBeforeAdopt >= 2) {
      const targetDeleteId = "syllabus-linear-algebra-002";
      const afterDelete = await postUi({
        action: "confirm-delete-syllabus",
        syllabusId: targetDeleteId,
      });
      assert.ok(afterDelete.state.deletedSyllabusIds.includes(targetDeleteId));
      assert.notEqual(afterDelete.state.selectedSyllabusId, targetDeleteId);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Account recovery, email verification, RFC 5545 .ics export, hosted checkout & HMAC webhook, and production hardening", async () => {
  const webhookSecret = "whsec_test_billing_hmac_2026";
  const { server } = createWebAppServer({
    env: {
      APP_ENV: "development",
      BILLING_WEBHOOK_SECRET: webhookSecret,
    },
    apiBaseUrl: "http://127.0.0.1:9",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  const postUi = async (body) => {
    const res = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
      body: JSON.stringify(body),
    });
    parseCookies(res, jar);
    return res.json();
  };

  try {
    const home = await fetch(`${baseUrl}/`);
    parseCookies(home, jar);

    // 1. Sign up -> request email verification -> read dev outbox -> verify via code & GET link
    await postUi({
      action: "submit-sign-up",
      email: "recovery-user@syllabus.build",
      password: "OriginalPassword123!",
    });

    const reqVerify = await postUi({ action: "request-email-verification" });
    assert.equal(reqVerify.state.emailVerificationPending, true);

    const outboxRes1 = await fetch(`${baseUrl}/auth/dev-outbox`);
    assert.equal(outboxRes1.status, 200);
    const outbox1 = await outboxRes1.json();
    const verifyMsg = outbox1.messages.find(
      (m) => m.kind === "email_verification" && m.email === "recovery-user@syllabus.build",
    );
    assert.ok(verifyMsg?.code);

    const confirmedVerify = await postUi({
      action: "confirm-email-verification",
      code: verifyMsg.code,
    });
    assert.equal(confirmedVerify.state.emailVerified, true);

    // Also test GET /auth/verify-email?token=... link flow
    await postUi({ action: "request-email-verification" });
    const outbox2 = await (await fetch(`${baseUrl}/auth/dev-outbox`)).json();
    const latestVerify = outbox2.messages
      .filter((m) => m.kind === "email_verification")
      .at(-1);
    const linkRes = await fetch(latestVerify.verify_url, {
      redirect: "manual",
      headers: { Cookie: cookieHeader(jar) },
    });
    assert.equal(linkRes.status, 302);

    // 2. Export RFC 5545 .ics calendar
    const icsRes = await fetch(`${baseUrl}/api/schedule.ics`, {
      headers: { Cookie: cookieHeader(jar) },
    });
    assert.equal(icsRes.status, 200);
    assert.match(icsRes.headers.get("content-type") ?? "", /text\/calendar/);
    const icsBody = await icsRes.text();
    assert.match(icsBody, /BEGIN:VCALENDAR\r\n/);
    assert.match(icsBody, /BEGIN:VEVENT\r\n/);
    assert.match(icsBody, /BEGIN:VALARM\r\n/);
    assert.match(icsBody, /TRIGGER:-PT\d+M\r\n/);
    assert.match(icsBody, /END:VCALENDAR\r\n/);

    // 3. Hosted wallet top-up + HMAC-verified /api/billing/webhook
    const checkoutRes = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
      body: JSON.stringify({ amountMinor: 1500 }),
    });
    assert.equal(checkoutRes.status, 201);
    const checkoutJson = await checkoutRes.json();
    assert.ok(checkoutJson.state.wallet.available_minor >= 1500);

    const rawWebhookPayload = JSON.stringify({
      event_id: "evt_test_001",
      event_type: "checkout.session.completed",
      amount_minor_units: 1000,
    });
    const badSigRes = await fetch(`${baseUrl}/api/billing/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Billing-Signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
      body: rawWebhookPayload,
    });
    assert.equal(badSigRes.status, 401);

    const validSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawWebhookPayload)
      .digest("hex");
    const goodSigRes = await fetch(`${baseUrl}/api/billing/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Billing-Signature": `sha256=${validSig}`,
      },
      body: rawWebhookPayload,
    });
    assert.equal(goodSigRes.status, 200);

    // 4. Sign out -> forgot password -> confirm-password-reset -> old password fails, new succeeds
    await postUi({ action: "sign-out" });

    await postUi({
      action: "request-password-reset",
      email: "recovery-user@syllabus.build",
    });
    const outbox3 = await (await fetch(`${baseUrl}/auth/dev-outbox`)).json();
    const resetMsg = outbox3.messages
      .filter((m) => m.kind === "password_reset" && m.email === "recovery-user@syllabus.build")
      .at(-1);
    assert.ok(resetMsg?.code);

    const resetDone = await postUi({
      action: "confirm-password-reset",
      email: "recovery-user@syllabus.build",
      code: resetMsg.code,
      password: "RotatedPassword999!",
    });
    assert.equal(resetDone.state.authStatus, "authenticated");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // 5. Production security headers, Secure cookie, CSRF Origin check, non-dev debug block & 429 rate limit
  const prod = createWebAppServer({
    env: { APP_ENV: "production" },
    apiBaseUrl: "http://127.0.0.1:9",
    rateLimitMaxRequests: 6,
    rateLimitWindowMs: 60_000,
  });
  await new Promise((resolve) => prod.server.listen(0, "127.0.0.1", resolve));
  const prodUrl = `http://127.0.0.1:${prod.server.address().port}`;
  try {
    const res = await fetch(`${prodUrl}/`);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=/);
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(res.headers.get("set-cookie") ?? "", /;\s*Secure/i);

    // Dev outbox disabled in production
    const prodOutbox = await fetch(`${prodUrl}/auth/dev-outbox`);
    assert.equal(prodOutbox.status, 404);

    // Debug switch-persona disabled in production
    const debugSwitch = await fetch(`${prodUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "switch-persona", persona: "learner" }),
    });
    assert.equal(debugSwitch.status, 403);

    // Cross-origin CSRF mutating POST blocked with 403
    const csrfRes = await fetch(`${prodUrl}/api/ui-state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.evil.example",
      },
      body: JSON.stringify({ action: "navigate-top", destination: "Explore" }),
    });
    assert.equal(csrfRes.status, 403);

    // Exceed sliding-window rate limit on mutating /api/* POST -> 429 with Retry-After
    let saw429 = false;
    for (let i = 0; i < 8; i += 1) {
      const r = await fetch(`${prodUrl}/api/ui-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "navigate-top", destination: "Explore" }),
      });
      if (r.status === 429) {
        saw429 = true;
        assert.ok(Number(r.headers.get("retry-after")) >= 1);
        break;
      }
    }
    assert.equal(saw429, true, "expected per-IP rate limiter to return HTTP 429");
  } finally {
    await new Promise((resolve) => prod.server.close(resolve));
  }
});

test("Full-stack stateless restart E2E: @syllabus/web (no storePath) + syllabus-api + PostgreSQL 16 preserve workspaces, BYOK envelopes, wallet & auth across full restarts", async (t) => {
  const dbUrl = (process.env.TEST_POSTGRES_URL ?? process.env.DATABASE_URL ?? "").trim();
  const apiBin = path.join(REPO_ROOT, "target/debug/syllabus-api");
  if (!dbUrl || !fs.existsSync(apiBin)) {
    t.skip("Requires DATABASE_URL/TEST_POSTGRES_URL and target/debug/syllabus-api");
    return;
  }

  const sharedMasterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const uniqueEmail = `e2e-stateless-${Date.now()}@syllabus.build`;
  const pgNamespace = `e2e-web-${Date.now()}`;

  const spawnApi = async () => {
    const apiPort = await getFreePort();
    const child = spawn(apiBin, [], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        APP_ENV: "development",
        API_BIND_ADDR: `127.0.0.1:${apiPort}`,
        DATABASE_URL: dbUrl,
        POSTGRES_STORE_NAMESPACE: pgNamespace,
        BYOK_MASTER_KEY: sharedMasterKey,
        BILLING_WEBHOOK_SECRET: "whsec_syllabus_io_dev_secret_key_2026",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHttpReady(`http://127.0.0.1:${apiPort}/v1/health`);
    return { child, apiBaseUrl: `http://127.0.0.1:${apiPort}` };
  };

  let openAiDecryptedKeySeen = null;
  const makeFetchWithMockOpenAi = () => async (url, init = {}) => {
    const urlStr = String(url);
    if (urlStr === "https://api.openai.com/v1/responses") {
      openAiDecryptedKeySeen = init.headers?.Authorization ?? init.headers?.authorization ?? null;
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            formula: "E = mc^2",
            question: "Survived stateless PostgreSQL restart concept check?",
            choices: [
              { value: "yes_pg", label: "Yes, decrypted from PostgreSQL web_account_workspaces envelope" },
              { value: "no_file", label: "No, relied on local disk JSON" },
              { value: "none", label: "Neither" },
            ],
            correctValue: "yes_pg",
            hint: "Check where sealedByokEnvelopes lives.",
            solution: "Persisted in PostgreSQL 16 via syllabus-api /v1/me/workspace.",
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return globalThis.fetch(url, init);
  };

  // --- BOOT 1: Start syllabus-api #1 + stateless @syllabus/web #1 (storePath: undefined!) ---
  const api1 = await spawnApi();
  const web1 = createWebAppServer({
    storePath: undefined,
    apiBaseUrl: api1.apiBaseUrl,
    byokMasterKey: sharedMasterKey,
    env: { APP_ENV: "development" },
    fetchImpl: makeFetchWithMockOpenAi(),
  });
  await new Promise((resolve) => web1.server.listen(0, "127.0.0.1", resolve));
  const web1Url = `http://127.0.0.1:${web1.server.address().port}`;
  const jar1 = new Map();

  const postWeb1 = async (body) => {
    const res = await fetch(`${web1Url}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar1) },
      body: JSON.stringify(body),
    });
    parseCookies(res, jar1);
    assert.equal(res.status, 200);
    return res.json();
  };

  let completedActivityId;
  try {
    const home1 = await fetch(`${web1Url}/`);
    parseCookies(home1, jar1);

    const signedUp = await postWeb1({
      action: "submit-sign-up",
      email: uniqueEmail,
      password: "StatelessPgPassword123!",
    });
    assert.equal(signedUp.state.authStatus, "authenticated");
    completedActivityId = signedUp.state.selectedActivityId;

    await postWeb1({
      action: "replace-key",
      providerId: "openai",
      keyValue: "sk-proj-stateless-pg-secret-4242",
    });

    await postWeb1({
      action: "save-syllabus-meta",
      title: "PostgreSQL Durable Unified Syllabus",
      summary: "Persisted across full web and API restarts without web-store.json.",
    });

    await postWeb1({
      action: "complete-activity",
      activityId: completedActivityId,
      eventId: "evt-e2e-pg-restart-1",
    });

    const topUp = await fetch(`${web1Url}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar1) },
      body: JSON.stringify({ amountMinor: 2500 }),
    });
    assert.equal(topUp.status, 201);
  } finally {
    await new Promise((resolve) => web1.server.close(resolve));
    api1.child.kill("SIGTERM");
    await new Promise((resolve) => api1.child.once("exit", resolve));
  }

  // --- BOOT 2: Brand-new syllabus-api #2 + brand-new stateless @syllabus/web #2 (storePath: undefined!) ---
  const api2 = await spawnApi();
  const web2 = createWebAppServer({
    storePath: undefined,
    apiBaseUrl: api2.apiBaseUrl,
    byokMasterKey: sharedMasterKey,
    env: { APP_ENV: "development" },
    fetchImpl: makeFetchWithMockOpenAi(),
  });
  await new Promise((resolve) => web2.server.listen(0, "127.0.0.1", resolve));
  const web2Url = `http://127.0.0.1:${web2.server.address().port}`;
  const jar2 = new Map();

  const postWeb2 = async (body) => {
    const res = await fetch(`${web2Url}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar2) },
      body: JSON.stringify(body),
    });
    parseCookies(res, jar2);
    assert.equal(res.status, 200);
    return res.json();
  };

  try {
    const home2 = await fetch(`${web2Url}/`);
    parseCookies(home2, jar2);

    const relogin = await postWeb2({
      action: "submit-sign-in",
      email: uniqueEmail,
      password: "StatelessPgPassword123!",
    });
    assert.equal(relogin.state.authStatus, "authenticated");
    assert.match(relogin.html, /PostgreSQL Durable Unified Syllabus/);
    assert.ok(
      relogin.state.recordedProgressEvents.some((e) => e.activityId === completedActivityId),
      "completed activity progress must survive full stateless web + API restart",
    );
    assert.ok(
      relogin.state.wallet.available_minor >= 2500,
      `expected wallet credits >= 2500 from PostgreSQL ledger, got ${relogin.state.wallet.available_minor}`,
    );
    assert.equal(
      relogin.state.byokCredentials.find((c) => c.provider_id === "openai")?.masked_suffix,
      "4242",
    );

    // Verify account export NEVER leaks raw or encrypted BYOK keys
    const exportRes = await fetch(`${web2Url}/api/account/export`, {
      headers: { Cookie: cookieHeader(jar2) },
    });
    assert.equal(exportRes.status, 200);
    const exportText = await exportRes.text();
    assert.ok(!exportText.includes("sk-proj-stateless-pg-secret-4242"));
    assert.ok(!exportText.includes("sealedByokEnvelopes"));

    // Verify sealed BYOK envelope hydrated from PostgreSQL decrypts JIT for live AI concept check!
    await postWeb2({
      action: "select-plan-activity",
      activityId: "activity-example",
    });
    const liveTutor = await postWeb2({
      action: "generate-activity-check",
      activityId: "activity-example",
    });
    assert.equal(openAiDecryptedKeySeen, "Bearer sk-proj-stateless-pg-secret-4242");
    assert.match(liveTutor.html, /Survived stateless PostgreSQL restart concept check\?/);
  } finally {
    await new Promise((resolve) => web2.server.close(resolve));
    api2.child.kill("SIGTERM");
    await new Promise((resolve) => api2.child.once("exit", resolve));
  }
});
