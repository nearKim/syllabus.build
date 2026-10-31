import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mountSyllabusWebApp } from "../src/browserApp.ts";
import { buildIndexedMaterialCandidates, catalogIndexOf } from "../src/components/NewSyllabusDialog.tsx";
import {
  analyzeManualResourceDeterministic,
  isSafePublicHttpsUrl,
  parseFreeFormResourceInput,
} from "../src/resourceAnalyzer.ts";
import { createWebAppServer } from "../src/server.mjs";
import { searchTfidf } from "../src/tfidfIndex.ts";

function parseCookies(res, jar = new Map()) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
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
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

test("parseFreeFormResourceInput normalizes bare URLs with free-form notes and enforces SSRF public-HTTPS guardrails", () => {
  const parsed = parseFreeFormResourceInput(
    "udemy.com/course/ckad-kubernetes this is the ckad course covering pods, deployments, helm, and network policies",
  );
  assert.equal("error" in parsed, false);
  assert.equal(parsed.canonicalUrl, "https://udemy.com/course/ckad-kubernetes");
  assert.equal(parsed.host, "udemy.com");
  assert.equal(
    parsed.userNotes,
    "this is the ckad course covering pods, deployments, helm, and network policies",
  );

  const analyzed = analyzeManualResourceDeterministic({ parsed });
  assert.equal(analyzed.publisher, "Udemy");
  assert.equal(analyzed.category, "Course");
  assert.equal(analyzed.subject, "Systems");
  assert.equal(analyzed.accessModel, "paid");
  assert.ok(analyzed.title.includes("CKAD"), `Expected CKAD in title, got: ${analyzed.title}`);
  assert.ok(analyzed.topics.some((t) => /ckad|kubernetes|helm|pods/i.test(t)));
  assert.ok(analyzed.segments.length >= 2);

  // SSRF guardrails
  assert.equal(isSafePublicHttpsUrl("https://udemy.com/course/ckad"), true);
  assert.equal(isSafePublicHttpsUrl("http://udemy.com/course/ckad"), false);
  assert.equal(isSafePublicHttpsUrl("https://localhost/admin"), false);
  assert.equal(isSafePublicHttpsUrl("https://127.0.0.1/secret"), false);
  assert.equal(isSafePublicHttpsUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isSafePublicHttpsUrl("https://10.0.0.8/internal"), false);
  assert.equal(isSafePublicHttpsUrl("https://intranet.local/course"), false);
  assert.equal(isSafePublicHttpsUrl("https://user:pass@udemy.com/course/ckad"), false);

  const rejectedLocal = parseFreeFormResourceInput("http://127.0.0.1:8080/internal secret notes");
  assert.equal("error" in rejectedLocal, true);
});

