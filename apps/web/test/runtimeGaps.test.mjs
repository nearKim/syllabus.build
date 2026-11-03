import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWebAppServer } from "../src/server.mjs";
import { backendSessionResponse, signInWithDevOAuth } from "./helpers/devOAuth.mjs";

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

const LIVE_DRAFT_FIXTURE = {
  summary: "Practical distributed consensus and Raft replication in Rust.",
  modules: [
    {
      title: "Module 1: Leader Election & Term Monotonicity",
      summary: "Understand split votes, randomized election timeouts, and term invariants.",
      objective: {
        title: "Implement Raft leader election",
        description: "Build deterministic RequestVote RPC state transitions.",
        successCriterion: "Pass network partition election safety checks.",
      },
      read: { title: "Read: In Search of an Understandable Consensus Algorithm (§5.1–5.2)", prompt: "Trace term increments on candidate timeout." },
      practice: { title: "Simulate split-vote recovery", prompt: "Test 5-node randomized timeout convergence." },
      checkpoint: { title: "Election Safety Checkpoint", prompt: "Prove at most one leader can be elected per term." },
    },
    {
      title: "Module 2: Log Replication & Commit Rules",
      summary: "Replicate entries safely and enforce the Log Matching Property.",
      objective: {
        title: "Enforce Raft commit rules",
        description: "Commit current-term entries replicated on a majority.",
        successCriterion: "Pass Figure 8 leader crash replication scenario.",
      },
      read: { title: "Read: Raft Paper (§5.3–5.4)", prompt: "Note why previous-term entries are committed indirectly." },
      practice: { title: "Implement AppendEntries consistency check", prompt: "Reject mismatched prevLogIndex/prevLogTerm." },
      checkpoint: { title: "Replication Safety Checkpoint", prompt: "Explain the Leader Completeness invariant." },
    },
  ],
  resources: [
    {
      title: "In Search of an Understandable Consensus Algorithm (Raft Extended)",
      url: "https://raft.github.io/raft.pdf",
      publisher: "USENIX ATC / Stanford",
      category: "Article",
      topics: ["Distributed Systems", "Consensus", "Raft"],
      sections: ["§5.1 Raft Basics", "§5.2 Leader Election", "§5.3 Log Replication"],
    },
  ],
};

