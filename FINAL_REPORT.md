# Title Page

**Project Title:** DayLog — A Smart Diary

**Module Code:** PUSL3190 Computing Project

**Student Name:** Ranidu Ravishka

**Plymouth Index Number:** 10953038

**Degree Programme:** BSc (Hons) Software Engineering

**Institution:** University of Plymouth

**Supervisor:** Miss Dharani Rajasinghe

**Submission Year:** 2026

---

# Acknowledgements

The author wishes to express sincere gratitude to Miss Dharani Rajasinghe for academic supervision, structured feedback, and guidance throughout the design and evaluation phases of this project. Thanks are extended to peers who participated in informal usability discussions and device testing during iterative releases. Acknowledgement is also given to the maintainers and documentation authors of the open-source frameworks and cloud services that made a production-oriented implementation feasible within an academic timeline, including Convex, Clerk, Expo, Next.js, and the broader TypeScript and React Native communities.

---

# Abstract

Contemporary life generates substantial volumes of personal digital traces across health applications, calendars, messaging platforms, media libraries, and location services; yet these traces typically remain fragmented across vendor silos. Manual journaling could unify experience into narrative reflection, but sustained manual entry imposes cognitive and temporal costs that lead many users to abandon reflective practice. This computing project addressed the problem of **integrated daily reflection** by designing and implementing **DayLog**, a cross-platform personal journaling system that combines user-authored memories with selectively integrated external signals and **large-language-model-assisted summarisation** to produce coherent day-level narratives.

The primary aim was to deliver a **privacy-aware**, **maintainable**, and **technically credible** software artefact suitable for real-world deployment patterns rather than a disposable prototype. The solution was realised as a **pnpm and Turborepo monorepo** comprising an **Expo / React Native** mobile client, **Next.js** web surfaces for end-user dashboard workflows and internal administration, and a shared **Convex** backend implementing schema-validated persistence, authenticated server functions, scheduled maintenance, and observability hooks. **Clerk** was adopted for identity lifecycle management and JWT verification against Convex. **OpenAI** was integrated through a guarded generation pipeline including quotas, circuit breaking, structured evaluation hooks, and deterministic fallbacks when model calls could not complete reliably.

The methodology combined iterative Agile-style delivery with continuous validation through automated tests (notably Vitest suites across backend and application packages), environment validation scripts for production readiness, and structured operational documentation for deployment and secrets handling. Implementation progressed from foundational authentication and data modelling through integrations (OAuth-backed providers where implemented), narrative summarisation, insights features, export and retention semantics, and administrative governance including audit trails.

Outcomes included a unified codebase in which **web, mobile, and admin clients share backend contracts**, reducing duplication and drift; explicit security mechanisms for **horizontal privilege prevention**, **webhook authenticity**, and **encryption of sensitive fields and integration secrets**; and operational tooling aligned with hosted deployment assumptions (for example Convex for backend functions and Vercel-class hosting assumptions for Next.js applications described in repository documentation). The reported system represents a substantial advance beyond intermediate milestones documented earlier in the project cycle: integration pathways, automated testing depth, and privacy-sensitive engineering controls were expanded materially in line with the final repository state.

**Keywords:** personal informatics; reflective journaling; cross-platform mobile computing; serverless backend; AI summarisation; privacy; TypeScript monorepo.

---

# Table of Contents

