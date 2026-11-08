# Monetra Android Sync Contract

Status: the server-side bootstrap, pull, and limited push foundation is implemented on the isolated Android branch. The SQLite schema and client wire helpers are checked in, but the native SQLite driver, local repository/outbox runtime, and APK are not implemented.

## Goals and invariants

- The web application remains online-first and continues using its existing authenticated API routes.
- The Android application will use persistent SQLite as its local read model and durable offline outbox.
- Neon remains the cloud source of truth. Clerk remains the identity provider.
- Fiscus AI is online-only; finance capture and browsing must not require a network connection after initial sign-in/bootstrap.
- Every local record and queued command is scoped to the authenticated owner and one of the owner's Personal, Family, or Business workspaces.
- A client must never write directly to Neon, embed database credentials, or bypass existing finance rules.
- A successful local save means the command is durably committed to SQLite. It does not mean the cloud has accepted it.
- A command must be applied at most once to financial state, even if the device retries after a timeout.

## Why audit events are not a sync feed

The existing `finance_audit_events` table is best-effort logging written after some mutations. It is not transactionally coupled to every financial write, and it stores summaries rather than complete current entity state. It must not be used as a replication cursor.

Some tables are append-only event histories, while others are mutable current-state records. Some tables have no `updated_at` column. Timestamp polling is therefore not a safe incremental-sync strategy.

## Server change feed

Implemented in `drizzle/0008_finance_sync_change_log.sql`:

- `finance_sync_changes` stores a monotonically increasing per-workspace cursor, workspace and owner IDs, entity type/ID, operation, full post-write JSON for upserts, and tombstones for deletes.
- Database triggers append each change in the same Postgres transaction as the source-table INSERT, UPDATE, or DELETE.
- The owning workspace row is locked while allocating each cursor. This serializes cursor allocation per workspace and avoids clients skipping a transaction that commits out of order.
- Trigger coverage includes 14 tables: wallets, categories, transactions, ledger accounts/entries, savings goals, goal allocations/events, due debts/payments, monthly budgets, recurring transactions, wallet reconciliations, and finance audit events.
- Tables with a row-level `user_id` use it; `goal_allocations` resolves its owner through the workspace.
- The Drizzle schema declares the same composite primary key as the SQL migration.

The trigger does not cover `profiles` or `workspaces` themselves. Migration 0008 has NOT been applied to production.

## API contract

### Bootstrap

Implemented as authenticated `GET /api/sync/bootstrap`. It returns a repeatable-read snapshot of the workspace's syncable entities and a high-water cursor captured in the same transaction. The response includes schema version, export timestamp, workspace metadata, and the complete initial entity snapshot.

The current implementation returns the full workspace snapshot in one response. Pagination or a bounded snapshot token is still needed before supporting very large workspaces.

### Pull

Implemented as authenticated `GET /api/sync/changes?after=<cursor>&limit=<1..500>`. It returns ordered changes strictly after the cursor, a next cursor, and `hasMore`. Both workspace ID and Clerk owner are enforced in the query.

### Push

Implemented as authenticated `POST /api/sync/push` for three supported commands:
- `transaction.create`
- `transfer.create`
- `debt.payment`

The endpoint accepts 1–25 operations per batch, each with a stable UUID `operationId`. Duplicate IDs inside one batch are rejected. Results are returned per operation; a batch can partially succeed and uses HTTP 207 in that case.

The push endpoint dispatches into the existing finance route handlers rather than duplicating wallet or journal arithmetic. Transaction and transfer operations use the existing transaction idempotency key; debt payments use the existing debt-payment idempotency key. The handlers retain their current row locks, workspace authorization, validation, ledger posting, and outstanding-debt checks. Retrying an operation with the same ID and same payload returns its prior result; reusing an ID with a different payload is rejected by the underlying handler.

Not yet supported for offline push: transaction edit/delete, wallet/category mutations, debt creation/editing, savings allocations, budgets, recurring transactions, and other module commands. These require separately reviewed idempotency and conflict semantics.

### Client wire helpers

`lib/offline/sync-contract.ts` defines the wire types and supported command union. `lib/offline/sync-client.ts` provides typed bootstrap, pull, and push HTTP helpers. These helpers do not themselves persist outbox operations or apply pulled changes to local storage.

## Conflict and retry policy

- Financial commands are immutable intents, not blind row overwrites.
- The local client must persist an operation ID and payload before sending it.
- A timeout or uncertain response must be retried with exactly the same operation ID and payload.
- The push endpoint may return partial results; successful commands must be acknowledged locally, while failed or uncertain commands remain in the outbox.
- For edits to records changed on the server after the device's base version, return a conflict with the current server row; do not silently last-write-wins.
- Deletes are explicit commands and produce tombstones.
- The client keeps rejected/conflicted commands visible for user resolution; it must never discard them silently.
- Pull applies a page and advances the local cursor only after the same SQLite transaction commits.

## Android local database

A draft SQLite v1 schema is checked in at `android/database/001_initial.sql`. It creates:
- Per-owner workspace metadata.
- A workspace-partitioned local record cache.
- Durable outbox rows keyed by stable operation UUID.
- Per-workspace pull cursors.
- Local session/lock metadata and schema migration tracking.

The schema uses integer minor units for money, foreign keys for workspace partitioning, JSON validity checks, and explicit outbox states. `scripts/verify-android-sqlite-schema.py` executes the migration in SQLite and tests key constraints in CI.

**Important:** this is a checked-in schema, not a running SQLite implementation. The Capacitor SQLite driver, encrypted database key handling, repository adapters, atomic pull application, durable outbox worker, and UI integration still need to be installed and tested on an actual Android device.

## Rollout sequence

1. Run the read-only sync migration preflight against staging and review its findings. It checks table/column presence, UUID/text types, workspace ownership, and goal-allocation references.
2. Apply migration 0008 to staging, then verify trigger behavior for inserts, updates, deletes, rollback, and cursor ordering.
3. Complete durable outbox receipt semantics and expand idempotent push only for operations with safe server behavior.
4. Add the Capacitor Android shell, native SQLite driver, and secure credential/database-key storage.
5. Implement a typed repository boundary; web keeps using the API adapter, Android uses SQLite/outbox.
6. Implement snapshot bootstrap, atomic pull application, outbox push/acknowledgement, restart recovery, and visible conflict states.
7. Add CI builds for debug APK and signed release APK/AAB. Keep signing keystore and passwords in protected CI secrets.
8. Run airplane-mode, process-death, duplicate-retry, conflict, workspace-isolation, and ledger-reconciliation tests before calling offline mode production-ready.

## Current implementation status

- Implemented: migration 0008, transactional change triggers across 14 finance tables, authenticated bootstrap and incremental pull endpoints, and the limited push endpoint for transaction creation, transfers, and debt payments.
- Implemented: typed wire contracts, HTTP helpers, and a storage-agnostic sync coordinator. The coordinator recovers interrupted pushes, serializes per-workspace sync, retains retryable commands, surfaces conflicts/rejections, and applies pulled pages only through an atomic repository contract.
- Added: draft Android SQLite v1 schema and a Python SQLite validation step in CI.
- Added: read-only sync migration preflight script. It has not been run against staging or production.
- CI: latest full branch run is still pending/running; an earlier commit passed TypeScript check and production build.
- Not implemented: native SQLite driver, local repository/outbox runtime, pull application, Capacitor Android project, APK/AAB, release signing, and end-to-end offline tests.
- No production database migration has been applied as part of this work.
