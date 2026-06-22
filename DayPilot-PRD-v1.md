# DayPilot — Product & Technical Requirements Document

**Version:** 1.0 (MVP)
**Document Status:** Complete — Single Source of Truth
**Last Updated:** June 19, 2026

---

## Table of Contents

1. [Product Overview & Vision](#section-1-product-overview--vision)
2. [Health Check, Sync & Timezone Handling](#section-2-health-check-sync--timezone-handling)
3. [Reminder Engine & Recurring Task System](#section-3-reminder-engine--recurring-task-system)
4. [Data Model & Schema Design](#section-4-data-model--schema-design)
5. [Non-Functional Requirements](#section-5-non-functional-requirements)
6. [User Flow & Screen Map](#section-6-user-flow--screen-map)
7. [UI Brief & Brand Identity](#section-7-ui-brief--brand-identity)
8. [Implementation Plan & Phased Timeline](#section-8-implementation-plan--phased-timeline)
9. [LLM Build Prompts](#section-9-llm-build-prompts)

---

## Section 1: Product Overview & Vision

### 1.1 Product Vision Statement

DayPilot is a mobile-first, intelligent daily calendar and task tracking system built for a single power user. It eliminates the cognitive overhead of managing a dynamic schedule by automating reminders, surfacing deadline urgency progressively, and delivering a structured daily briefing — all anchored to a single source of truth: Google Calendar.

### 1.2 Problem Statement

Modern productivity tools are fragmented. Calendar apps don't talk to task managers. Notification systems are static and dumb. The user is forced to manually context-switch between tools, manually set reminders, and mentally track deadline proximity — creating daily cognitive load that compounds into missed tasks, poor time allocation, and reactive (rather than proactive) scheduling behavior.

### 1.3 Product Goals

| # | Goal | Success Metric |
|---|------|----------------|
| G-1 | Eliminate manual reminder configuration | 100% of Google Calendar events auto-ingested with zero manual re-entry |
| G-2 | Deliver escalating deadline awareness | User receives ≥ 3 progressive reminders per deadline task |
| G-3 | Reduce morning planning friction | Daily briefing delivered by 6:00 AM (device-local) with zero user-initiated action |
| G-4 | Unify notification surface | All reminders dispatched across Push and Email with < 2s latency |

### 1.4 MVP Scope Boundary

**In Scope for V1:**
- Google Calendar read-only sync (polling-based, not webhooks)
- Recurring task template engine (Daily, Weekly, Monthly, Custom Interval)
- Escalating 3-tier deadline reminder system
- Daily morning briefing digest (automated, device-local 6:00 AM floor)
- Two-channel notification delivery: Email (Resend) and Push (FCM)
- Solo user architecture (single account, no multi-tenancy, structured for future readiness)

**Explicitly Out of Scope for V1:**
- WhatsApp notifications (deferred — pending Meta Business API verification)
- Apple Calendar integration
- Outlook / Microsoft 365 integration
- Email/password authentication (Google OAuth only)
- iOS app (Android is primary platform for V1)
- AI-powered auto-rescheduling
- Priority scoring matrix
- Team or shared calendar features
- Web dashboard
- Streak tracking / completion history dependency between recurring instances
- Per-task-configurable reminder offsets (system defaults only)
- Granular per-category notification preferences (account-level toggles only)
- "Undo complete" from the home feed
- Webhook-based real-time calendar sync (5-minute polling instead)

### 1.5 Target User Persona

| Attribute | Detail |
|-----------|--------|
| **User Type** | Solo power user |
| **Platform** | Mobile-first (Android primary; iOS deferred) |
| **Calendar Ecosystem** | Google Calendar (primary, only integration for V1) |
| **Notification Behavior** | Multi-channel consumer: Push + Email |
| **Core Pain Point** | Reactive scheduling, missed deadlines, no unified daily overview |
| **Technical Comfort** | High — willing to configure once, expects zero friction thereafter |

### 1.6 Technical Stack Declaration (Final)

| Layer | Technology |
|-------|------------|
| **Mobile Client** | React Native + TypeScript (Android primary for V1) |
| **Styling** | NativeWind (Tailwind utility classes, mapped to Section 7 design tokens) |
| **API Data Layer (Client)** | TanStack Query (caching, refetch, loading/error states) |
| **Authentication** | Google OAuth 2.0 only — no email/password method in V1 |
| **Calendar Integration** | Google Calendar API (read-only, polling-based sync) |
| **Push Notifications** | Firebase Cloud Messaging (FCM) |
| **Email Notifications** | Resend (free tier) |
| **Backend / API** | Node.js + Express + TypeScript |
| **Job Scheduler** | BullMQ + Redis (in-process with the Express app) |
| **Database** | PostgreSQL |
| **Token Encryption** | Application-layer, Node's built-in `crypto` (AES-256-GCM) |
| **Hosting** | Railway |

**Key architectural decisions and rationale:**
- **PostgreSQL over MongoDB:** The data model is fundamentally relational (templates generate task instances, reminders reference tasks, foreign-key integrity matters for cascade behavior). Chosen over MongoDB despite the user's greater familiarity with Mongo, since the relational patterns would likely be needed by V2 regardless.
- **Polling over webhooks for Calendar sync:** A single-user app has no hard requirement for sub-minute sync latency. Polling every 5 minutes via `syncToken` eliminates an entire class of webhook-renewal infrastructure and failure modes (domain verification, TTL expiry, silent renewal failures) for negligible UX cost.
- **In-process BullMQ over a separate worker process:** At solo-user scale, the coordination overhead of a separate worker process isn't justified. Mitigated by per-call timeout wrappers (Section 9, Step 5.5) and Railway auto-restart-on-crash (Section 9, Step 10.5).
- **30-day JWT, no refresh-token rotation:** Appropriate threat model for a single-device personal tool — the security tradeoff of a long-lived token is acceptable when the attack surface is "someone steals my personal phone," not a multi-tenant SaaS breach scenario.

---

## Section 2: Health Check, Sync & Timezone Handling

### 2.1 Pre-Briefing Health Check System

**FR-2.1:** Before dispatching the daily briefing digest, the system must execute a health check sequence no later than 5:55 AM device-local time (5-minute buffer before the 6:00 AM floor).

**FR-2.2:** The health check must verify, in order:
1. **Database connectivity** — successful read/write ping to PostgreSQL.
2. **Google Calendar API token validity** — verify the stored OAuth refresh token can successfully exchange for a valid access token. If expired/revoked, attempt silent refresh; if refresh fails, flag account for re-authentication.

**FR-2.3:** If either check fails, the system must NOT attempt to send the full briefing. Instead, it must dispatch a single fallback notification via Push and Email: *"Your daily briefing couldn't be generated — please open the app to reconnect."*

**FR-2.4:** Health check failures must be logged with a timestamp and failure reason (DB timeout vs. token expiry) for diagnostic purposes — log only, no user-facing dashboard in V1.

### 2.2 Timezone & Scheduling Behavior

**FR-2.5:** All reminder and briefing scheduling will be calculated using the **device's local timezone** at the time the task/event is created or modified — not server time, not a fixed timezone.

**FR-2.6:** The system must capture and store the device timezone offset (e.g., `Africa/Lagos`) at the point of scheduling. This value is **snapshotted**, not live-recalculated, to avoid silent rescheduling if the user travels mid-cycle.

> **Known V1 limitation (accepted, documented, not engineered around):** If a user creates a task/template while at home, then travels, all recurrence instances continue firing at the *original* timezone's clock time. This is a deliberate tradeoff — building travel-aware recurrence would require either continuous GPS tracking (privacy/battery cost) or disruptive re-confirmation prompts, disproportionate to how rarely this scenario occurs for a solo user. Documented as a release-notes-level limitation, not engineered around in V1.

**FR-2.7:** Background job scheduling (BullMQ) must convert device-local trigger times to UTC for internal queue processing, then resolve back to the snapshotted timezone for delivery-time accuracy.

**FR-2.7a (Display Logic):** Separately from scheduling, the Home/Today View's "completed task grey-out" reset (Section 6) always uses the **device's current local midnight**, not any task's `timezone_snapshot` — this is a display concern, not a scheduling concern, and intentionally uses live device time so "today" always matches the user's current physical location.

### 2.3 Google Calendar Sync Behavior

**FR-2.8:** On initial OAuth connection, the system performs a full historical + forward sync of the user's primary Google Calendar.

**FR-2.9:** Ongoing sync uses **scheduled polling** (BullMQ repeatable job, every 5 minutes) using Google's `syncToken` for incremental fetches — not push webhook channels. This was a deliberate architecture revision from an initial webhook-based design: webhooks require a publicly verified HTTPS endpoint and domain verification, plus renewal logic before each channel's ~7-day TTL expiry, none of which is justified at solo-user scale where 5-minute sync latency is imperceptible for a personal daily planner.

**FR-2.10:** *(Removed — was webhook renewal logic; no longer applicable under the polling model.)*

**FR-2.11:** If a stored `syncToken` is rejected by Google (HTTP 410, token expired/invalid), the system must perform one full resync and store a fresh token — this is the only failure mode to handle, and it self-heals on the next poll cycle.

### 2.4 Firebase Cloud Messaging (FCM) — Setup Reference

FCM is Google's free push notification delivery service. The backend sends a message to FCM's servers targeting a device token; FCM handles delivery to that specific device regardless of app/lock state. For Android, FCM is the native, only-needed push mechanism (no separate APNs-equivalent required).

**Setup chain:** Firebase Console project → register Android app (package name) → download `google-services.json` → install `@react-native-firebase/messaging` in the React Native project → generate a Service Account key (for backend-side sending) → store the key as a Railway environment variable (base64-encoded, since multi-line JSON doesn't store cleanly as a raw env value) → app obtains a device token at runtime via `getToken()` → token is synced to the backend and stored against the user record.

> **Operational note:** Device tokens rotate (reinstall, cleared data, periodic refresh). The system implements an `onTokenRefresh` listener (Section 9, Step 10.1) to keep the backend's stored token current — without this, push delivery silently fails after any token rotation with no visible error.

---

## Section 3: Reminder Engine & Recurring Task System

### 3.1 Escalating Deadline Reminder System

**FR-3.1:** Every task with a defined deadline must generate **3 reminder tiers**:

| Tier | Label | Default Trigger Offset | Channel(s) |
|------|-------|------------------------|------------|
| Tier 1 | Advance Notice | 24 hours before deadline | Push |
| Tier 2 | Approaching | 1 hour before deadline | Push + Email |
| Tier 3 | Due Now / Overdue | At deadline timestamp | Push + Email |

**FR-3.2:** Reminder offsets are **system defaults for V1**, not user-configurable per task. Per-task configurability is deferred to V1.5.

**FR-3.3:** Each tier reminder is an independent BullMQ delayed job, scheduled at task creation time, using the task's snapshotted timezone (FR-2.6) for trigger resolution.

**FR-3.4:** If a task is marked complete **before** a tier's trigger time fires, that tier's pending job must be cancelled.

**FR-3.5:** If a task's deadline is edited/rescheduled, all 3 pending reminder jobs are cancelled and regenerated against the new deadline. If a single update includes both a completion status change AND a deadline change, completion takes precedence — no new reminders are generated.

**FR-3.6 (Revised):** Tier 3 (Due Now/Overdue) does not repeat as a standalone push/email reminder. Instead, overdue tasks are surfaced via the Daily Briefing Digest under a dedicated "Overdue" subsection.

**FR-3.6a:** The Daily Briefing's overdue subsection only includes tasks overdue by **7 days or less**. Tasks overdue beyond 7 days are excluded from the briefing entirely.

**FR-3.6b:** This is a deliberate scope boundary: V1 has no "snooze"/"dismiss"/"archive" mechanism for stale overdue tasks. They age out of briefing visibility at 7 days and require manual user action in-app (via the unbounded Overdue List screen) if ever revisited. A persistent badge/count on the Home screen prevents these tasks from becoming fully invisible to the user's mental model.

### 3.2 Recurring Task Template Engine

**FR-3.7:** The system supports 4 recurrence pattern types: **Daily**, **Weekly** (specified days of week), **Monthly** (specified date), **Custom Interval** (every N days).

**FR-3.8:** Each recurrence template generates fully independent **task instances** — no dependency on prior or future instances' completion state (no streak tracking in V1).

**FR-3.9:** Instance generation occurs on a **rolling 7-day window** — the system pre-generates the next 7 days of instances, extended daily via a scheduled job, rather than generating indefinitely.

**FR-3.10:** Editing a template applies only to **future-generated** instances. Already-generated instances within the current window are not retroactively modified.

**FR-3.11:** Deleting a template is a **soft-delete** (`is_active = false`) — it stops future instance generation but does not delete already-generated instances.

**FR-3.12 (Universal Anchor Rule — Final):** For **all** recurrence types (Daily, Weekly, Monthly, Custom Interval), the first generated instance occurs on the day **following** template creation, never on the creation day itself. This consistency rule was deliberately generalized from an initial Custom-Interval-only rule, to prevent per-type exceptions from becoming a source of bugs and to match user expectation (a template created today is "starting tomorrow," not retroactively firing today).

### 3.3 Daily Briefing Architecture

**FR-3.13:** The Daily Briefing Digest is generated by a **single sequential orchestrator job** (`BriefingBuilderService`), executed once per day per user. This job owns: health check execution, data aggregation (today's tasks + overdue ≤7 days), payload composition, and final dispatch. No parallel or independently-scheduled jobs may write to or trigger briefing output — this avoids race conditions and duplicate-send risk that would arise from splitting this into multiple coordinated triggers.

**FR-3.14 (Retry & Abandonment — Final):** Data aggregation retries every **60 seconds**, for a maximum window of **10 minutes**. If aggregation has not succeeded by **6:30 AM** (hard abandonment cutoff, device-local), the system stops retrying and dispatches the failure-fallback message instead.

**FR-3.15:** `BriefingBuilderService` and all BullMQ job processing run **in-process** within the Node.js/Express backend (no separate worker process for V1) — a deliberate scope-appropriate tradeoff given solo-user scale, mitigated by per-call timeouts and process-level auto-restart (Section 5, Section 9 Phase 10).

**FR-3.16:** The backend process runs under an **auto-restart-on-crash policy** (Railway native, or `pm2`) as baseline insurance against the in-process coupling accepted in FR-3.15.

---

## Section 4: Data Model & Schema Design

### 4.1 Core Tables Overview

| Table | Purpose |
|-------|---------|
| `users` | Single-tenant V1, modeled for future multi-user readiness |
| `google_accounts` | OAuth tokens, sync state — scoped separately from `users` for credential hygiene |
| `tasks` | Individual task/event instances — the atomic unit of the product |
| `recurrence_templates` | Defines recurrence rules; generates `tasks` rows |
| `reminders` | One row per scheduled reminder tier per task |
| `notification_log` | Delivery audit trail — what was sent, when, via which channel, success/failure |

### 4.2 Table: `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `email` | TEXT, UNIQUE, NOT NULL | |
| `device_timezone` | TEXT | IANA format (e.g., `Africa/Lagos`); updated on app open |
| `fcm_token` | TEXT, NULLABLE | Current device token; kept current via `onTokenRefresh` listener |
| `briefing_enabled` | BOOLEAN, DEFAULT true | Account-level toggle |
| `push_enabled` | BOOLEAN, DEFAULT true | Account-level toggle (added in Section 9, Step 9.2) |
| `email_enabled` | BOOLEAN, DEFAULT true | Account-level toggle (added in Section 9, Step 9.2) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### 4.3 Table: `google_accounts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `user_id` | UUID, FK → `users.id` | |
| `access_token` | TEXT | Encrypted at the **application layer** via Node's `crypto` (AES-256-GCM) before insert |
| `refresh_token` | TEXT | Same application-layer encryption |
| `token_expires_at` | TIMESTAMPTZ | |
| `sync_token` | TEXT, NULLABLE | Google's incremental sync cursor |
| `last_synced_at` | TIMESTAMPTZ | |
| `sync_status` | ENUM (`healthy`, `token_expired`, `sync_error`) | Drives health check system |

**Encryption implementation note:** A single shared utility module (`encrypt()` / `decrypt()`) wraps all reads/writes to these two fields — no inline encryption logic scattered across the codebase. Key stored as Railway env var `TOKEN_ENCRYPTION_KEY`, backed up externally (e.g., a password manager) at generation time. **Key-loss procedure (documented, manual, intentionally not automated):** if the key is lost or rotated, truncate `google_accounts` and the user re-triggers OAuth. At solo-user scale, the blast radius of this failure is one re-authentication, not a system-wide incident — building automated key-rotation tooling here would be disproportionate engineering effort.

### 4.4 Table: `recurrence_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `user_id` | UUID, FK → `users.id` | |
| `title` | TEXT, NOT NULL | |
| `recurrence_type` | ENUM (`daily`, `weekly`, `monthly`, `custom_interval`) | |
| `interval_days` | INTEGER, NULLABLE | Only for `custom_interval` |
| `days_of_week` | INTEGER[], NULLABLE | Only for `weekly` |
| `day_of_month` | INTEGER, NULLABLE | Only for `monthly` |
| `time_of_day` | TIME, NOT NULL | |
| `timezone_snapshot` | TEXT, NOT NULL | Locked at creation |
| `anchor_date` | DATE, NOT NULL | Creation date + 1, universal anchor rule |
| `is_active` | BOOLEAN, DEFAULT true | False = soft-deleted |
| `created_at` | TIMESTAMPTZ | |

### 4.5 Table: `tasks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `user_id` | UUID, FK → `users.id`, NOT NULL | |
| `recurrence_template_id` | UUID, FK → `recurrence_templates.id`, NULLABLE | NULL = standalone task |
| `google_event_id` | TEXT, NULLABLE | If synced from Google Calendar |
| `title` | TEXT, NOT NULL | |
| `deadline_at` | TIMESTAMPTZ, NULLABLE | NULL = no deadline (pure calendar event) |
| `timezone_snapshot` | TEXT, **NOT NULL** | Enforced at DB level |
| `status` | ENUM (`pending`, `completed`) | **No stored `overdue` state** — computed at query time |
| `completed_at` | TIMESTAMPTZ, NULLABLE | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Index:** `(user_id, status, deadline_at)`

**Computed overdue logic (architectural decision):** Overdue status is never stored — it's computed at query time via `status = 'pending' AND deadline_at IS NOT NULL AND deadline_at < NOW()`. This eliminates an entire category of background-job-drift bugs that a stored, actively-flipped status would require maintaining.

### 4.6 Table: `reminders`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `task_id` | UUID, FK → `tasks.id`, ON DELETE CASCADE | |
| `tier` | ENUM (`advance`, `approaching`, `due_now`) | |
| `trigger_at` | TIMESTAMPTZ, NOT NULL | |
| `bullmq_job_id` | TEXT, NULLABLE | For cancellation/rescheduling |
| `status` | ENUM (`scheduled`, `sent`, `cancelled`) | |
| `sent_at` | TIMESTAMPTZ, NULLABLE | |

### 4.7 Table: `notification_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `user_id` | UUID, FK → `users.id` | |
| `reminder_id` | UUID, FK → `reminders.id`, NULLABLE | NULL for briefing/system messages |
| `channel` | ENUM (`push`, `email`) | |
| `notification_type` | ENUM (`reminder`, `briefing`, `system_fallback`) | |
| `delivery_status` | ENUM (`success`, `failed`) | |
| `failure_reason` | TEXT, NULLABLE | |
| `sent_at` | TIMESTAMPTZ | |

### 4.8 Explicit Schema Anti-Patterns (Rejected By Design)

- **No generic `metadata JSONB` catch-all column.** Becomes an undocumented junk drawer; new fields get real columns via cheap Postgres migrations instead.
- **No stored `overdue` status.** Computed at query time (see 4.5) to avoid sync-drift bugs.
- **No streak/completion-history dependency between recurring instances.** Each instance is fully independent, per FR-3.8.

---

## Section 5: Non-Functional Requirements

### 5.1 Rate Limiting

**NFR-5.1:** All public-facing API endpoints enforce basic rate limiting via `express-rate-limit` — protects against accidental client-side bugs (e.g., a runaway retry loop), not primarily against malicious traffic at solo-user scale.

**NFR-5.2:** Google Calendar API calls respect Google's quota (1,000,000 requests/day, 600/100s per user); the polling job implements exponential backoff on `429`/`403` responses.

**NFR-5.3 (Expansion-aware):** Rate limiting is applied **per-user-ID**, not globally — structured this way so adding users later requires no rework.

### 5.2 Error Logging & Observability

**NFR-5.4:** All errors are logged as structured JSON (timestamp, error type/category, relevant entity ID, human-readable message) — not freeform strings.

**NFR-5.5:** V1 logging destination is **stdout**, captured by Railway's built-in log viewer — no external logging service (Sentry, Datadog) in V1; this is explicitly deferred, not omitted by oversight.

**NFR-5.6 (Expansion-aware):** Because logs are structured JSON from day one, migrating to an external logging service later is a destination change, not a logging-format rewrite.

### 5.3 Security Baseline

**NFR-5.7 (Finalized):** Authentication uses a JWT with a **30-day expiry**, tied to `users.id`. **No refresh-token rotation flow in V1** — re-authentication occurs naturally when the token expires. Explicit accepted tradeoff: simplicity over short-lived-token hygiene, justified by single-device, single-user threat model.

**NFR-5.8:** Standard security headers applied via `helmet` middleware (sensible defaults — `X-Content-Type-Options`, `X-Frame-Options`, basic CSP).

**NFR-5.9:** All secrets (DB connection string, FCM service account key, encryption key, Resend API key, Google OAuth client secret) live exclusively in Railway environment variables. `.env` is never committed.

**NFR-5.10:** All traffic is HTTPS-only, enforced via Railway's platform-level TLS termination.

### 5.4 Performance Baseline

**NFR-5.11:** Standard CRUD operations resolve in **under 500ms** under normal conditions — a tripwire threshold, generous at solo-user scale.

**NFR-5.12 (Expansion-aware):** Database indexes are defined per known query pattern upfront (Section 4), not added reactively after slowdowns.

### 5.5 Resilience Baseline

**NFR-5.13:** Per-call timeout wrappers (~8 seconds) are applied to all external API calls (Google Calendar, FCM, Resend) — necessary given the accepted in-process BullMQ architecture (FR-3.15), since a single hung external call could otherwise freeze the entire backend's event loop without ever triggering a crash-based auto-restart.

**NFR-5.14:** Process-level auto-restart-on-crash (Railway native or `pm2`) is configured as baseline insurance for the in-process coupling tradeoff — explicitly scoped as "cheap insurance," not a substitute for the per-call timeouts in NFR-5.13, which address the root cause (hangs) rather than just the symptom (crashes).

### 5.6 Explicitly Rejected Engineering Patterns (Documented Scope Discipline)

The following were deliberately considered and rejected as disproportionate to solo-user MVP scale — noted here so they are not silently reconsidered later without justification:
- Circuit-breaker pattern for external API failures (sufficient: timeout + retry + log)
- Automated key-rotation tooling for the token encryption key (sufficient: documented manual procedure)
- Webhook-based real-time calendar sync (sufficient: 5-minute polling)
- Separate worker process for BullMQ job processing (sufficient: in-process + timeouts + auto-restart)
- GPS-based automatic timezone detection for travel scenarios (sufficient: snapshotted timezone, documented limitation)

---

## Section 6: User Flow & Screen Map

### 6.1 Screen Inventory

| # | Screen | Purpose |
|---|--------|---------|
| 1 | Splash / Launch | App load, auth state check |
| 2 | Google Sign-In | OAuth entry point, first-run or post-expiry re-auth |
| 3 | Calendar Permission & Initial Sync | One-time consent + full historical sync, with progress indicator |
| 4 | Home / Today View | Primary daily screen — merged chronological feed of tasks + calendar events |
| 5 | Briefing View | Read-only daily digest, surfaced via push/email deep-link |
| 6 | Task Detail | View/edit a single task — title, deadline, completion toggle |
| 7 | Create Task (One-Off) | New standalone task, no recurrence |
| 8 | Create Recurring Template | New recurrence template |
| 9 | Recurrence Template List | View all active templates, edit or deactivate |
| 10 | Overdue List (Full) | All overdue tasks, unbounded (not capped at 7 days, unlike the briefing) |
| 11 | Settings | Account-level toggles, Google account status, theme, logout |
| 12 | Sync Status / Error State | Dismissible banner shown when `sync_status != healthy` |

### 6.2 Primary Navigation Structure

**Bottom Tab Bar (3 tabs):** Today (default) → Templates → Settings.

Overdue List and Briefing View are accessed via a badge/link from the Today tab, not as separate tabs — keeping navigation surface minimal by design.

### 6.3 Critical User Flow: First-Time Setup

```
Splash → [no auth token] → Google Sign-In → [OAuth success]
  → Calendar Permission & Initial Sync (progress bar) → [sync complete]
  → Home / Today View (empty state if no events today)
```

### 6.4 Critical User Flow: Creating a Recurring Task

```
Templates Tab → Tap FAB → Create Recurring Template screen
  → Select recurrence type → [conditional fields] → Set time-of-day → Save
  → Returns to Templates Tab → New template appears
  → [Background: first instance silently generates for tomorrow, per FR-3.12]
```

### 6.5 Critical User Flow: Daily Reminder → Action

```
[Push fires — Tier 1/2/3] → User taps notification → Deep-link to Task Detail
  → User marks complete → [cancels remaining pending tiers, FR-3.4]
  → Returns to Home / Today View (task shows completed state)
```

### 6.6 Critical User Flow: Health Check Failure → Recovery

```
[6:00 AM — health check fails, fallback notification sent]
  → User taps fallback notification → App opens to Sync Status / Error State
  → User taps "Reconnect" → Re-triggers Google Sign-In
  → [Success] → Home / Today View   /   [Failure] → Remains on error screen, no infinite retry
```

### 6.7 Locked Behavioral Rules

- **Sync Error banner (Screen 12):** Dismissible, non-blocking. User can dismiss and continue using cached data. Re-appears on next app open or relevant screen until resolved — never locks the user out entirely.
- **Task completion display (FR-6.1):** Completed tasks remain visible in Today View for the rest of the day, rendered greyed-out/struck-through. Removed from the active view at the next **device-current-local-midnight** (not the task's `timezone_snapshot` — see FR-2.7a). Not deleted from the database, simply filtered from that day's view forward.
- **No "undo complete" from the home feed.** If a user needs to un-complete a task, they do so deliberately from Task Detail.
- **Calendar sync staleness:** A known, accepted up-to-5-minute staleness window exists between a direct Google Calendar edit and it reflecting in DayPilot, communicated via a low-key in-app note rather than implying instant sync.

---

## Section 7: UI Brief & Brand Identity

### 7.1 Brand Mood & Positioning

DayPilot's visual identity communicates **clarity, momentum, and calm control** — the feeling of a well-organized cockpit, not a cluttered to-do list.

**Design Principles:**
- Generous whitespace over density — no visual clustering, every screen has room to breathe.
- One primary action per view — avoid competing CTAs.
- Color as signal, not decoration — bright blue and orangered are used purposefully, not as blanket theming.

### 7.2 Color System

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `color-primary` | `#0066FF` | `#3D8BFF` | Primary actions, active states, links, FAB |
| `color-accent` | `#FF4500` | `#FF6433` | Urgency signals — **reserved exclusively** for Tier 2/3 reminders and overdue indicators |
| `color-background` | `#FFFFFF` | `#0E0E10` | Base canvas |
| `color-surface` | `#F7F8FA` | `#1A1A1D` | Cards, elevated containers |
| `color-text-primary` | `#1A1A1D` | `#F2F2F3` | Primary text |
| `color-text-secondary` | `#6B6B70` | `#9A9AA0` | Secondary/meta text |
| `color-border` | `#E5E6E8` | `#2A2A2E` | Dividers, card outlines |
| `color-success` | `#1FA75B` | `#34C97A` | Completed task state |

**Color hierarchy rule (locked):** When both `color-primary` (blue) and `color-accent` (orangered) appear on the same card, **orangered always visually dominates** — urgency outranks primary action. Orangered is reserved exclusively for urgency signals; using it elsewhere would erode its signal value.

### 7.3 Typography

| Token | Spec | Usage |
|-------|------|-------|
| `font-family` | Inter (system fallback: -apple-system/Roboto) | All UI text |
| `text-display` | 28px / Semibold | Screen titles |
| `text-heading` | 18px / Semibold | Section headers, task titles |
| `text-body` | 15px / Regular | Standard content |
| `text-caption` | 13px / Regular | Timestamps, secondary metadata |

Inter chosen over a custom display typeface deliberately — highly legible, neutral, free, well-supported across iOS/Android, reduces design/rendering risk versus marginal brand differentiation from a licensed typeface.

### 7.4 Spacing & Layout System

| Token | Value | Usage |
|-------|-------|-------|
| `space-xs` | 4px | Icon-to-text gaps |
| `space-sm` | 8px | Inline element spacing |
| `space-md` | 16px | Standard card padding, list item spacing — **minimum gap between task cards** |
| `space-lg` | 24px | Section separation |
| `space-xl` | 32px | Screen top/bottom margins |

**Layout rule:** No more than one card's worth of information density per glance — title, time, and a single status indicator only on collapsed views; full detail lives in Task Detail.

### 7.5 Light/Dark Mode Behavior

**UI-7.1:** Theme respects the device's system-level setting by default on first launch.

**UI-7.2:** A manual three-way override (Light / Dark / System) lives in Settings.

### 7.6 Logo Direction

Minimal wordmark-led identity — "DayPilot" in Inter Semibold, paired with a simplified abstract glyph (compass-needle/arrow shape, reinforcing "pilot/guidance") in bright blue, with a small orangered accent mark reinforcing the active/urgent signal. Designed to remain legible at 48×48px app-icon scale. One static app icon and wordmark for V1 — no dark-mode icon variants, seasonal themes, or animated splash reveals (explicitly rejected as disproportionate design overhead for a solo MVP).

---

## Section 8: Implementation Plan & Phased Timeline

No fixed calendar timeline was set — phases are dependency-ordered, not date-bound, to be executed sequentially by a single coding agent (Claude Code).

### 8.1 Phase Overview

| Phase | Name | Outcome |
|-------|------|---------|
| 1 | Backend Skeleton & Auth | DB schema live, encryption working, JWT auth functional, Google OAuth round-trip complete |
| 2 | Calendar Sync (Read-Only) | Polling-based incremental sync, syncToken expiry recovery, quota backoff |
| 3 | Task & Template CRUD (API Only) | Full task/template CRUD, instance generation, computed-overdue queries |
| 4 | Reminder Scheduling Engine | 3-tier reminders created/cancelled/rescheduled correctly on task lifecycle |
| 5 | Notification Dispatch | Real FCM + Resend delivery, centralized logging, timeout protection |
| 6 | Daily Briefing Orchestrator | Full sequential pipeline — health check, retry/abandonment, dispatch |
| 7 | Mobile App Shell | RN project, navigation, theming, working Google Sign-In |
| 8 | Mobile Core Screens | Today View, Task Detail, Create Task/Template — wired to live backend |
| 9 | Mobile Secondary Screens & Polish | Templates list, Settings, Overdue List, Sync Error banner |
| 10 | Hardening Pass | Token refresh listener, rate limiting, structured logging, security headers, process resilience |

**Sequencing rationale:** Backend-first by layer (Phases 1–6), frontend arrives as one solid block (Phases 7–9) once the entire backend is provably working via API testing, then a final cross-cutting hardening pass (Phase 10). This avoids the worst case of pure layer-first sequencing (no visual progress for months) while also avoiding the cognitive cost of a single sequential coding agent thrashing between backend and mobile code every other phase.

**Accepted tradeoff:** Roughly 60% of the build (Phases 1–6) produces no visual mobile UI — verified via API client (Postman/Thunder Client) instead. This is a known morale/motivation risk for a solo builder, flagged but accepted in favor of backend correctness before UI investment.

### 8.2 Full Step Breakdown

**Phase 1 — Backend Skeleton & Auth** (6 steps): Project init (TypeScript) → DB connection + schema migration → encryption utility → JWT middleware → Google OAuth flow (scaffold, plaintext) → wire in encryption.

**Phase 2 — Calendar Sync** (4 steps): Initial full sync → incremental sync via syncToken → scheduled 5-minute polling job → syncToken expiry (410) + quota backoff handling.

**Phase 3 — Task & Template CRUD** (5 steps): Task CRUD → Template CRUD → instance generation (rolling 7-day window) → universal anchor rule correctness pass (dedicated step, given complexity) → computed-overdue endpoint.

**Phase 4 — Reminder Scheduling Engine** (4 steps): Reminder record creation → BullMQ job scheduling → cancellation on completion → rescheduling on deadline edit.

**Phase 5 — Notification Dispatch** (5 steps): Firebase/FCM groundwork → FCM wired into reminder firing → Resend email dispatch → centralized notification_log write-through → timeout wrappers (pulled forward from Phase 10 since cheap to add while code is fresh).

**Phase 6 — Daily Briefing Orchestrator** (5 steps): Health check function → data aggregation → retry/abandonment orchestration → payload composition & dispatch → scheduled 5:55 AM trigger.

**Phase 7 — Mobile App Shell** (4 steps): RN + TypeScript + NativeWind + TanStack Query init → navigation structure → theming system (design tokens) → Google Sign-In screen + backend auth connection.

**Phase 8 — Mobile Core Screens** (4 steps): Today View (merged feed) → Task Detail → Create Task (one-off) → Create Recurring Template.

**Phase 9 — Mobile Secondary Screens & Polish** (3 steps): Templates List + Overdue List (merged step, per right-sizing review) → Settings → Sync Error banner + display-behavior refinement pass.

**Phase 10 — Hardening Pass** (5 steps): FCM token refresh listener → rate limiting → structured JSON logging → security headers + secrets audit → process auto-restart configuration.

**Total: 10 phases, 45 steps**, each independently testable, ending with a clear "what's next" handoff with zero orphaned code at any step.

---



## Document End

This document is the single source of truth for the DayPilot V1 build. All sections (1–9) reflect decisions locked collaboratively across product strategy, technical architecture, data modeling, UX design, brand identity, and implementation planning. Refer back to this document at every build step — particularly Section 9's prompts, which assume the exact state produced by all prior sections and prior prompts in sequence.