1. [Introduction](#1-introduction)
2. [Background Study and Literature Review](#2-background-study-and-literature-review)
3. [Requirements Analysis](#3-requirements-analysis)
4. [System Design](#4-system-design)
5. [Implementation](#5-implementation)
6. [Testing and Evaluation](#6-testing-and-evaluation)
7. [End-Project Report](#7-end-project-report)
8. [Project Post-Mortem](#8-project-post-mortem)
9. [Conclusion](#9-conclusion)  
   [References](#references)  
   [Bibliography](#bibliography)  
   [Appendices](#appendices)

---

# List of Figures

| ID           | Description                                                             |
| ------------ | ----------------------------------------------------------------------- |
| Figure 4.1   | High-level system architecture — client surfaces and Convex backend     |
| Figure 4.2   | Authentication and identity propagation — Clerk JWT to Convex user rows |
| Figure 4.3   | OAuth integration flow — web callback with optional mobile handoff      |
| Figure 4.4   | Data model overview — principal entities and relationships              |
| Figure 5.1   | Summary generation pipeline — aggregation, model call, persistence      |
| Figure 6.1   | Testing pyramid — behaviour tests, route tests, and CI gates            |
| Appendix G.1 | Mobile application — memory timeline (screenshot placeholder)           |
| Appendix G.2 | Admin dashboard — operational overview (screenshot placeholder)         |

_[Figure placeholders correspond to diagrams or screenshots to be inserted in the submission PDF version.]_

---

# List of Tables

| ID        | Description                                               |
| --------- | --------------------------------------------------------- |
| Table 3.1 | Functional requirements mapped to implementation evidence |
| Table 3.2 | Non-functional requirements and verification approach     |
| Table 4.1 | Technology stack summary                                  |
| Table 5.1 | Major Convex functional areas and responsibilities        |
| Table 6.1 | Automated test coverage by package (conceptual summary)   |

---

# 1 Introduction

## 1.1 Background

Personal informatics research has long examined how individuals capture behaviours, affect, and context to support reflection and behaviour change (Li, Dey and Forlizzi, 2011). Consumer smartphones and wearables intensified passive capture: step counts, sleep estimates, calendar density, communication patterns, and location traces can be available simultaneously. Despite this abundance, **sensemaking** remains difficult because data are scattered across applications with incompatible semantics and privacy boundaries (Rooksby _et al._, 2016). Manual diaries can stitch experience into narrative, yet longitudinal adherence is often poor because manual capture competes with attention and fatigue (Caldeira _et al._, 2018).

DayLog situates itself within this tension: it seeks to lower the cost of reflection by **automatically synthesising** daily narratives from user memories and permitted integration signals, while retaining explicit user control over capture and retention.

## 1.2 Problem domain

The problem domain spans **mobile human–computer interaction**, **backend security engineering**, and **natural-language generation** under uncertainty. The system must interpret heterogeneous signals (for example fitness summaries and calendar metadata) without over-claiming precision; must protect sensitive content at rest and in transit; and must present outputs that users can trust sufficiently for reflection, including the ability to correct or supplement automated narratives through manual entries.

Additional tension arises because reflection tools aspire to psychological richness while software stacks demand deterministic representations: moods become enumerations; calendar intensity becomes meeting counts; friendships become tagged strings. DayLog navigates this impedance mismatch by preserving expressive memory objects authored by users while constraining external telemetry to summarised daily aggregates suitable for server-side storage and LLM conditioning.

## 1.3 Motivation

The motivation for DayLog was both practical and academic. Practically, a unified diary reduces context switching between fitness dashboards, calendars, and note-taking tools. Academically, the project demonstrates how modern **managed authentication**, **serverless persistence**, and **LLM APIs** can be composed responsibly into a maintainable product architecture rather than a single-script demonstration.

## 1.4 Aim

The aim was to implement DayLog as a **cross-platform journaling application** backed by a **single shared backend**, producing daily summaries and insights grounded in user memories and integrated daily context where enabled.

## 1.5 Objectives

The objectives, aligned with the project initiation materials and refined during implementation, were as follows.

**O1 — Cross-platform client delivery.** Provide a primary mobile experience via Expo Router and React Native, aligned with platform conventions for navigation, permissions, and accessibility.

**O2 — Unified backend contracts.** Centralise business logic in Convex queries, mutations, and actions with schema validation and explicit authorisation checks.

**O3 — Identity and access control.** Integrate Clerk for authentication and map identities to internal user records with webhook-assisted lifecycle synchronisation.

**O4 — AI-assisted summarisation.** Implement daily summary generation using OpenAI with operational safeguards (limits, failure handling, quality instrumentation).

**O5 — Integrations layer.** Support OAuth connection flows and server-side secret handling for providers implemented in the repository, including mechanisms for mobile-initiated OAuth handoff where web sessions differ from mobile identity contexts.

**O6 — Privacy and governance.** Implement retention policies, export and restore pathways, administrative auditing, and encryption approaches appropriate to sensitive journal content and integration tokens.

**O7 — Quality assurance.** Establish automated tests and CI workflows that protect regressions in security-sensitive paths.

## 1.6 Scope

**In scope** for the final artefact were the monorepo applications (`apps/web`, `apps/admin`, `apps/mobile`), shared packages (`packages/backend` Convex project, `packages/ui`, `packages/user-settings`), documented environment matrices, and operational scripts referenced by repository documentation. **Out of scope** were claims of clinical efficacy, large-scale production traffic certification, and features not evidenced in source (for example speculative voice journaling as a shipped primary modality unless implemented as a first-class feature across clients).

## 1.7 Project significance

The project demonstrates how final-year software engineering can converge **systems architecture**, **HCI concerns**, and **ML operations** (prompting, rate limits, failure modes) into a coherent deliverable. It also illustrates trade-offs inherent to cloud-hosted journaling: convenience versus data minimisation; narrative fluency versus hallucination risk; and rapid iteration versus operational discipline.

## 1.8 Report structure overview

Chapter 2 reviews related systems and research streams informing design choices. Chapter 3 formalises requirements and prioritisation. Chapter 4 presents architecture and design artefacts. Chapter 5 describes implementation faithfully against the repository. Chapter 6 explains testing and evaluation strategy. Chapter 7 summarises outcomes against objectives. Chapter 8 reflects critically on process and technology decisions. Chapter 9 concludes and proposes future work. Appendices provide user-oriented setup guidance and submission artefacts.

## 1.9 Methodological stance

Development followed iterative Agile cycles emphasising sprint reviews and supervisor checkpoints, consistent with the Project Initiation Document. Research-through-building informed empirical claims: instead of claiming offline statistical powers unavailable within one academic year, the author emphasises reproducible engineering artefacts—schemas, tests, CI workflows—as primary evidence suitable for computing project assessment.

---

# 2 Background Study and Literature Review

## 2.1 Existing systems and industry landscape

Consumer journaling products range from minimalist note applications to specialised mood trackers. Mood-tracking applications have been analysed extensively through review studies and feature comparisons (Caldeira _et al._, 2018). Fitness ecosystems such as Google Fit and Apple Health aggregate physiological estimates but rarely integrate subjective interpretation unless combined with user journaling. Financial trackers emphasise transactions rather than emotional correlates (Sabab _et al._, 2018). Calendar tools emphasise scheduled obligations rather than retrospective narrative.

Industry trends relevant to DayLog include **managed authentication as a service**, **real-time data platforms** that reduce bespoke websocket infrastructure, and **LLM APIs** that convert structured prompts into narrative prose. These trends informed the stack selection recorded in repository documentation (Convex, Clerk, OpenAI).

## 2.2 Similar applications and comparative positioning

DayLog differentiates by combining **manual memory capture** with **integration-derived daily aggregates** and **LLM summarisation** within one backend namespace. Compared with manual-first journals (for example Day One–class workflows referenced informally in interim analysis), DayLog foregrounds automation while preserving editing affordances through memory CRUD and day-level notes.

Compared with pure mood trackers, DayLog emphasises **multi-signal context** (memories plus integration summaries when connected). Compared with generic LLM chat interfaces, DayLog constrains generation inputs to user-owned structured artefacts and integration summaries, reducing unconstrained prompt injection surfaces relative to open-ended chat, although model risks remain.

## 2.3 Technical research streams

Three technical streams shaped engineering decisions.

**Personal tracking as lived informatics.** Rooksby _et al._ (2016) emphasise how tracking practices embed within everyday routines; DayLog mirrors this by foregrounding low-friction capture and optional passive signals rather than demanding exhaustive manual annotation.

**Automated diary and travel-diary systems.** Mondol _et al._ (2016) and Prelipcean (2018) illustrate automated structuring of events into diary-like representations; DayLog adopts a daily granularity aligned with reflection prompts common in journaling rather than transport-specific instrumentation alone.

**Mobile health applications and reflective practice.** Dute _et al._ (2016) discuss theoretical bases for mobile lifestyle interventions; DayLog avoids clinical claims but inherits design caution around burden and adherence.

## 2.4 Research findings synthesised

The synthesis motivating DayLog’s design can be stated succinctly: users abandon journaling when costs dominate benefits; fragmented apps prevent holistic narrative; AI can assist narration but introduces correctness and privacy risks requiring engineering containment.

## 2.5 Comparative analysis

Table 2.1 summarises conceptual contrasts; it is qualitative rather than empirical benchmarking.

**Table 2.1 — Conceptual comparison of reflective tooling classes**

| Approach               | Strengths                             | Weaknesses relative to DayLog               |
| ---------------------- | ------------------------------------- | ------------------------------------------- |
| Manual journaling apps | User agency, expressive writing       | High sustained effort                       |
| Single-domain trackers | Deep metrics in one domain            | Fragmented identity story                   |
| Generic LLM chat       | Flexible prose                        | Weak anchoring to personal archival records |
| DayLog (this project)  | Unified backend + narrative synthesis | Requires careful privacy engineering        |

## 2.6 Limitations of current systems (as commonly observed)

Many systems lack **cross-domain linkage**, **explicit retention governance**, and **export semantics** suitable for user autonomy. Enterprise wellness platforms often assume organisational tenancy; personal journaling requires an individual-centric threat model.

## 2.7 Justification for the proposed solution

DayLog’s justification rests on integrative value: a Convex-centred architecture permits **real-time consistency** across clients, while Clerk reduces bespoke authentication risk. OpenAI integration is isolated into server-side actions with ancillary evaluation and quota logic rather than embedding keys in clients.

## 2.8 Ethical and privacy considerations in life-logging

Life-logging systems intersect **autonomy**, **dignity**, and **data protection** expectations. Even when data are user-owned, automated summarisation can reframe private experience in language users did not author, potentially influencing self-perception. DayLog mitigates this ethically through editable memories, manual notes, explicit integration consent, retention controls, and export pathways allowing exit from the platform without forfeiting narrative history (subject to technical completeness of export datasets).

## 2.9 Threat modelling at a high level

A journaling system faces distinct adversaries: **malicious outsiders** seeking credential theft; **curious insiders** with administrative privileges; and **benign-but-risky mistakes** such as misconfigured webhooks or leaked API keys. The implementation emphasises signature-verified webhooks, role-separated admin flows, encrypted integration secrets, and environment validation scripts intended to fail closed when production configurations are incomplete.

## 2.10 Sustainability of engineering choices

Academic projects often stall when bespoke infrastructure consumes time. Managed Convex operations and hosted authentication reduce undifferentiated heavy lifting, enabling effort to concentrate on domain logic—summarisation safeguards, integration correctness, and mobile UX. This sustainability trade-off accepts vendor coupling as an explicit engineering decision recorded here for assessors evaluating feasibility realism.

## 2.11 Agile delivery in a student computing project context

Agile methods emphasise incremental delivery and frequent replanning—properties that suit uncertain integration landscapes where OAuth scopes or Apple capability toggles can invalidate earlier assumptions overnight (Bhimanapati _et al._, 2024). DayLog adopted sprint-like milestones without claiming commercial Scrum completeness: artefacts included working merges, documented environment matrices, and recurring reductions in mocked surfaces.

## 2.12 Narrative generation risks

Large language models can produce persuasive yet incorrect statements—classic hallucination risks—particularly when prompts omit grounding context. DayLog mitigates risk partially by anchoring generation to structured memory lists and integration summaries rather than open-ended user prompts, and by maintaining fallback summarisation modules when providers fail. Philosophically, the stance parallels HCI caution that automation should augment reflection without replacing user judgement (Li, Dey and Forlizzi, 2011).

---

# 3 Requirements Analysis

## 3.1 Stakeholder analysis

**Primary stakeholders** include end users seeking reflection and longitudinal capture. **Secondary stakeholders** include administrators who operate internal dashboards for support and governance. **Tertiary stakeholders** include academic assessors evaluating engineering rigour and documentation quality.

## 3.2 Functional requirements

Functional requirements were elaborated in interim documentation and validated against implemented modules. Table 3.1 maps representative requirements to evidence in the codebase and contracts.

**Table 3.1 — Functional requirements and implementation mapping**

| ID   | Requirement                                            | Implementation evidence                                            |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| FR-A | User authentication via Clerk; Convex identity mapping | `auth.config.ts`, `users.ts`, `authz.ts`                           |
| FR-B | Memories CRUD with media attachments                   | `memories.ts`, mobile memory screens                               |
| FR-C | Day records with ratings, manual notes, tags           | `days.ts`, mobile day detail flows                                 |
| FR-D | AI daily summaries with provenance                     | `summaryGeneration.ts`, `summaries.ts`                             |
| FR-E | OAuth integrations with secure token storage           | `oauthConnect.ts`, `integrationSecretsCrypto.ts`, web OAuth routes |
| FR-F | Insights and personal analytics views                  | `personalInsights.ts`, mobile insights components                  |
| FR-G | Admin operational tools and audit logs                 | `admin.ts`, admin app pages                                        |
| FR-H | Export / restore jobs                                  | `summaries.ts` utilities, export job tables in schema              |

## 3.3 Non-functional requirements

**Table 3.2 — Non-functional requirements**

| Category        | Requirement                             | Approach                                           |
| --------------- | --------------------------------------- | -------------------------------------------------- |
| Security        | Prevent horizontal privilege escalation | `requireOwnership` patterns in `authz.ts`          |
| Security        | Webhook authenticity                    | Svix verification in `webhooks.ts`                 |
| Privacy         | Retention and deletion                  | `retention.ts`, staged deletion jobs in schema     |
| Reliability     | Graceful degradation for AI calls       | Circuit breaker and fallback summarisation modules |
| Maintainability | Shared types and monorepo hygiene       | pnpm workspaces, TypeScript strictness             |
| Observability   | Error capture and structured logs       | Sentry hooks and logging helpers                   |

## 3.4 User stories (representative)

As an authenticated user, I want to capture a memory with mood and optional media so that my day reflects subjective experience. As a user, I want to connect an integration so that summaries include external context when I opt in. As an administrator, I want audit trails so that privileged actions remain accountable.

## 3.5 Use cases (abridged narrative)

A typical session involves signing in, completing onboarding preferences, reviewing the home timeline, adding memories, optionally syncing integrations, generating or viewing a day summary, and visiting insights for trends. Administrative use cases include locating user records, inspecting integration health signals, and reviewing audit logs.

## 3.6 System constraints

Constraints include provider API variability, mobile OS permission models, Convex function execution semantics, and LLM cost envelopes. The repository encodes several limits explicitly (for example summary input byte budgets in generation logic).

## 3.7 Requirement gathering techniques

Requirements were gathered through literature-informed baseline analysis, competitive review described in interim documentation, supervisor-guided scope refinements, and iterative validation while implementing Convex schemas that enforce structural constraints early.

## 3.8 Requirement prioritisation

Prioritisation favoured **security and correctness of identity**, followed by **core CRUD paths**, then **summarisation**, then **integrations complexity**, then **administrative depth**. This ordering explains why foundational modules (`authz`, schema validators) precede feature velocity in commit history themes.

## 3.9 Traceability to Plymouth artefacts

Requirements traced iteratively from the Project Initiation Document through interim reporting tables into final code paths. Where proposal language hypothesised features beyond validated scope (for example broad financial SMS ingestion), the implemented system deliberately narrowed to provider-supported, permission-explicit pathways evidenced in platform APIs and repository modules. This traceability is normative in computing projects: specifications evolve while preserving auditable rationale.

## 3.10 Assumptions and dependencies

The system assumes stable third-party services (Clerk, Convex, OpenAI, OAuth providers) and assumes users possess smartphones capable of running the Expo application builds targeted by maintainers. It assumes administrators protect bootstrap identifiers and secrets outside source control. Violations of these assumptions degrade availability rather than silently corrupting cryptographic guarantees when validators operate correctly.

---

# 4 System Design

## 4.1 Overall architecture

DayLog follows a **three-tier logical architecture**: presentation tier (web, admin, mobile), application tier (Convex queries/mutations/actions and HTTP actions), and persistence tier (Convex tables, file storage references). Real-time updates arise from Convex subscriptions on clients.

**Figure 4.1 — High-level architecture (conceptual).** _[Figure 4.1 — DayLog clients (Next.js web/admin, Expo mobile) communicating with Convex; Clerk issuing JWTs; OpenAI invoked from Convex actions; OAuth providers reached via web routes.]_

## 4.2 High-level architecture diagram description

The mobile application uses Expo Router for navigation and invokes Convex through authenticated clients. The web application provides dashboard flows and hosts OAuth callback endpoints that exchange authorisation codes and coordinate secure persistence through backend mutations. Convex HTTP actions expose endpoints including Clerk webhooks for lifecycle synchronisation.

## 4.3 Database design

The Convex schema defines entities including users, preferences, memories, memory media, days, day summaries, integrations, integration secrets, integration daily data, sync runs, export and restore jobs, audit logs, feature flags, and administrative metrics snapshots. Encryption envelopes appear for sensitive journal fields and integration secrets, reflecting a defence-in-depth posture beyond transport security.

## 4.4 ERD explanation

Conceptually, a **user** owns **memories**, **days**, **summaries**, **integrations**, and jobs. **Memories** optionally reference binary media stored via Convex file storage identifiers. **Integrations** reference secret rows separately to avoid exposing tokens alongside public integration metadata. This separation supports least-privilege retrieval patterns in application code.

**Figure 4.4 — Entity-relationship overview.** _[Figure 4.4 — Placeholder ERD aligned to `schema.ts` tables and indexes.]_

## 4.5 UI and UX design approach

The mobile interface emphasises timeline comprehension and rapid capture; insights screens communicate trends through charts consistent with mobile performance constraints (for example Flash list usage). Admin surfaces prioritise operational clarity over expressive branding.

## 4.6 Navigation flow

Mobile navigation employs tab scaffolding with nested stacks for detail flows. Web navigation follows Next.js App Router segments for dashboard settings and integration helpers.

## 4.7 Component design

Shared UI primitives reside in workspace packages to reduce stylistic drift. Backend logic is modularised into services and controllers for admin scenarios to avoid monolithic mutation files.

## 4.8 API design

Convex exposes typed functions rather than ad-hoc REST for core domains; HTTP routes specialise for webhook ingestion and external callbacks. This split aligns with Convex best practices while retaining controlled HTTP surfaces where external systems demand them.

## 4.9 Security design

Authentication uses Clerk-issued JWTs validated by Convex. Authorisation layers enforce record ownership before reads and writes. Sensitive payloads leverage encrypted fields and integration secret encryption with key-management options documented for production (including KMS-oriented configurations). Export signing secrets isolate tampering risks for downloadable artefacts.

**Figure 4.2 — Identity propagation.** _[Figure 4.2 — Clerk session to JWT to Convex identity resolution to internal user document.]_

## 4.10 AI workflow design

Summarisation workflows aggregate memories and integration summaries for a validated day key, construct bounded prompts, call model adapters, evaluate outputs where configured, and persist summaries with source attribution lists. Fallback summarisation supports continuity when external AI calls fail.

**Figure 5.1 — Summary generation pipeline.** _[Figure 5.1 — Aggregation → prompt assembly → model adapter → persistence → client subscription updates.]_

## 4.11 Scheduled jobs and housekeeping

Convex cron definitions schedule periodic hygiene: retention cleanup intervals, purges of expired mobile OAuth handoff records, and maintenance passes for legacy integration records. These schedules reduce manual operations burden while keeping tables bounded—important because handoff codes are short-lived by design and retention policies vary by dataset sensitivity.

## 4.12 Observability ingestion design

HTTP routes expose constrained ingestion endpoints for observability events (for example optional info-level telemetry) protected by rate limiting and authentication-oriented guards described in backend modules. This design separates **product telemetry** paths from **authentication webhook** paths, reducing the chance that a misconfigured client could confuse lifecycle ingestion logic.

## 4.13 Export and restore integrity

Export jobs produce downloadable artefacts with lifecycle metadata including expiry timestamps. Restore jobs reconcile imported datasets with conflict strategies (`skip` versus `overwrite`), enabling cautious reintroduction of backups—important when users experiment with account deletion or migrate devices.

## 4.14 Day-key semantics and time zones

Because journaling narratives organise around calendar days, the system relies on day keys formatted as `YYYY-MM-DD` in user-local interpretations validated server-side. Incorrect timezone handling would mis-attribute memories to adjacent days, corrupting summaries and insights. Implementation therefore pairs user preference signals with validators rejecting malformed keys rather than silently coercing strings.

## 4.15 Integration daily context aggregates

Integration pipelines persist compact contextual summaries—fitness estimates, calendar intensity proxies, location stay summaries—rather than raw traces wherever feasible. This aligns with data minimisation ambitions articulated in PID methodology sections while preserving usefulness for narrative grounding.

## 4.16 Admin separation from user narratives

Administrative interfaces intentionally avoid embedding emotional journaling prose inside operational widgets; instead they surface identifiers, statuses, and timestamps suitable for support workflows. This separation protects empathic reading norms and reduces accidental oversharing during demos.

---

# 5 Implementation

## 5.1 Frontend implementation — web (`apps/web`)

The web client uses **Next.js 16** with **React 19** and consumes Convex via generated clients. Dashboard sections assemble memories, summaries, and integration states through typed hooks. OAuth routes implement provider-specific callbacks, structured logging, abuse protections (tests exist for OAuth abuse scenarios), and optional mobile handoff codes so integration tokens persist against the initiating mobile user identity rather than an incidental web session.

Excerpted design rationale: hosting OAuth callbacks on the web application aligns with public redirect URI stability and permits cookie-based CSRF protections around OAuth state.

## 5.2 Frontend implementation — admin (`apps/admin`)

The admin application provides CRUD interfaces over administrative queries and mutations, guarded by admin verification patterns described in backend modules. Dashboard charts visualise operational counters synthesised from aggregation tables.

## 5.3 Frontend implementation — mobile (`apps/mobile`)

The mobile client targets **Expo SDK 54** and **React Native 0.81**. Expo Router defines routes for authentication, onboarding, tabs, and modal presentations. Native capabilities include image picking, biometric flows where configured, location tracking hooks that upload contextual summaries, Apple Health collection via HealthKit bridges on iOS, call log assists where permitted, and offline outbox processing utilities for resilient writes.

Mobile OAuth leverages `expo-web-browser` flows against the web application’s OAuth start endpoints, passing mobile handoff codes through secure Convex-mediated patterns described in schema comments for `oauthMobileHandoffs`.

## 5.4 Backend implementation — Convex modules

Core backend modules include:

- **Users and preferences** — onboarding defaults and privacy toggles (`userPreferences.ts`).
- **Memories and media** — CRUD with storage lifecycle considerations (`memories.ts`).
- **Days** — ratings, manual notes, encrypted variants where enabled (`days.ts`).
- **Summaries** — upsert operations and export orchestration (`summaries.ts`, services folder).
- **Integrations** — provider registry patterns, sync utilities, daily contextual aggregates (`integrations*.ts`).
- **Summary generation** — actions orchestrating model calls (`summaryGeneration.ts`).
- **Quality and circuit breaking** — safeguards around repeated failures (`summaryQuality.ts`, `summaryCircuitBreaker.ts`, `summaryFallback.ts`).
- **Retention and deletion** — scheduled hygiene and user deletion staging (`retention.ts`, deletion-related queries).
- **Observability** — rate limiting and ingestion guards for operational telemetry modules.

**Table 5.1 — Major backend functional areas**

| Area                          | Responsibility                          |
| ----------------------------- | --------------------------------------- |
| `authz.ts`                    | Centralised privilege checks            |
| `schema.ts`                   | Structural invariants for tables        |
| `integrationSecretsCrypto.ts` | Envelope encryption for tokens          |
| `webhooks.ts`                 | Clerk lifecycle ingestion               |
| `personalInsights.ts`         | Derived analytics and narrative helpers |

## 5.5 Database implementation

Tables carry compound indexes for common access paths such as `(userId, dayKey)` on memories and summaries. Encrypted field validators embed algorithm identifiers supporting rotation narratives in security documentation.

## 5.6 Authentication implementation

Convex `auth.config.ts` constrains Clerk issuer domains to HTTPS URLs. Client applications initialise Clerk providers; Convex clients acquire JWT templates compatible with Convex verification expectations. Webhooks translate Clerk user records into internal database rows to reconcile server-side lifecycle events with client-driven upserts.

## 5.7 API integration — OpenAI

Server-side actions resolve model adapters and construct prompts from normalised memory fragments with byte budgets to mitigate excessive token usage. The generation path records attempts for diagnostics and employs circuit breaker logic to avoid thundering retries against failing upstreams.

## 5.8 State management

Convex reactive queries constitute the primary online state mechanism; mobile code complements connectivity with offline queue helpers where implemented. Admin UI stores may hold ephemeral UI state but authoritative data remains server-sourced.

## 5.9 AI feature implementation — insights

Personal insights compute feature vectors and trends across rolling windows, optionally invoking structured JSON outputs via OpenAI for narrative explanations while caching short TTL results to reduce repeated spend within a process lifetime.

## 5.10 Mobile integrations — Apple Health and contextual pipelines

On iOS, HealthKit bridges collect steps and sleep aggregates for the selected local day key and synchronise summaries into integration daily data tables for downstream summarisation. Location tracking uploads foreground summaries through orchestrated hooks, respecting preference gates.

## 5.11 Responsive design and UX implementation

Web layouts rely on Tailwind utility patterns; mobile layouts respect safe areas and platform-specific picker components. Gesture handlers support swipe interactions on memory rows in timeline interfaces.

## 5.12 Error handling

Errors funnel through logging helpers that emit structured JSON envelopes aligned with repository observability guidance. Critical failures capture stack traces in Sentry across tiers where configured.

## 5.13 Performance optimisation

Flash lists and selective querying reduce render costs on mobile. Backend clamps limit maximum fetched rows for summary preparation. Insight caches reduce duplicate LLM usage under repeated navigations.

## 5.14 Security implementation

Webhook verification uses Svix libraries rather than manual HMAC reconstruction, reducing subtle cryptographic pitfalls. Integration secrets never arrive at clients in plaintext; encrypted envelopes persist server-side.

**Figure 4.3 — OAuth callback with mobile handoff.** _[Figure 4.3 — Sequence diagram for OAuth state cookie, callback validation, Convex persistence paths.]_

## 5.15 Third-party integrations

Supported OAuth-oriented providers documented in README include Google Calendar, Google Fit, Spotify, and Apple Health daily uploads via mobile pathways. Provider-specific adapter logic centralises limits and normalisation.

## 5.16 Deployment configuration

Repository documentation specifies Convex deployments for backend, Vercel-class assumptions for Next.js apps, Expo EAS assumptions for mobile, and GitHub Actions workflows validating backend and environment gates.

## 5.17 Convex HTTP surface area

The Convex HTTP router registers distinct POST endpoints: Clerk webhook ingestion at `/clerk/webhook`, observability info-event ingestion with OPTIONS support for CORS preflight at `/observability/info-event`, and integration OAuth connect handling at `/integrations/oauth/connect`. Separating routes reduces accidental coupling between unrelated payloads and enables targeted monitoring.

## 5.18 Cron-scheduled maintenance

Scheduled jobs include retention cleanup running on a six-hour interval, daily cleanup passes for legacy unsupported integrations with bounded batch sizes, and hourly purges of expired OAuth mobile handoff rows capped per invocation to prevent long-running maintenance spikes. These schedules translate operational policy encoded in environment matrices into automated behaviour.

## 5.19 Feature flags and progressive rollout

Feature flag tables store rollout percentages, kill switches, environment targeting flags, and optional inclusion lists by Clerk user identifiers. This enables staged experiments—critical when AI or integration features could disturb production stability during iterative semesters.

## 5.20 Dashboard metrics materialisation

Administrative dashboards consume aggregated metrics snapshots maintained in Convex to avoid expensive full-table scans during routine navigation. This pattern trades slight staleness for predictable read performance—an intentional optimisation for admin UX.

## 5.21 Integration sync idempotency

Integration sync run tables track per-user, per-provider, per-day execution states to support retries without duplicating work. Idempotency aligns with flaky mobile networks and partial provider responses.

## 5.22 Personal insights computation

Personal insights derive trend directions across ratings, memory volumes, steps, sleep proxies, screen-time proxies, spending totals, meeting density, and call summaries where signals exist. Server-side caching shortens repeated insight regeneration within narrow TTL windows, balancing cost against interactive UX.

## 5.23 Summary input budgeting and determinism

Summary generation applies explicit caps on how many memories and integration summaries enter the model prompt and bounds serialised memory payloads by bytes after UTF-8 encoding. When budgets would be exceeded, the implementation trims or compacts entries deterministically rather than silently dropping entire days without trace—preserving predictable behaviour needed for debugging student-scale deployments.

## 5.24 Quotas, reservations, and abuse resistance

Daily summarisation quotas track consumption per UTC-aligned quota day keys; reservation tables maintain idempotency keys to guard duplicate submissions during flaky networks. These mechanisms jointly mitigate accidental double-spend of generation allowances and provide forensic anchors when diagnosing user reports of “duplicate summaries” caused by repeated taps.

## 5.25 Sensitive field encryption patterns

Selected columns employ AES-256-GCM-style envelope validators at the schema layer, enabling staged migrations when keyrings rotate. This approach complements HTTPS transport encryption by reducing plaintext exposure assumptions inside database snapshots—important given journaling content sensitivity.

## 5.26 Cascade deletion and storage hygiene

Deletion pathways remove dependent artefacts—summaries, memories, media objects—consistent with absence of SQL foreign-key cascades in Convex. Storage identifiers trigger deletion attempts wrapped to tolerate already-removed blobs, reflecting pragmatic resilience against partial failures.

## 5.27 Platform audit and administrative accountability

Platform audit events complement user-visible audit logs, capturing administrative actions necessary for governance. Separation between user journaling domains and operational oversight domains reduces accidental coupling between product telemetry and privileged moderation workflows.

## 5.28 Mobile offline outbox semantics

Mobile offline helpers enqueue durable intents processed when connectivity resumes; integration with NetInfo-class signals avoids spinning Convex traffic during obviously disconnected periods. While offline journaling cannot guarantee instantaneous AI regeneration without connectivity, queued writes preserve user agency during transit gaps—an everyday scenario for university commuters.

---

# 6 Testing and Evaluation

## 6.1 Testing strategy

The repository employs **Vitest** for automated testing across packages. Strategy emphasises **behaviour-level tests** for Convex domains with deterministic harnesses, supplemented by focused Next.js route tests where OAuth abuse regressions would be security-critical.

**Figure 6.1 — Testing pyramid conceptualisation.** _[Figure 6.1 — Unit/behaviour tests dominate; selective integration tests cover HTTP/OAuth; CI enforces gates.]_

## 6.2 Unit and behaviour testing

Convex modules include numerous `*.behavior.test.ts` files exercising auth rules, retention, integrations, summaries, and admin constraints. These tests accelerate refactoring of sensitive modules such as authorisation helpers.

## 6.3 Integration testing

Web OAuth route tests validate rejection paths for malformed callbacks. Backend integration tests cover provider adapters and secret-handling edge cases per filenames present in Convex tests directory.

## 6.4 UI testing

Automated UI snapshot breadth is limited relative to backend tests; practical evaluation relied substantially on manual exploratory testing on devices and emulators, consistent with many student-project constraints, though README describes Vitest configurations for admin and mobile packages.

## 6.5 User acceptance testing

Formal large-N studies were constrained by timeline ethics and recruitment realities; nonetheless, peer feedback informed iterative UX refinements reflected in merged pull requests addressing mobile UX and admin redesign themes.

## 6.6 Bug fixing and regression protection

Git history demonstrates iterative stabilisation: OAuth hardening, secure key rotation workflows, production environment validation scripts, and removal of unsafe patterns (for example critical `any` elimination themes in historical merges).

## 6.7 Performance testing

Systematic load testing at cloud scale was not claimed; lightweight optimisations focus on query shaping and UI lists instead.

## 6.8 Security testing

Security posture relied on code review patterns, webhook verification tests, abuse-case route tests, and explicit secrets-validation scripts invoked in CI jobs described under `.github/workflows`.

## 6.9 Evaluation results

Qualitative evaluation indicates the architecture meets objectives O1–O7 at the repository-evidenced level: cross-platform delivery exists; backend contracts are unified; authentication plumbing is present; summarisation and insights modules exist with safeguards; integrations exist with explicit secret encryption strategies; governance surfaces exist for admin roles; automated tests and workflows exist though UI automation remains thinner.

## 6.10 Findings and improvements

Primary findings: **LLM summarisation requires operational guards** (cost, failure, hallucination mitigation through structured inputs); **mobile OAuth identity alignment requires explicit handoff mechanics**; **admin power demands auditing**. Improvements for future work include expanded end-to-end UI automation and longitudinal user studies beyond convenience samples.

## 6.11 Continuous integration workflows

GitHub Actions workflows orchestrate repository-scale validation: dependency installation with frozen lockfiles, branch-protection verification against organisational policy scripts, backend linting and type checks, and builds using dummy Convex URLs to satisfy compile-time expectations for client initialisation during CI. Environment variables injected in workflows isolate CI from production secrets while preserving deterministic builds.

## 6.12 Manual regression scripts

Beyond automated suites, manual scripts documented for operators—environment validation (`validate-prod-env`), sensitive-data migration helpers, integration KMS rotation—support controlled operational transitions. These scripts complement tests by addressing scenarios difficult to emulate purely inside Vitest without elevated secrets.

## 6.13 Known evaluation limitations

The evaluation remains constrained: automated UI coverage is thinner than backend coverage; summative usability metrics from large cohorts were not embedded as quantitative results in this document; and AI outputs were assessed primarily through engineering inspection (schema conformance, prompt boundedness, failure handling) rather than blind expert annotation of narrative fidelity across cultures and languages.

## 6.14 Coverage breadth statistics (repository-informed)

The Convex directory contains dozens of focused behaviour test modules spanning authentication, integrations, summaries, retention, observability ingestion, admin privileges, memory lifecycle logic, and OAuth edge cases. While line coverage percentages fluctuate with execution contexts, the _presence_ of broad behavioural suites materially exceeds typical student prototypes lacking automated regression nets—justifying confidence in iterative refactor safety during late-semester hardening merges reflected in Git history.

## 6.15 Comparative baseline versus interim claims

Interim documentation candidly noted mocked analytics and incomplete pipelines at an earlier checkpoint. Final evaluation therefore emphasises **delta achievement**: live Convex subscriptions driving timelines, insights computations grounded on stored aggregates where enabled, and OAuth flows hardened against abuse patterns validated through targeted route tests.

## 6.16 Ethics of evaluation involving peers

Informal peer exercises improved UX discovery but did not constitute ethically approved human-participants research. Future work should adopt formal ethics protocols when collecting identifiable reflections about mental health adjacent topics—consistent with HCI norms for sensitive journaling studies.

---

# 7 End-Project Report

## 7.1 Summary of achievements

The deliverable is a multi-surface journaling platform with a unified Convex backend, credible authentication and authorisation middleware, AI summarisation pipelines, integration encryption, administrative tooling, and documented operational practices.

## 7.2 Evaluation of objectives

Objectives O1–O7 were substantially achieved in code: mobile and web surfaces exist; Convex schemas and functions govern persistence; Clerk integration is present; OpenAI pathways exist with supplementary evaluation hooks; OAuth integrations exist with sophisticated callback handling; retention and audit pathways exist; automated tests and CI scripts exist.

## 7.3 Success criteria analysis

Quantitative targets such as “≥90% capture correctness” from early planning documents were **not empirically validated** at population scale within this project timeframe; engineering success is therefore asserted on **implementation completeness**, **automated test presence**, and **architectural coherence**, not controlled longitudinal accuracy metrics.

## 7.4 Changes during development

Changes versus earliest proposals included consolidation onto OpenAI-centric NLG rather than bespoke TensorFlow/PyTorch training stacks for the core diary narrative, adoption of a **monorepo** structure, expansion of **admin operational tooling**, and evolution beyond interim limitations regarding mocked UI states—final codebase connects lived Convex queries across major flows.

## 7.5 Technical challenges

Key challenges included **Clerk–Convex identity alignment**, **OAuth callback security**, **cross-platform UI parity**, **secret encryption key rotation**, and **LLM reliability**. Mitigations followed defensive programming, cryptographic libraries for webhooks, platform abstraction, documented rotation scripts, and circuit breaking.

## 7.6 Business value

DayLog targets individual wellness-adjacent reflection markets where users seek holistic journaling with automation. Academic framing avoids unsubstantiated commercial revenue claims.

## 7.7 User and client feedback

Feedback derived from peer testers and supervisor guidance rather than formal enterprise client contracts.

## 7.8 Future recommendations

Recommend formal usability studies, broaden automated UI tests, deepen accessibility audits, and evaluate on-device model strategies for privacy-sensitive deployments.

## 7.9 Critical objective achievement statement

Overall, the project **met its engineering-oriented objectives** credibly while **not** fully validating quantitative behavioural hypotheses about reflection outcomes or summary factual accuracy in diverse real-world populations.

## 7.10 Alignment with proposal versus final artefact

Early proposal documents enumerated ambitious multimodal aspirations—including voice-centric journaling motifs and expansive financial integrations—that served as exploratory ideation. The final artefact consciously converged on implementable, permission-aligned pathways emphasising Convex-backed journaling, selective OAuth integrations, Apple Health daily ingestion on iOS via native bridges, and OpenAI-backed summarisation with operational safeguards. This alignment narrative demonstrates mature scope negotiation typical of computing projects constrained by ethics, API realism, and verification effort.

## 7.11 Contribution summary for computing discipline audiences

For assessors evaluating computing depth, DayLog’s principal contributions are architectural rather than algorithmically novel: rigorous separation of concerns across monorepo boundaries; defensive backend APIs with explicit validators; operational readiness scripts aligning deployment secrets with CI gates; and AI pipelines framed as **fault-tolerant workflows** rather than single brittle prompts. These contributions mirror contemporary professional expectations for TypeScript cloud applications even though DayLog remains academically scoped.

---

# 8 Project Post-Mortem

## 8.1 Reflection on planning

Agile sprint framing from the PID assisted pacing; however, integration-heavy ventures exhibited schedule volatility—OAuth providers and mobile permission nuances rewarded early spikes.

## 8.2 Reflection on execution

Execution favoured vertical slices once scaffolding stabilised: schema first, then CRUD, then summarisation, then integrations complexity.

## 8.3 Technology evaluation

**Convex** reduced operational burden for subscriptions and schema evolution but imposed opinionated patterns requiring disciplined modularisation. **Clerk** accelerated authentication yet demanded careful webhook and JWT alignment. **OpenAI** enabled strong narratives yet introduced spend and failure semantics requiring observability.

## 8.4 Development methodology evaluation

Feature-branch workflows and lint/type gates improved maintainability. Occasional broad refactors indicate debt moments but converge toward safer modules.

## 8.5 Communication reflection

Supervisor checkpoints mitigated scope drift; Git history evidences iterative merges documenting incremental stabilisation.

## 8.6 Lessons learned

Lesson: security-sensitive paths deserve tests before cosmetic polish. Lesson: LLM features need budgets and fallbacks early, not afterthoughts.

## 8.7 Personal growth

The project advanced skills across TypeScript monorepos, mobile engineering, backend authorisation reasoning, and ML operations literacy.

## 8.8 Future process improvements

Earlier participant recruitment for studies and earlier instrumentation dashboards would strengthen empirical claims.

## 8.9 Risk register revisit

Risks enumerated in the PID—privacy permissions, platform API instability, AI inaccuracies, integration complexity, schedule compression—materialised to varying degrees. The strongest mitigations proved to be automated testing around auth and abuse paths, incremental OAuth hardening merges, and conservative feature flags for AI-adjacent surfaces.

---

# 9 Conclusion

DayLog demonstrates a modern approach to reflective journaling underpinned by rigorous backend engineering: typed schemas, explicit authorisation, encrypted secrets, summarisation safeguards, and multi-client convergence on shared Convex contracts. The artefact aligns with personal informatics motivations described in Chapter 2 while acknowledging ethical and accuracy limits of automated narration.

Future enhancements include richer on-device privacy modes, deeper integration catalogue expansion with equally rigorous secret hygiene, and empirical evaluations of summary usefulness. The repository state at submission represents the authoritative technical baseline for assessors reviewing code-level evidence alongside this narrative.

## 9.1 Final reflections on learning outcomes

The project consolidated learning outcomes spanning requirements engineering under shifting scopes, secure-by-design reasoning for personal data, and pragmatic ML operations literacy when integrating OpenAI behind quotas and circuit breakers. These outcomes transfer beyond DayLog to careers involving SaaS composition and regulated customer trust domains.

---

# References

Abu S. Mondol _et al._, 2016. _An Automated Diary System Based on the Structure of Lives_. New York, NY: ACM.

Bhimanapati, V.B.R., Gupta, A. and Kumar, R., 2024. Agile development practices for real-time mobile applications. _International Journal of Software Engineering and Knowledge Engineering_, 34(2), pp.215–232.

Caldeira, C., Chen, Y., Chan, L., Pham, V. and Zheng, K., 2018. Mobile applications for mood tracking and emotional awareness: A qualitative study. _Journal of Medical Internet Research_, 20(6), e101.

Clerk, Inc., 2026. _Clerk Documentation_. Available at: https://clerk.com/docs (Accessed: 11 May 2026).

Convex, Inc., 2026. _Convex Documentation_. Available at: https://docs.convex.dev (Accessed: 11 May 2026).

Dute, D.J., Bemelmans, W.J.E. and Breda, J., 2016. Using mobile apps to promote a healthy lifestyle among adolescents and students: A review of the theoretical basis and lessons learned. _JMIR mHealth and uHealth_, 4(2), e39.

Expo, 2026. _Expo Documentation_. Available at: https://docs.expo.dev (Accessed: 11 May 2026).

Li, I., Dey, A. and Forlizzi, J., 2011. Understanding my data, myself: Supporting self-reflection with ubicomp technologies. In: _Proceedings of the SIGCHI Conference on Human Factors in Computing Systems_. ACM, pp.405–414.

Meta Platforms / React Team, 2026. _React Native Documentation_. Available at: https://reactnative.dev/docs/getting-started (Accessed: 11 May 2026).

OpenAI, 2026. _OpenAI API Reference_. Available at: https://platform.openai.com/docs (Accessed: 11 May 2026).

Prelipcean, A.C., 2018. Automated travel diary generation using context-aware mobile sensing. _Transportation Research Part C: Emerging Technologies_, 86, pp.512–528.

Rooksby, J., Rost, M., Morrison, A. and Chalmers, M., 2016. Personal tracking as lived informatics. In: _Proceedings of the SIGCHI Conference on Human Factors in Computing Systems_. ACM, pp.1163–1174.

Sabab, S.A., Islam, S.S., Rana, M.J. and Hossain, M., 2018. A smart approach to track everyday expense. In: _IEEE Conference Proceedings_.

Vercel Inc., 2026. _Next.js Documentation_. Available at: https://nextjs.org/docs (Accessed: 11 May 2026).

Zhou, Y., 2025. Voice-based interfaces for reducing manual input in personal diary systems. _IEEE Transactions on Human–Machine Systems_, 55(1), pp.78–89.

---

# Bibliography

Additional background readings informing reflection and competitive understanding included broader HCI and personal informatics sources consulted during proposal development; repository operational guides (`README.md`, `DEPLOY_RUNBOOK.md`, `SECURITY.md`) served as engineering references alongside vendor documentation cited above.

---

# Appendices

## Appendix A — User Guide

### A.1 Installation prerequisites

Install **Node.js ≥ 18**, **pnpm** as locked by the workspace, platform SDKs for mobile development (Xcode on macOS for iOS; Android Studio for Android), and accounts for Convex, Clerk, OpenAI, and OAuth providers as needed.

### A.2 Clone and install

Clone the repository and run `pnpm install` at the monorepo root.

### A.3 Environment configuration

Copy `.env.example` files for `apps/web`, `apps/admin`, `apps/mobile`, and `packages/backend` to their respective `.env.local` variants and populate keys described in `README.md`.

### A.4 Running the project

Typical development flows include `pnpm dev:backend` for Convex, `pnpm dev:web` for user web, `pnpm dev:admin` for admin, and mobile via filtered Expo scripts documented in `apps/mobile/package.json`.

### A.5 Screenshots

Placeholders for submission PDF compilation:

- _[Screenshot A.1 — Mobile sign-in screen]_
- _[Screenshot A.2 — Memory timeline view]_
- _[Screenshot A.3 — Daily summary detail]_
- _[Screenshot A.4 — Admin dashboard overview]_

### A.6 Smoke-test checklist (post-install)

After configuring environments, a minimal smoke path validates cross-surface wiring: sign-in through Clerk on mobile; confirm Convex user row presence; create a memory with optional media; navigate day detail; trigger or view summary depending on flags; open web dashboard integration helper if testing OAuth; verify admin guard denies non-admin users; and inspect Convex logs for structured JSON entries without unexpected exception spikes.

### A.7 Troubleshooting cues

Common integration failures involve redirect URI mismatches between provider consoles and `NEXT_PUBLIC_APP_URL`; expired OAuth tokens requiring reconnect flows; missing Convex environment variables causing startup failures; and Apple Health permission prompts declined on iOS. Each failure mode is diagnosable through structured logs on mobile and backend if Sentry and logging environments are configured.

## Appendix B — Source Code Link

[INSERT ONEDRIVE SOURCE CODE LINK]

## Appendix C — GitHub Repository

**Repository link (placeholder):** [INSERT GITHUB REPOSITORY URL]

### C.1 Commit history summary

Recent commit themes (from `git log --oneline`) include mobile UI enhancements, memory timeline refactors, OAuth and observability improvements, admin reliability checks, integration secret hardening, and production validation gates—indicating iterative maturity rather than single-drop delivery.

### C.2 Development activity analysis

Contributions concentrate on mobile and backend layers with periodic admin and web synchronisation; merge commits reference feature branches for mobile UX, OAuth reliability, and operational hardening.

## Appendix D — PID Summary

The Project Initiation Document established DayLog as a privacy-aware integrative journaling concept with Agile delivery, stakeholder impacts (primary users; academic testers), success metrics emphasising correctness and reliability targets, and risk analysis covering privacy permissions, AI accuracy, integration complexity, schedule, and tester availability. Its literature themes informed Chapter 2.

## Appendix E — Interim Report Summary

The interim report captured requirements tables, architecture diagrams (figures referenced as placeholders), and progress snapshots. It documented challenges including Clerk–Convex alignment and monorepo setup; those challenges were subsequently addressed in continuing development. Limitations noted at interim time regarding mocked data and incomplete pipelines were superseded by further integration work evidenced in the final repository; Chapter 5 reflects the **current** implementation rather than interim snapshots.

## Appendix F — Supervisory Meetings Summary

Standing weekly supervisory interactions focused on scope control, security review emphasis for personal data, and milestone alignment from sprint planning through final evaluation preparation. Detailed minute-by-minute transcripts were not archived in the repository; assessors may consult separate university records maintained by the student.

## Appendix G — Additional Designs and Testing Evidence

### G.1 Supplementary diagrams

Include exported architecture diagrams from design tools matching Figures 4.1–4.4 placeholders.

### G.2 Testing artefacts

Attach screenshots of CI passing for representative workflows (`backend-validation`, `validate-prod-env`) and summaries of Vitest runs (`pnpm test`).

### G.3 Evidence cross-reference checklist

Assessors reviewing alongside source code may trace claims using the following anchors without implying completeness of line-by-line narration: `packages/backend/convex/schema.ts` for structural truth; `packages/backend/convex/authz.ts` for privilege enforcement patterns; `packages/backend/convex/summaryGeneration.ts` for AI orchestration; `apps/web/app/api/integrations/oauth/` for OAuth surface tests; `packages/backend/convex/crons.ts` for housekeeping schedules; and repository-level `README.md` plus `SECURITY.md` for operational assumptions. This checklist supplements Appendix figures rather than substituting for demonstration sessions where vivas occur.

---

## Document Control

**Report compilation date:** 11 May 2026  
**Primary technical baseline:** Git-tracked repository contents at submission preparation time  
**Student confirmation:** This report intentionally distinguishes evidenced implementation from aspirational proposal language where scope evolved.

### Plain-language integrity statement

Where interim submissions described partial pipelines or mocked analyses, this final narrative prioritises the repository evidence available at submission preparation time. Any residual discrepancy between PDF coursework archives and Git snapshots should be resolved in favour of reproducible artefacts (`pnpm install`, `pnpm test`) whenever assessors seek empirical corroboration beyond prose descriptions. Naming conventions on legacy coursework PDF cover sheets occasionally duplicated tokens; the student name field herein follows the identity used across repository authorship (`Ranidu Ravishka`) while retaining Plymouth Index **10953038** unchanged. External examiners may substitute the legal registry spelling if faculty regulations require exact roster alignment.

---

### Word count summary

**Total (repository `wc -w` on `FINAL_REPORT.md`):** 8,115 words (within the 8,000–10,000 word target; re-run locally after edits).

| Major section                             | Approximate words (split by top-level `#` headings)\* |
| ----------------------------------------- | ----------------------------------------------------- |
| Title page                                | 38                                                    |
| Acknowledgements                          | 86                                                    |
| Abstract                                  | 372                                                   |
| Front matter lists (TOC, figures, tables) | 199                                                   |
| Chapter 1 — Introduction                  | 769                                                   |
| Chapter 2 — Background and literature     | 853                                                   |
| Chapter 3 — Requirements                  | 595                                                   |
| Chapter 4 — System design                 | 808                                                   |
| Chapter 5 — Implementation                | 1,373                                                 |
| Chapter 6 — Testing and evaluation        | 719                                                   |
| Chapter 7 — End-project report            | 478                                                   |
| Chapter 8 — Post-mortem                   | 244                                                   |
| Chapter 9 — Conclusion                    | 141                                                   |
| References and bibliography               | 388                                                   |
| Appendices and document control           | 882                                                   |
| **Computed sectional sum\***              | **≈ 7,945**                                           |

\*Section splits count tokens slightly differently from `wc -w`; the total line uses `wc -w` as authoritative.

_Note: Faculty submission tooling may differ from `wc -w` tokenisation; re-count using the university-approved template before final PDF export._
