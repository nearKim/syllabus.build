# Open-Source Legal Notice, BYOK Terms & Content Licensing

## 1. Open-Source Software License (`Apache-2.0`)

The application source code in this repository is **OSI-approved open-source software** licensed under the **[Apache License, Version 2.0](LICENSE)** (`SPDX-License-Identifier: Apache-2.0`).

- You may freely use, modify, self-host, and redistribute this software under the terms of the Apache License 2.0.
- Under Section 6 of the Apache License 2.0, the license does not grant permission to use the project's trade names, trademarks, or service marks except as required for reasonable and customary use in describing the origin of the work.
- Third-party Rust crates (`Cargo.toml`) and TypeScript/JavaScript packages (`package.json`) remain governed by their respective upstream open-source licenses (`MIT`, `Apache-2.0`, `BSD`, `ISC`).

## 2. Bring Your Own Key (BYOK) Custody, Billing & Provider Terms

When users configure their own third-party AI provider API keys (such as OpenAI, Anthropic, or Google Gemini):

1. **Direct Account Holder Responsibility:** You act directly as the customer and API account holder with your chosen AI provider. Your use of that provider's models is governed by the provider's own Terms of Service, Usage Policies, and API Data Privacy terms.
2. **Direct Provider Billing & Rate Limits:** All token consumption, model inference costs, and rate limits incurred through your BYOK credentials are metered and billed directly by your external AI provider to your provider account. Curriculum.io does not mark up, intermediary-bill, or insure third-party BYOK usage.
3. **Encrypted Custody & Key Deletion:**
   - When server-custody mode is used to execute background curriculum synthesis and diagnostic jobs, API keys are transmitted over TLS and sealed at rest using per-credential authenticated envelope encryption (`AES-256-GCM`) bound to your account context.
   - Raw API keys are never written to browser `localStorage`, `sessionStorage`, `IndexedDB`, URLs, or application logs.
   - Deleting a BYOK connection or deleting your account destroys this application's encrypted copy and per-credential key material, but **does not revoke the API key at your external provider**. To invalidate a key externally, revoke or rotate it in your provider's console.

## 3. Community Curricula (`CC BY 4.0`) & External Educational Resources

1. **Shared Curriculum Structures (`CC BY 4.0`):** When a learner or curator explicitly publishes a curriculum plan to the public community marketplace (`Explore`), the published structural projection (module graph, learning objectives, sequence weights, and author-written study prompts) is licensed under the **Creative Commons Attribution 4.0 International License (`CC BY 4.0`)**. Private progress history, notes, schedules, and credentials are never included in public projections.
2. **Third-Party Educational Resources (Metadata & Canonical Links Only):**
   - External books, papers, monographs, courses, and video lectures referenced by curricula are indexed strictly by **bibliographic metadata and canonical outbound links** (e.g., ISBN, DOI, publisher URL, YouTube video/playlist URL, chapter titles, and timestamps).
   - This repository and platform do not host, mirror, redistribute, or relicense copyrighted third-party textbooks, proprietary courseware, or closed assessment banks. All linked external works remain the intellectual property of their respective authors and publishers.
   - Synthetic fixtures included in `specs/` (`is_synthetic_fixture: true`) are test data for schema and contract verification only.

## 4. No Academic, Professional, or Medical Warranty

This software and any AI-generated curricula, study schedules, diagnostic questions, or proficiency estimates are provided **"AS IS"** without warranty of any kind (see Sections 7 and 8 of the [Apache License 2.0](LICENSE)). Self-directed study plans and mastery gates do not constitute accredited academic credit, institutional certification, or professional/legal/medical advice.
