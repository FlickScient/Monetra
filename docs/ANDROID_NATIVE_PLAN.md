# Monetra Android — Native App Implementation Plan

## Source of truth
- Repository: `FlickScient/Monetra`
- Baseline: `main`
- Implementation branch: `android-native`
- The existing Next.js website remains the canonical product and backend contract.
- Do not replace, reset, or destructively migrate the website or Neon data.

## Product decision
Build a real Android client with React Native (Expo prebuild / Android native runtime), not a WebView wrapper and not a packaged copy of the website. Recreate the existing Monetra screens and interaction patterns with native controls while sharing the existing API contracts and finance-domain rules. Keep the website untouched by isolating the mobile application in its own directory.

## Existing capabilities verified in the repository
- Next.js + React + TypeScript website.
- Clerk authentication.
- Neon Postgres through Drizzle and workspace-scoped APIs.
- Personal, Family, and Business workspace model.
- Finance snapshot endpoint: `GET /api/sync/bootstrap`.
- Incremental change feed: `GET /api/sync/changes?after=<cursor>`.
- Offline write gateway: `POST /api/sync/push`; currently supports transaction creation, transfers, and debt payments with operation IDs.
- Database trigger migration `drizzle/0008_finance_sync_change_log.sql` captures inserts, updates, and deletes across the finance tables and advances a per-workspace cursor.
- Fiscus already has a separate Supabase Edge Function, persisted conversations, workspace-isolated memories, and a `memory_enabled` preference. The current website chat keeps a local conversation cache, but does not implement a durable offline message outbox.

## Required mobile architecture
1. Native client: Expo + React Native, TypeScript, Android build output. No WebView.
2. Authentication: Clerk's native Expo SDK; persist session tokens using the platform secure storage adapter. Never store credentials in plain SQLite or AsyncStorage.
3. Local data: SQLite database, scoped by Clerk user ID and workspace ID. Store the latest bootstrap snapshot, incremental cursor, pending operations, sync metadata, and cached Fiscus messages.
4. Sync:
   - First online sign-in: fetch a consistent bootstrap snapshot and persist it transactionally.
   - Normal reconnect: push queued operations using their original stable UUID operation IDs; retry uncertain outcomes with the same IDs.
   - Pull ordered change-feed pages after the last committed cursor; apply each page and cursor atomically.
   - Do not advance the cursor until all changes in the page are committed locally.
   - Preserve local pending operations while applying server changes. Surface validation/conflict failures; never silently discard queued finance actions.
   - Show clear Offline / Syncing / Synced / Needs attention states and a manual retry action.
5. Offline behavior:
   - Open the app and browse the last successfully synced workspace snapshot without network access.
   - Allow locally queued finance actions only where the backend has idempotent support; visibly mark them Pending sync.
   - Keep the local record and operation ID until the server confirms success. Do not claim a Neon write before confirmation.
   - Fiscus chat drafts and queued messages remain visible offline; actual AI responses require a connection and are sent when the user retries or the app reconnects.
6. Fiscus:
   - A real conversation layout: message bubbles, composer pinned to keyboard-safe bottom, send/loading/error/retry states, conversation history, new chat, and workspace context.
   - Reuse the existing Edge Function and its existing workspace-scoped memory model. Add an explicit memory control and explain what is saved. Memory remains opt-in; do not infer or store sensitive financial details automatically.
7. Reliability:
   - Handle app resume, process death, flaky connections, token expiry, duplicate taps, stale workspace requests, interrupted sync, and low storage.
   - Use bounded retries with backoff, idempotency keys, schema-versioned local storage, defensive parsing, and actionable error messages.
   - Never allow cross-workspace cache reads or cross-user local database reuse.

## Existing gaps that must be closed before claiming full offline parity
- `getWorkspaceContext` currently authenticates through the web Clerk session; native bearer-token support must be added centrally and verified for every workspace-scoped API.
- The sync push endpoint currently accepts only transaction creation, transfers, and debt payments. Additional offline mutations must be added deliberately with idempotency and existing route validation; do not invent client-only Neon writes.
- The Fiscus backend already persists approved memories, but the native UI must expose memory preference and memory management safely. AI generation itself is online-only.
- The repository does not currently contain a complete native Android application or a PWA/service-worker offline implementation.

## Acceptance gates
- Website main branch and Neon records remain unchanged by mobile scaffolding.
- Android build installs as a standalone app and opens without a development server.
- Existing website and mobile client use the same Clerk identity and Neon records.
- Offline launch and workspace browsing work after a successful initial sync.
- Queued actions survive force-stop/relaunch and synchronize exactly once.
- Incremental sync handles paging, duplicate delivery, deletes, and interrupted runs without data loss.
- Personal, Family, and Business data remain isolated.
- Fiscus conversations restore across devices; local offline messages are clearly marked pending; memory is opt-in and workspace-isolated.
- Run type checks, unit tests, Android build, API authorization tests, and offline/reconnect integration tests before release. Never report a check as passed unless it was actually run.