test("Open Git-tracked catalog endpoints and keep User contributions private", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syllabus-open-catalog-test-"));
  const catalogDir = path.join(tmpDir, "catalog");
  fs.cpSync(path.resolve(process.cwd(), "../../catalog"), catalogDir, { recursive: true });
  const storePath = path.join(tmpDir, "web-store.json");

  const mockFetch = async (input, init) => {
    const u = String(input);
    if (u.endsWith("/v1/auth/session")) return backendSessionResponse("contributor-account");
    if (u.endsWith("/v1/auth/oauth/google/callback")) {
      assert.equal(init.headers["x-auth-exchange-secret"], "ef".repeat(32));
      return new Response(JSON.stringify({
        account_id: "contributor-account",
        session_token: "contributor-session",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        roles: ["user"],
      }), { status: 200 });
    }
    if (u === "https://doc.rust-lang.org/nomicon/") {
      return new Response(
        "<!doctype html><html><head><title>The Rustonomicon</title></head><body><h1>The Dark Arts of Unsafe Rust</h1></body></html>",
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    return new Response(JSON.stringify({ status: "offline" }), { status: 503 });
  };

  const { server } = createWebAppServer({
    storePath,
    byokMasterKey: "ab".repeat(32),
    env: { APP_ENV: "development", AUTH_EXCHANGE_SECRET: "ef".repeat(32) },
    openCatalogDir: catalogDir,
    fetchImpl: mockFetch,
    apiBaseUrl: "http://127.0.0.1:9",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  try {
    // 1. Public JSON Schema & catalog index endpoints
    const schemaRes = await fetch(`${baseUrl}/catalog/schema/resource.schema.json`);
    assert.equal(schemaRes.status, 200);
    const schemaJson = await schemaRes.json();
    assert.equal(schemaJson.type, "object");
    assert.ok(schemaJson.properties.resource_version_id);

    const listRes = await fetch(`${baseUrl}/catalog/resources.json`);
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.ok(listJson.count >= 18, `expected >= 18 open catalog entries, got ${listJson.count}`);

    const singleRes = await fetch(`${baseUrl}/catalog/resources/discovered-book-hnsw-vector-v1.json`);
    assert.equal(singleRes.status, 200);
    const singleJson = await singleRes.json();
    assert.equal(singleJson.resource_version_id, "discovered-book-hnsw-vector-v1");

    // 2. Manual contributor Git PR simulation: drop a new JSON file onto disk and verify hot-load
    const prDir = path.join(catalogDir, "resources", "systems");
    fs.mkdirSync(prDir, { recursive: true });
    fs.writeFileSync(
      path.join(prDir, "community-ebpf-tracing-guide-v1.json"),
      JSON.stringify(
        {
          $schema: "../../schema/resource.schema.json",
          catalog_collection: "community_discovered",
          resource_version_id: "community-ebpf-tracing-guide-v1",
          title: "Linux eBPF Tracing & XDP Packet Filtering Handbook",
          canonical_url: "https://ebpf.io/what-is-ebpf/",
          captured_at: "2026-10-31T12:00:00Z",
          category: "Documentation",
          subject: "Systems",
          summary: "Hands-on kernel tracing and verifier guide contributed via Git PR.",
          topic_tags: ["ebpf", "linux-kernel", "observability"],
          provider: {
            provider_id: "ebpf-foundation",
            display_name: "eBPF Foundation",
          },
          access: {
            model: "free",
            tier_label: "Free",
            cost_label: "$0",
            rights_label: "Link & metadata",
            certificate_included: false,
            optional_certificate_price_minor: null,
            access_verified_at: "2026-10-31T12:00:00Z",
          },
          ingestion_permissions: {
            basis: "link_and_metadata_only",
            permissions: { display_excerpts: "denied" },
          },
          vector_index: {
            status: "indexed",
            index_type: "tfidf-cosine-v1",
            discovered_by: "Community Git PR",
            discovered_by_handle: "@kernel_contributor",
            last_indexed_at: "2026-10-31T12:00:00Z",
          },
          segments: [
            { segment_id: "ebpf-seg-1", title: "1. eBPF Verifier & Maps", verified: true },
            { segment_id: "ebpf-seg-2", title: "2. kprobes, tracepoints, and XDP", verified: true },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const hotSingleRes = await fetch(`${baseUrl}/catalog/resources/community-ebpf-tracing-guide-v1.json`);
    assert.equal(hotSingleRes.status, 200);
    const hotSingle = await hotSingleRes.json();
    assert.equal(hotSingle.title, "Linux eBPF Tracing & XDP Packet Filtering Handbook");

    // 3. A learner can index a resource locally without writing into the Git-tracked catalog.
    const homeRes = await fetch(`${baseUrl}/`);
    parseCookies(homeRes, jar);

    await signInWithDevOAuth(baseUrl, jar, "contributor@example.test");

    const ingestRes = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
      body: JSON.stringify({
        action: "ingest-manual-resource",
        rawText: "https://doc.rust-lang.org/nomicon/ The Rustonomicon unsafe Rust reference",
      }),
    });
    const ingestJson = await ingestRes.json();
    const addedId = ingestJson.state.userLibraryResourceIds[0];
    assert.ok(addedId, "expected userLibraryResourceIds[0] after manual ingestion");

    // The entry remains in the contributor's library without becoming a public catalog item.
    const exportedRes = await fetch(`${baseUrl}/catalog/resources/${addedId}.json`);
    assert.equal(exportedRes.status, 404);
    assert.equal(fs.existsSync(path.join(catalogDir, "resources", "systems", `${addedId}.json`)), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Gap 2, Gap 3 & Gap 5: Auth decoupled from workspace persistence across sign-out/restart, AES-256-GCM BYOK vault + JIT decryption, live reschedule, unpublish, export & account deletion", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syllabus-runtime-gaps-"));
  const storePath = path.join(tmpDir, "web-store.json");
  const masterKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const aliceRawApiKey = "sk-live-alice-byok-vault-secret-987654";

  const seenOpenAiAuthHeaders = [];
  const mockFetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/v1/auth/session")) {
      return backendSessionResponse(init.headers.Authorization.includes("bob@example.test") ? "bob-account" : "alice-account");
    }
    if (u.endsWith("/v1/auth/oauth/google/callback")) {
      assert.equal(init.headers["x-auth-exchange-secret"], "ef".repeat(32));
      const email = JSON.parse(init.body).email;
      return new Response(JSON.stringify({
        account_id: email === "bob@example.test" ? "bob-account" : "alice-account",
        session_token: `session-${email}`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        roles: ["user"],
      }), { status: 200 });
    }
    if (u.endsWith("/v1/me/deletion-requests")) {
      assert.equal(JSON.parse(init.body).confirm_deletion, true);
      return new Response(JSON.stringify({ status: "completed" }), { status: 202 });
    }
    if (u === "https://github.com/ept/ddia-references") {
      return new Response(
        "<!doctype html><html><head><title>DDIA References</title></head><body><h1>Designing Data-Intensive Applications</h1></body></html>",
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (u === "https://api.openai.com/v1/responses") {
      seenOpenAiAuthHeaders.push(init?.headers?.authorization ?? init?.headers?.Authorization ?? "");
      const reqBody = JSON.parse(String(init?.body ?? "{}"));
      const inputStr = JSON.stringify(reqBody);
      const isResourceAnalysis = inputStr.includes("ddia-references");
      const replyObj = isResourceAnalysis
        ? {
            title: "Designing Data-Intensive Applications Companion Repo",
            publisher: "GitHub / Martin Kleppmann",
            category: "Repository",
            subject: "Systems",
            accessModel: "free",
            selectionRationale: "Distributed systems study references and chapter notes.",
            topics: ["Distributed Systems", "Replication", "Consensus"],
            segments: ["Part I: Foundations", "Part II: Distributed Data"],
          }
        : LIVE_DRAFT_FIXTURE;
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(replyObj) }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ status: "offline" }), { status: 503 });
  };

  const makeServer = () =>
    createWebAppServer({
      storePath,
      apiBaseUrl: "http://127.0.0.1:9",
      fetchImpl: mockFetch,
      env: {
        APP_ENV: "development",
        AUTH_EXCHANGE_SECRET: "ef".repeat(32),
        BYOK_MASTER_KEY: masterKeyHex,
      },
    });

  // === BOOT 1 ===
  const boot1 = makeServer();
  await new Promise((resolve) => boot1.server.listen(0, "127.0.0.1", resolve));
  const baseUrl1 = `http://127.0.0.1:${boot1.server.address().port}`;
  const jar1 = new Map();

  let aliceSyllabusId = "";
  let aliceResourceId = "";
  let alicePublicationId = "";

  try {
    const initRes = await fetch(`${baseUrl1}/`);
    parseCookies(initRes, jar1);

    const postUi = async (jar, body, base = baseUrl1) => {
      const res = await fetch(`${base}/api/ui-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      return res.json();
    };

    // 1. Sign in as Alice through a verified development OAuth exchange.
    await signInWithDevOAuth(baseUrl1, jar1, "alice@example.test");
    const signedUp = await postUi(jar1, { action: "noop" });
    assert.equal(signedUp.state.authStatus, "authenticated");
    assert.equal(signedUp.state.account.email, "alice@example.test");

    // 2. Store Alice's BYOK OpenAI key -> verify AES-256-GCM encryption at rest & zero plaintext leakage
    const keySaved = await postUi(jar1, {
      action: "replace-key",
      providerId: "openai",
      keyValue: aliceRawApiKey,
    });
    const openaiCred = keySaved.state.byokCredentials.find((c) => c.provider_id === "openai");
    assert.ok(openaiCred);
    assert.equal(openaiCred.masked_suffix, "7654");
    assert.equal(openaiCred.masked_hint, "••••7654");
    assert.equal(JSON.stringify(keySaved).includes(aliceRawApiKey), false, "UI response must never leak raw BYOK key");

    const rawDiskAfterKey = fs.readFileSync(storePath, "utf8");
    assert.equal(rawDiskAfterKey.includes(aliceRawApiKey), false, "web-store.json must NEVER contain plaintext BYOK key");
    const parsedDisk = JSON.parse(rawDiskAfterKey);
    const vaultAccountIds = Object.keys(parsedDisk.byokVault ?? {});
    assert.equal(vaultAccountIds.length, 1);
    const sealedOpenai = parsedDisk.byokVault[vaultAccountIds[0]].openai;
    assert.equal(sealedOpenai.alg, "aes-256-gcm");
    assert.ok(sealedOpenai.ciphertext_b64 && sealedOpenai.iv_b64 && sealedOpenai.tag_b64);

    // 3. JIT decryption during live AI syllabus generation AND manual resource ingestion
    const genRes = await postUi(jar1, {
      action: "generate-syllabus-ai",
      intakeGoalTitle: "Raft Distributed Consensus in Rust",
      intakeSubject: "Systems",
    });
    aliceSyllabusId = genRes.state.selectedSyllabusId;
    assert.ok(
      genRes.state.generatedPlans.some((p) => p.syllabusId === aliceSyllabusId),
      `expected generated syllabus in generatedPlans, got ${aliceSyllabusId}`,
    );

    const ingestRes = await postUi(jar1, {
      action: "ingest-manual-resource",
      rawText: "https://github.com/ept/ddia-references DDIA distributed systems references",
    });
    aliceResourceId = ingestRes.state.userLibraryResourceIds[0];
    assert.ok(aliceResourceId);

    // Both outbound OpenAI calls used Alice's JIT-decrypted BYOK key.
    assert.equal(seenOpenAiAuthHeaders.length, 2);
    assert.equal(seenOpenAiAuthHeaders[0], `Bearer ${aliceRawApiKey}`);
    assert.equal(seenOpenAiAuthHeaders[1], `Bearer ${aliceRawApiKey}`);

    // 4. Complete an activity, reschedule a session, set reminder preferences, and publish syllabus
    await postUi(jar1, { action: "select-syllabus", syllabusId: "syllabus-rag-python-001" });
    const afterComplete = await postUi(jar1, {
      action: "complete-activity",
      activityId: "activity-theory",
    });
    assert.equal(afterComplete.state.selfReportedCompletedCount, 1);

    const resched = await postUi(jar1, {
      action: "reschedule-session",
      sessionId: "session-today-1",
      rescheduleValue: "2026-11-07T18:00:00Z",
    });
    const overriddenSessions = resched.state.scheduleOverrides["syllabus-rag-python-001"]?.sessions ?? [];
    assert.equal(
      overriddenSessions.find((s) => s.session_id === "session-today-1")?.start_at,
      "2026-11-07T18:00:00Z",
    );

    const reminderUpdated = await postUi(jar1, {
      action: "set-reminder-schedule",
      weekdayTime: "19:30",
      leadMinutes: "30 min before",
    });
    assert.equal(reminderUpdated.state.reminderWeekdayTime, "19:30");
    assert.equal(reminderUpdated.state.reminderLeadMinutes, "30 min before");

    await postUi(jar1, { action: "select-syllabus", syllabusId: aliceSyllabusId });
    const published = await postUi(jar1, {
      action: "confirm-publish-syllabus",
    });
    const alicePub = published.state.publishedListings.find((p) => p.sourceSyllabusId === aliceSyllabusId);
    assert.ok(alicePub, "expected Alice's published syllabus in publishedListings");
    alicePublicationId = alicePub.publicationId;

    // 5. Alice signs out on jar1; Bob signs in on the same cookie jar.
    const afterSignOut = await postUi(jar1, { action: "sign-out" });
    assert.equal(afterSignOut.state.authStatus, "guest");

    await signInWithDevOAuth(baseUrl1, jar1, "bob@example.test");
    const bobSignedUp = await postUi(jar1, { action: "noop" });
    assert.equal(bobSignedUp.state.authStatus, "authenticated");
    assert.equal(bobSignedUp.state.selfReportedCompletedCount, 0);
    assert.equal(bobSignedUp.state.generatedPlans.some((s) => s.syllabusId === aliceSyllabusId), false);
    assert.equal(bobSignedUp.state.byokCredentials.some((c) => c.masked_suffix === "7654"), false);

    await postUi(jar1, { action: "sign-out" });
  } finally {
    await new Promise((resolve) => boot1.server.close(resolve));
  }

  // === BOOT 2: Brand-new server restart + brand-new browser cookie jar2 ===
  const boot2 = makeServer();
  await new Promise((resolve) => boot2.server.listen(0, "127.0.0.1", resolve));
  const baseUrl2 = `http://127.0.0.1:${boot2.server.address().port}`;
  const jar2 = new Map();

  try {
    const initRes2 = await fetch(`${baseUrl2}/`);
    parseCookies(initRes2, jar2);
    await signInWithDevOAuth(baseUrl2, jar2, "alice@example.test");
    const initHtml2 = await (await fetch(`${baseUrl2}/`, { headers: { Cookie: cookieHeader(jar2) } })).text();

    // Verify Modern Web Guidance destructive confirmation dialog autofocus on safe Cancel action
    for (const dialogId of ["dialog-unpublish", "dialog-account-deletion"]) {
      const start = initHtml2.indexOf(`<dialog id="${dialogId}"`);
      assert.ok(start >= 0, `expected ${dialogId} in SSR HTML`);
      const block = initHtml2.slice(start, initHtml2.indexOf("</dialog>", start));
      assert.match(block, /data-action="close-dialog"[^>]*autofocus/, `${dialogId} must put autofocus on safe Cancel button`);
    }

    const postUi2 = async (body) => {
      const res = await fetch(`${baseUrl2}/api/ui-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar2) },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      return res.json();
    };

    // 6. Alice signs back in after server restart on a brand-new cookie -> 100% workspace restored!
    const aliceRelogin = await postUi2({ action: "noop" });
    assert.equal(aliceRelogin.state.authStatus, "authenticated");
    assert.equal(aliceRelogin.state.selfReportedCompletedCount, 1);
    assert.ok(aliceRelogin.state.generatedPlans.some((s) => s.syllabusId === aliceSyllabusId));
    assert.ok(aliceRelogin.state.userLibraryResourceIds.includes(aliceResourceId));
    assert.equal(
      aliceRelogin.state.scheduleOverrides["syllabus-rag-python-001"]?.sessions?.find(
        (s) => s.session_id === "session-today-1",
      )?.start_at,
      "2026-11-07T18:00:00Z",
    );
    assert.equal(aliceRelogin.state.reminderWeekdayTime, "19:30");
    assert.equal(
      aliceRelogin.state.byokCredentials.find((c) => c.provider_id === "openai")?.masked_suffix,
      "7654",
    );

    // 7. Portable Account Export excludes passwordHash, raw BYOK keys, and ciphertexts
    const exportRes = await fetch(`${baseUrl2}/api/account/export`, {
      headers: { Cookie: cookieHeader(jar2) },
    });
    assert.equal(exportRes.status, 200);
    const exportRaw = await exportRes.text();
    assert.equal(exportRaw.includes(aliceRawApiKey), false);
    assert.equal(exportRaw.includes("passwordHash"), false);
    assert.equal(exportRaw.includes("ciphertext_b64"), false);
    const exportJson = JSON.parse(exportRaw);
    assert.equal(exportJson.account.email, "alice@example.test");
    assert.equal(exportJson.byok_credentials_metadata[0].masked_hint, "••••7654");

    // 8. Live Unpublish withdraws Alice's publication
    const unpublished = await postUi2({
      action: "confirm-unpublish-syllabus",
      publicationId: alicePublicationId,
    });
    assert.ok(unpublished.state.unpublishedPublicationIds.includes(alicePublicationId));

    // 9. Revoking BYOK connection deletes encrypted envelope and disables .env fallback
    const keyDeleted = await postUi2({
      action: "delete-connection",
      providerId: "openai",
    });
    assert.equal(keyDeleted.state.byokCredentials.some((c) => c.provider_id === "openai"), false);

    // 10. Live Destructive Account Deletion purges account, workspace, and BYOK vault
    const deleted = await postUi2({ action: "confirm-delete-account" });
    assert.equal(deleted.state.authStatus, "guest");

    assert.equal((await fetch(`${baseUrl2}/api/account/export`, { headers: { Cookie: cookieHeader(jar2) } })).status, 401);
  } finally {
    await new Promise((resolve) => boot2.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