test("Manual resource ingestion, library-only save, syllabus link, edit, unlink, delete, and immediate MiniSearch TF-IDF re-indexing", () => {
  const root = { innerHTML: "" };
  const app = mountSyllabusWebApp(root, {
    topLevel: "Learn",
    learnSubDestination: "Resources",
  });

  // 1. Open the Add Resource dialog and ingest a bare-domain Udemy URL + free-form notes directly into the active syllabus
  app.applyUiAction("open-resource-editor", {
    editorMode: "ingest",
    syllabusId: "syllabus-rag-python-001",
    moduleId: "module-foundations",
  });
  assert.equal(app.getState().openDialogId, "dialog-resource-editor");
  assert.ok(root.innerHTML.includes('id="dialog-resource-editor"'));

  app.applyUiAction("ingest-manual-resource", {
    rawText:
      "udemy.com/course/ckad-kubernetes-hands-on this is the CKAD Kubernetes course covering pods, deployments, Helm charts, and network policies",
    targetSyllabusId: "syllabus-rag-python-001",
    targetModuleId: "module-foundations",
    role: "primary",
  });

  const afterIngest = app.getState();
  assert.equal(afterIngest.openDialogId, null);
  assert.equal(afterIngest.userLibraryResourceIds.length, 1);
  const ckadId = afterIngest.userLibraryResourceIds[0];
  assert.match(ckadId, /^manual-/);
  assert.equal(
    afterIngest.catalogResources[ckadId].canonical_url,
    "https://udemy.com/course/ckad-kubernetes-hands-on",
  );
  assert.equal(afterIngest.catalogResources[ckadId].category, "Course");

  // Rendered in Current Syllabus Resources table right away
  const resourcesSection = () =>
    root.innerHTML.slice(
      root.innerHTML.indexOf('id="panel-learn-resources"'),
      root.innerHTML.indexOf('id="panel-explore"'),
    );
  assert.ok(resourcesSection().includes(`data-resource-version-id="${ckadId}"`));
  assert.ok(resourcesSection().includes("Udemy"));

  // Immediately searchable via MiniSearch TF-IDF index (using include_paid since Udemy defaults to paid)
  const ckadCandidates = buildIndexedMaterialCandidates(
    afterIngest.catalogResources,
    "Systems",
    ["CKAD", "Helm"],
    "include_paid",
    "CKAD Kubernetes Helm charts network policies",
  );
  assert.ok(
    ckadCandidates.some((c) => c.resourceVersionId === ckadId),
    "Newly ingested manual resource must be ranked immediately by MiniSearch TF-IDF",
  );

  // 2. Ingest a second resource into Library Only ("__library_only__"), then link it later to the syllabus
  app.applyUiAction("ingest-manual-resource", {
    rawText:
      "youtube.com/watch?v=ciliumEbpf99 eBPF packet filtering and Cilium datapath walkthrough",
    targetSyllabusId: "__library_only__",
  });
  const afterLibOnly = app.getState();
  assert.equal(afterLibOnly.userLibraryResourceIds.length, 2);
  const ebpfId = afterLibOnly.userLibraryResourceIds.find((id) => id !== ckadId);
  assert.ok(ebpfId);

  // Saving to Library Only switches scope to "all" so the learner sees "Saved in library · Not linked yet",
  // while switching to "selected" scope excludes it until linked.
  assert.equal(afterLibOnly.resourceScope, "all");
  assert.ok(resourcesSection().includes(`data-resource-version-id="${ebpfId}"`));
  assert.ok(resourcesSection().includes("Saved in library · Not linked yet"));
  app.applyUiAction("set-resource-scope", { resourceScope: "selected" });
  assert.equal(resourcesSection().includes(`data-resource-version-id="${ebpfId}"`), false);

  // Link the library resource to syllabus-rag-python-001
  app.applyUiAction("link-library-resource", {
    resourceVersionId: ebpfId,
    targetSyllabusId: "syllabus-rag-python-001",
    targetModuleId: "module-foundations",
    role: "supplemental",
    selectionRationale: "Watch before configuring Kubernetes CNI plugins.",
  });
  app.applyUiAction("set-resource-scope", { resourceScope: "selected" });
  assert.ok(resourcesSection().includes(`data-resource-version-id="${ebpfId}"`));
  assert.ok(resourcesSection().includes("Watch before configuring Kubernetes CNI plugins."));

  // 3. Edit the resource metadata, topics, syllabus sections, and rationale — verify immediate TF-IDF re-indexing
  app.applyUiAction("open-resource-editor", {
    editorMode: "edit",
    resourceId: ebpfId,
    syllabusId: "syllabus-rag-python-001",
  });
  assert.equal(app.getState().resourceEditorMode, "edit");
  assert.equal(app.getState().editingResourceId, ebpfId);

  app.applyUiAction("save-resource-edit", {
    resourceVersionId: ebpfId,
    title: "Cilium eBPF Datapath & XDP Kernel Bypass Deep Dive",
    canonicalUrl: "https://youtube.com/watch?v=ciliumEbpf99",
    category: "YouTube",
    publisher: "Cloud Native Systems Channel",
    accessModel: "free",
    topics: "eBPF, Cilium, XDPzcopytoken, SocketMap",
    segments: "00:00 — XDP Hook Architecture\n18:40 — SocketMap Service Load Balancing",
    targetSyllabusId: "syllabus-rag-python-001",
    targetModuleId: "module-foundations",
    role: "primary",
    selectionRationale: "Focus on XDP hook architecture and SocketMap load balancing.",
  });

  const afterEdit = app.getState();
  assert.equal(afterEdit.catalogResources[ebpfId].title, "Cilium eBPF Datapath & XDP Kernel Bypass Deep Dive");
  assert.ok(resourcesSection().includes("Cilium eBPF Datapath &amp; XDP Kernel Bypass Deep Dive"));
  assert.ok(resourcesSection().includes("18:40 — SocketMap Service Load Balancing"));

  // Verify TF-IDF WeakMap cache invalidated and immediately finds the newly added unique topic token
  const tfidfHitsAfterEdit = searchTfidf(catalogIndexOf(afterEdit.catalogResources), "xdpzcopytoken socketmap");
  assert.equal(tfidfHitsAfterEdit[0]?.id, ebpfId);

  // 4. Unlink from syllabus ("Remove"): disappears from Current Syllabus, remains in library & TF-IDF index
  app.applyUiAction("unlink-syllabus-resource", {
    resourceId: ebpfId,
    syllabusId: "syllabus-rag-python-001",
  });
  assert.equal(resourcesSection().includes(`data-resource-version-id="${ebpfId}"`), false);
  app.applyUiAction("set-resource-scope", { resourceScope: "all" });
  assert.ok(resourcesSection().includes(`data-resource-version-id="${ebpfId}"`));
  assert.ok(resourcesSection().includes("Saved in library · Not linked yet"));

  // 5. Permanently delete from library ("Delete"): removed from catalogResources, UI, and TF-IDF index
  app.applyUiAction("delete-library-resource", {
    resourceId: ebpfId,
  });
  const afterDelete = app.getState();
  assert.equal(ebpfId in afterDelete.catalogResources, false);
  assert.equal(afterDelete.userLibraryResourceIds.includes(ebpfId), false);
  assert.equal(resourcesSection().includes(`data-resource-version-id="${ebpfId}"`), false);
  assert.deepEqual(searchTfidf(catalogIndexOf(afterDelete.catalogResources), "xdpzcopytoken"), []);
});

