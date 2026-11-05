# Quiz indexing architecture review

Completed: 2026-11-05T01:40:24+00:00

## Review provenance

- Reviewer: Claude Opus 5.5. The runner reported canonical model `claude-opus-5-5` and a successful result.
- Requested effort: `max`, verified in the running process arguments. This is the highest [documented effort level](https://platform.claude.com/docs/en/build-with-claude/effort).
- Runner: Claude Code 2.1.318, with restricted and safe modes enabled. Only `Read`, `Grep`, and `Glob` were enabled. No fallback model was configured.
- Reviewed commit: `e270a1fe15afaf5650c64e392ca63befb78a3401` on `main`.
- Scope: general quiz discovery, indexing, persistence, and syllabus assembly across arbitrary subjects. The proposal was `docs/quiz-sourcing-proposal.md`.
- Duration: 733.5 seconds. The runner reported 101 turns and no permission denials.
- Method: static repository review. No runtime tests, provider extraction trials, or deployment checks were performed.

The reviewer report below is reproduced unchanged. Its severity labels express product and architecture priorities, not validated security ratings.

## Coordinator verification

I checked the major conclusions against the current source:

- The diagnostic handler writes `demonstrated` after one correct answer. Its general fallback repeats the success criterion as the correct choice. ([Handler](/Users/garfield/dev/syllabus.build/apps/web/src/browserAppController.ts:1328), [fallback](/Users/garfield/dev/syllabus.build/apps/web/src/liveTutor.ts:204))
- The web coverage evaluator has no separate assessment requirement. Its prompt forbids further search when topic coverage has no gaps. Fixing only the Rust evaluator would not fix this web path. ([Coverage](/Users/garfield/dev/syllabus.build/apps/web/src/components/newSyllabus/pipeline.ts:116), [prompt](/Users/garfield/dev/syllabus.build/apps/web/src/liveDraft.ts:58))
- The live draft has exactly two modules. The builder can assign a seeded resource when no resource was selected. ([Draft](/Users/garfield/dev/syllabus.build/apps/web/src/liveDraft.ts:34), [assignment](/Users/garfield/dev/syllabus.build/apps/web/src/components/newSyllabus/pipeline.ts:412))
- The direct page inspector retains metadata and headings. It does not extract complete assessment content. Provider web-search tools do exist, but the adapters retain reply text rather than structured citation evidence. This does not establish that every returned URL is fabricated. ([Inspector](/Users/garfield/dev/syllabus.build/apps/web/src/resourceAnalyzer.ts:371), [adapter](/Users/garfield/dev/syllabus.build/apps/web/src/liveDraft.ts:298))
- Discovered resources are absent from the workspace resource snapshot unless they enter the user library. Plan identifiers use the current plan count, which can shrink after deletion. ([Snapshot](/Users/garfield/dev/syllabus.build/apps/web/src/server.mjs:1409), [identifier sequence](/Users/garfield/dev/syllabus.build/apps/web/src/browserAppController.ts:1622))

Finding 7 describes a risk of reusing the current assessment store for private questions. The current globally readable assessment records do not, by themselves, establish exposure of private user questions. The report's permission-policy changes and broader architecture recommendations remain proposals. No application or policy changes were made during this review.

## Independent reviewer report

## Verdict

**Keep the direction, but do not build it as written.** Separating sources, questions, quiz selections and attempts is right, and no new service or vector database is needed. But the proposal assumes three things the learner-facing path lacks: objective-level planning, source-content reading and row-level assessment storage. It also promises to preserve a mastery rule the running product already breaks. Its line citations that I checked were accurate; the problem is what it omits.

**Basis:** static reading of `e270a1f`. I ran no runtime tests, so failure examples are traced from code, not observed.

**Short filenames resolve to:**
- `apps/web/src/`: `browserAppController.ts`, `server.mjs`, `liveDraft.ts`, `liveTutor.ts`, `resourceAnalyzer.ts`, `renderWebAppHtml.ts`
- `apps/web/src/components/newSyllabus/`: `pipeline.ts`, `indexing.ts`, `taxonomy.ts`
- `crates/persistence/src/`: `store*.rs`, `pg_backend.rs`, `models.rs`, `migrations.rs`
- `crates/domain/src/`: `catalog.rs`, `syllabus.rs`
- `crates/persistence/migrations/`: migrations by number

## The fit-evaluator claim

**True of the Rust function, but that function does not govern the running product. The real suppression is broader.**

| Layer | Behavior | Evidence |
|---|---|---|
| Rust domain function | An instruction-only topic is `Covered`, so search is bypassed. A test locks this in. | `catalog.rs:767-770,792-804`; `crates/domain/src/tests.rs:592,635` |
| Rust API route | I found no first-party caller. It marks every resource as instruction and practice, so that branch cannot fire. It runs no search; discoveries come from the request body. | `services/api/src/handlers_catalog.rs:154,176,200` |
| Running web path | Has no practice concept. Any selected resource listing a topic covers it, including topics the model asserted. | `pipeline.ts:116-140`; `indexing.ts:356-359` |
| Running web prompt | With no gaps, it says "Do not search the web". Otherwise it asks for study resources, not assessments, though `Problem Set` is an allowed category. | `liveDraft.ts:21,57-58` |
| Fixtures | Run only without a live draft. | `pipeline.ts:185,242,400-404` |
| Planned contract | Names the Rust evaluator and requires an assessment path or disclosed gap. | `specs/product.md:238,244,333` |

Patching `catalog.rs:767` alone would change nothing learners see.

## Findings: confirmed code facts

### Critical

**1. The product already awards mastery from a template question.**
- One correct answer sets `demonstrated` (`browserAppController.ts:1328-1333`).
- Outside ten seeded objectives, the correct option is the objective's own success criterion, set against two weak options (`liveTutor.ts:204-217,256-267`).
- The result is stored as `corroborated` and can lead to waived instruction (`apps/web/src/components/syllabusEditor/diagnosticEngine.ts:44,138-167`).
- This breaks PED-006 and contradicts `docs/quiz-sourcing-proposal.md:72`. The backend rule (`syllabus.rs:370`) is not on this path.
- Generated quizzes also hard-code `mastery_gated: true` and can be labeled "Reviewed Quiz" (`pipeline.ts:430-435,540,592`).

**2. Creation cannot represent "any goal".**
- Subjects are a fixed five, and unknown goals keep the current subject, Engineering by default (`taxonomy.ts:15,287`).
- With no topics selected, the topics become Python, RAG, Attention and Vector Indexing (`pipeline.ts:59-60`). Search gaps come from those, not the goal text.
- Plans are exactly two modules and six activities, with at most three new resources per run (`liveDraft.ts:46,151`; `pipeline.ts:508-599`).
- Resources bind by position and can fall back to a synthetic fixture (`pipeline.ts:412-422`).

*Failure:* "Medieval Korean history" can yield a lecture citing an engineering catalog entry, and any search targets the default topics.

**3. Nothing reads source content.**
- The only content fetcher I found rejects non-HTML, caps at 128 KB and returns metadata plus eight headings (`resourceAnalyzer.ts:315,317,363,371-378`). Exams are often PDFs.
- Live search keeps only reply text, so URLs are model-typed and then recorded as free and indexed (`liveDraft.ts:298-305,323-327,346-349`; `pipeline.ts:322-324`).
- `DEFAULT_ALLOWED_CATALOG_HOSTS` would reject most of the web if that path were reused (`models.rs:924`; `store_catalog.rs:786`).

**4. Current rights policy blocks the core flow.**
- D03 requires explicit permission for model submission and derived assessments (`specs/product.md:57`).
- Every discovered source is `link_and_metadata_only`, with no automatic route out (`pipeline.ts:323`).
- `specs/product.md:867` also rejects unsupported generated items. Applied literally, arbitrary goals mostly yield gaps.
- Three permission models disagree (`catalog.rs:78-89`; `0003:77-78`; `catalog/schema/resource.schema.json:134`). Only the unused SQL table has model and derivation flags.

### High

**5. The "existing job" and "existing persistence" are not what the proposal needs.**
- Live generation is an inline `await` in a UI action (`server.mjs:2957`).
- The Rust job always uses the fake provider, and its route records fixed tokens labeled `provider_reported` (`crates/application/src/job_runner.rs:98`; `services/api/src/handlers_catalog.rs:306-316`).
- The live web-search adapters and BYOK vault are in Node, while the outbox worker is Rust (`server.mjs:1395`; `pg_backend.rs:1225`).
- Each Rust write re-serializes the full store and rewrites every workspace and catalog row, ignoring save errors (`store.rs:128-134`; `pg_backend.rs:495-678`).
- I found no runtime SQL for `resource_versions`, `catalog_resource_segments` or `assessment_attempts`.

**6. Discovered resources are not durable.** They stay in controller memory and reach neither the workspace snapshot nor the global catalog (`browserAppController.ts:1626`; `server.mjs:1409-1413`). After eviction or restart, plans hold dangling IDs and nothing can be reused (`server.mjs:1254-1277`).

**7. Reusing the assessment store as-is would leak and corrupt data.**
- Any signed-in account can read any assessment by ID, and there is no owner column (`store_learning.rs:116-118`; `0004:12-28`).
- Only the key is stripped, so a `solution` inside an item would leak (`store_learning.rs:138`).
- Grading is exact-string, with one objective and one resource per assessment (`store_learning.rs:229-233`; `0004:14-15`).
- Corrections overwrite keys and scores without keeping prior values, against `specs/product.md:875` (`store_learning.rs:394-395,428-434`).
- Recomputation hard-codes an approved anchor, so correcting an AI practice item can turn its attempts into `demonstrated` (`syllabus.rs:616-617`).
- Publishing spreads the whole syllabus JSON, and the Rust prohibited-field check is top-level only (`browserAppController.ts:589`; `store_lifecycle.rs:170-172`).

**8. Identifiers collide.** Every account's first plan gets `ai-generated-001-objective-1` (`pipeline.ts:427,476`). The sequence is the list length, which shrinks on delete, while saved checks and mastery overrides survive (`browserAppController.ts:1622,2042-2056`).

*Failure:* delete plan 001 while 002 exists, and the next plan reuses 002's IDs, sharing its questions and `demonstrated` status.

### Medium

**9. Fallback practice inflates progress.** Labeling it (`docs/quiz-sourcing-proposal.md:144`) is not enough. A content-free template renders by default, and any answer, right or wrong, ticks the subtask (`renderWebAppHtml.ts:1205`; `browserAppController.ts:1239`). It should count as a gap.

**10. Text search does not scale to questions.** The Rust index rebuilds per call, twice per sort comparison (`catalog.rs:538,693-698`). `search_tsv` covers titles only, and the SQL ranking helpers are called only by tests (`0007:7`; `migrations.rs:215-247`).

## Proposed design constraints

**Question-as-part is the wrong abstraction.** It fits a textbook but fails when the solution sits in another PDF, an AI item cites three sources, or a link-only quiz has no prompt. Use typed evidence links:

```text
SourceVersion 1─* SourcePart (kind, locator, verified)
Item 1─* ItemVersion (interaction kind, content state)
ItemVersion *─* ContextVersion (passage, figure, shared stem)
ItemVersion ─requires→ ItemVersion (dependent subparts)
ItemVersion *─* SourcePart via Evidence (origin|answer|context|grounding)
ItemVersion *─* ObjectiveVersion via Alignment (evidence type, depth, method, confidence)
ItemVersion 1─* AnswerBasisVersion (provenance, evaluator, validation) [server-only]
SyllabusRevision 1─* PracticeSetVersion (purpose, placement, ordered ItemVersions)
Attempt ─ PracticeSetVersion; Attempt 1─* Response (ItemVersion, assistance)
Response 1─* Evaluation (AnswerBasisVersion) [append-only]
ObjectiveEvidence = projection of Evaluations
```

**Invariants**
- Every row has a scope. Derived items inherit their most restrictive input, and cache keys include scope.
- Only a Gate purpose, an approved version and an independent attempt can produce `demonstrated`. The projection is the sole writer.
- Pinned sets are immutable and corrections append. Takedowns redact content but keep a hash and tombstone (GEN-008).
- Selecting subpart (b) requires (a), and (a)'s feedback cannot appear before (b) is answered.
- Model output and fetched pages are untrusted. They cannot set rights, validation or access.
- Published plans cannot reference private items. Each run has a call and cost cap, and partial results are allowed (GEN-001).
- Private uploads need sources without an `https://` URL (`0003:10,35`).

**Coverage.** Tags and lexical search are enough to generate candidates, not to claim coverage. "Derive attention's variance" and "implement attention" share tags but demand different evidence. Resource-level roles also overclaim, because one practice role marks every tagged topic as practiced (`catalog.rs:749-754`).

Track each objective's instruction, practice, review and mastery separately as verified, candidate, link-only or gap. Count only items that are complete, cleared for this use and evaluable.

| Stage | What it establishes | Without it |
|---|---|---|
| Retrieval | A cited URL exists | Link and title only |
| Extraction | Exact text at a locator; each prompt must match the fetched text | External activity, self-reported |
| Grounding | Claims cite permitted excerpts | Labeled general practice, no source claim |
| Validation | Answer supported by a source solution, computation or review | No right/wrong verdict; compare with a rubric; never mastery |

**Extend these:**
- `assessment_ref` as the practice-set pointer (`specs/001-syllabus-platform/contracts/syllabus.schema.json:1120`)
- `PedagogicalTriadValidator`, with a gap state (`crates/application/src/validation.rs:652-751`; `syllabus.rs:234-256`)
- `evaluate_assessment_attempt`
- the segment table design, with wider kinds (`0007:27-41`)
- quarantine overlays for takedowns (`store_catalog.rs:1002`)
- `inspectUrlPageInternals`
- the Node provider adapters

## Scope and implementation order

The data shape is not overbuilt, but the sequencing is. A cross-account question catalog, deduplication and publish flows depend on an unresolved rights decision and can wait.

The smallest slice is one Create syllabus run, for any goal, that saves account-scoped practice per objective, renders it from saved versions, records attempts and discloses gaps. It must work when the catalog has nothing relevant.

1. **Stop false claims.** Remove the `demonstrated` write, default `mastery_gated` to false, and drop "Reviewed Quiz" and the synthetic fallback.
2. **Generalize planning.** Use free-text subjects, a bounded number of goal-derived objectives and one coverage evaluator.
3. **Add account-scoped PostgreSQL tables,** outside the snapshot and workspace JSON.
4. **Run preparation asynchronously.** Search per objective, keep citations, fetch HTML and text PDFs, match extractions against fetched text, and fall back to link-only.
5. **Fill gaps** with grounded or labeled practice, then render Review and inline checks only from saved versions.
6. **Record attempts, reports and append-only corrections.** Add the shared catalog and mastery review later.

**Acceptance tests**
- Five unrelated non-seeded goals produce goal-derived objectives with no seeded topics or fixtures.
- Instruction-only coverage triggers assessment search, and zero results produce a disclosed gap.
- Prompts absent from fetched text are rejected, and a missing figure or passage excludes the item.
- A question with no answer basis gets no verdict. A university question with an AI answer shows separate provenance.
- No private key or unrevealed solution appears in syllabus, publish, workspace or view payloads, and another account gets 404 on a private item.
- Reload, restart and rendering make no provider calls and return identical versions.
- Retries reuse the request hash, and a missing key gives an explicit status.
- A source change leaves an active quiz unchanged. A correction preserves the old evaluation and explains the change.
- Formative passes never produce `demonstrated`, including after recomputation.
- Deleting a plan and creating another inherits nothing.

## Unresolved assumptions

- **Rights (your decision).** Code cannot settle this. I recommend automatic processing only for machine-readable open licenses and link-only elsewhere. I also recommend amending `specs/product.md:867` to allow labeled general practice that makes no source claim. Have counsel review processing public pages through a learner's key.
- **Job owner.** I recommend a Node orchestrator, since the live adapters and vault are there, with durable status rows.
- **`docs/quiz-sourcing-proposal.md:19` versus GEN-001.** Finishing all extraction inside one request is brittle. I recommend saving the plan first and showing practice as preparing.
- **Unmeasured:** fetch block rates, scanned-PDF rates, extraction accuracy on cheap default models, and cost per run.

## In plain language

Your plan is sound: record where each thing came from, track each question separately, and build each quiz from exact saved copies. The app isn't ready for it yet, for three reasons:

- It builds a fixed two-unit plan and can fall back to sample engineering material on unfamiliar goals.
- It can't read the pages it finds, because it only has links the AI typed.
- It can tell someone "you've demonstrated this" after one easy template question.

So stop the false claims first, then make planning work for any subject, then let it read the sources it may use. When it can't read a source or verify an answer, it should still offer a useful link or clearly labeled AI practice, and say what's missing. A question library shared between users can wait.