test("Web SSR server runs live HTML inspection + OpenAI structured extraction and persists manual resources & syllabus edits across restarts", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syllabus-manual-res-test-"));
  const storePath = path.join(tmpDir, "web-store.json");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fetchedUrls = [];
  const fetchStub = async (input, init) => {
    const url = String(input);
    fetchedUrls.push(url);

    if (url === "https://academy.example.com/courses/tokio-async-rust") {
      const html = `<!doctype html>
        <html lang="en">
          <head>
            <title>Production Async Rust with Tokio | Systems Academy</title>
            <meta property="og:site_name" content="Systems Academy" />
            <meta name="description" content="Master Pin, Waker, cooperative scheduling, and bounded MPSC channels in Tokio." />
            <script type="application/ld+json">{"@type":"Course","name":"Production Async Rust with Tokio"}</script>
          </head>
          <body>
            <h1>Production Async Rust with Tokio</h1>
            <h2>Module 1: Future Trait, Pin, and Waker Mechanics</h2>
            <h2>Module 2: Work-Stealing Runtime &amp; Bounded Channels</h2>
          </body>
        </html>`;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url === "https://api.openai.com/v1/responses") {
      const aiPayload = {
        title: "Production Async Rust & Tokio Runtime Architecture",
        publisher: "Systems Academy",
        category: "Course",
        subject: "Systems",
        accessModel: "free",
        selectionRationale: "Covers Pin/Unpin invariants, Waker state machines, and Tokio MPSC backpressure.",
        topics: ["Async Rust", "Tokio", "Waker", "Backpressure"],
        segments: [
          "Module 1: Future Trait, Pin, and Waker Mechanics",
          "Module 2: Work-Stealing Runtime & Bounded Channels",
          "Module 3: Structured Cancellation & Graceful Shutdown",
        ],
      };
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(aiPayload) }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Best-effort backend sync returns offline/404 cleanly in isolated web server unit test
    return new Response(JSON.stringify({ status: "offline" }), { status: 503 });
  };

  const { server: server1 } = createWebAppServer({
    storePath,
    env: { NODE_ENV: "development", OPENAI_API_KEY: "sk-test-openai-key" },
    fetchImpl: fetchStub,
    apiBaseUrl: "http://127.0.0.1:59999",
  });
  await new Promise((resolve) => server1.listen(0, "127.0.0.1", resolve));
  t.after(() => server1.close());
  const port1 = server1.address().port;
  const base1 = `http://127.0.0.1:${port1}`;

  const jar = new Map();
  const homeRes = await fetch(`${base1}/`);
  assert.equal(homeRes.status, 200);
  parseCookies(homeRes, jar);

  // Navigate to Resources and ingest via POST /api/ui-state
  await fetch(`${base1}/api/ui-state`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify({ learnSubDestination: "Resources" }),
  });

  const ingestRes = await fetch(`${base1}/api/ui-state`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify({
      action: "ingest-manual-resource",
      rawText:
        "academy.example.com/courses/tokio-async-rust hands-on async rust course covering Pin, Waker, and Tokio channels",
      targetSyllabusId: "syllabus-rag-python-001",
      targetModuleId: "module-foundations",
      role: "primary",
    }),
  });
  assert.equal(ingestRes.status, 200);
  const ingestPayload = await ingestRes.json();

  assert.ok(
    fetchedUrls.includes("https://academy.example.com/courses/tokio-async-rust"),
    "Server must inspect the public HTTPS target page internals",
  );
  assert.ok(
    fetchedUrls.includes("https://api.openai.com/v1/responses"),
    "Server must invoke configured AI model to analyze internals + learner notes",
  );

  const tokioId = ingestPayload.state.userLibraryResourceIds[0];
  assert.match(tokioId, /^manual-/);
  const storedCatalogEntry = ingestPayload.state.catalogResources[tokioId];
  assert.equal(storedCatalogEntry.title, "Production Async Rust & Tokio Runtime Architecture");
  assert.equal(storedCatalogEntry.provider.display_name, "Systems Academy");
  assert.equal(storedCatalogEntry.vector_index.discovered_by, "Community Published");
  assert.equal(storedCatalogEntry.segments.length, 3);
  assert.ok(ingestPayload.html.includes("Production Async Rust &amp; Tokio Runtime Architecture"));

  // Direct JSON API endpoint POST /api/resources/manual also analyzes and indexes
  const directApiRes = await fetch(`${base1}/api/resources/manual`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify({
      rawText: "https://academy.example.com/courses/tokio-async-rust revisited notes",
      targetSyllabusId: "__library_only__",
    }),
  });
  assert.equal(directApiRes.status, 201);
  const directJson = await directApiRes.json();
  assert.equal(directJson.analyzedDraft.analyzedBy, "ai");
  assert.equal(
    directJson.analyzedDraft.resourceVersionId,
    tokioId,
    "Same canonical URL deduplicates to stable resource ID",
  );

  await new Promise((resolve) => server1.close(resolve));

  // Restart a brand-new server instance pointing at the same storePath and verify full durability
  const { server: server2 } = createWebAppServer({
    storePath,
    env: { NODE_ENV: "development" },
    fetchImpl: fetchStub,
    apiBaseUrl: "http://127.0.0.1:59999",
  });
  await new Promise((resolve) => server2.listen(0, "127.0.0.1", resolve));
  t.after(() => server2.close());
  const port2 = server2.address().port;

  const stateRes2 = await fetch(`http://127.0.0.1:${port2}/api/ui-state`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify({ learnSubDestination: "Resources" }),
  });
  assert.equal(stateRes2.status, 200);
  const payload2 = await stateRes2.json();
  assert.ok(payload2.state.userLibraryResourceIds.includes(tokioId));
  assert.equal(
    payload2.state.catalogResources[tokioId]?.title,
    "Production Async Rust & Tokio Runtime Architecture",
  );
  assert.ok(payload2.html.includes("Production Async Rust &amp; Tokio Runtime Architecture"));
});
