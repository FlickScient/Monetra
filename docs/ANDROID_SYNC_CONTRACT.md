# Monetra Android Sync Contract

Status: server-side sync foundation implemented on the isolated Android branch. Local SQLite/outbox, push, and APK are not implemented yet.

## Goals and invariants

- The web application remains online-first and continues using its existing authenticated API routes.
- The Android application will use persistent SQLite as its local read model and durable offline outbox.
- Neon remains the cloud source of truth. Clerk remains the identity provider.
- Fiscus AI is online-only; finance capture, browsing, and editing must not require a network connection.
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

The trigger does not cover `profiles` or `workspaces` themselves. Clerk secrets and server-only keys are never part of the feed. Migration 0008 has not been applied to production.

## API contract

### Bootstrap

Implemented as authenticated `GET /api/sync/bootstrap`. It returns a repeatable-read snapshot of the workspace's syncable entities and a high-water cursor captured in the same transaction. The response includes schema version and server timestamp.

The current implementation returns the full workspace snapshot in one response. Pagination or a bounded snapshot token is still needed before supporting very large workspaces.

### Pull

Implemented as authenticated `GET /api/sync/changes?after=<cursor>&limit=<1..500>`. It returns ordered changes strictly after the cursor, a next cursor, and `hasMore`. Both workspace ID and Clerk owner are enforced in the query.

### Push

Not implemented yet. It must accept stable client operation IDs, persist operation receipts with a unique constraint on (workspace, operation ID), return the prior result for an identical retry, and reject reuse of an operation ID with a different payload.

Push must call the same validated domain operations used by the web API, not duplicate wallet or journal arithmetic. Transaction edits/deletes, transfers, credit-card liability handling, debt payments, goal allocations, and wallet archive behavior must retain existing ledger and validation semantics.

## Conflict policy

- Financial commands are immutable intents, not blind row overwrites.
- New offline transactions use stable operation IDs and server idempotency.
- For edits to records changed on the server after the device's base version, return a conflict with the current server row; do not silently last-write-wins.
- Deletes are explicit commands and produce tombstones.
- The client keeps rejected/conflicted commands visible for user resolution; it must never discard them silently.
- Pull applies only rows from the selected workspace and advances the cursor only after the local SQLite transaction commits.

## Android local database

Use SQLite with migrations and foreign keys enabled. Store a separate workspace partition for each fixed workspace. Required tables include cached workspace metadata, wallets, categories, transactions, ledger entities needed by screens, debts/payments, goals/allocations, budgets/recurring records where supported, sync cursor state, and durable outbox commands.

Store money as integer minor units. Preserve server IDs after acknowledgement. For a newly created offline record, use a client UUID as the record ID where the server schema and API support client-provided IDs; otherwise persist the operation-to-server-ID mapping. Do not use floating-point currency values.

Authentication tokens belong in platform secure storage, never SQLite plaintext or source code. Offline access must be gated by a previously authenticated local session and device lock policy; signing out must not expose another account's cached data.

## Rollout sequence

1. Run the read-only sync migration preflight against staging and review its findings.
2. Apply migration 0008 to staging, then verify trigger behavior for inserts, updates, deletes, rollback, and cursor ordering.
3. Add durable push receipts and route supported commands through shared domain logic.
4. Complete mutation-route idempotency and conflict handling.
5. Add a typed client repository boundary; web keeps using the API adapter, Android uses SQLite/outbox.
6. Add the Capacitor Android shell and SQLite plugin only after the repository boundary is in place.
7. Add CI builds for debug APK and signed release APK/AAB. Keep signing keystore and passwords in protected CI secrets.
8. Run airplane-mode, process-death, duplicate-retry, conflict, workspace-isolation, and ledger-reconciliation tests before calling offline mode production-ready.

## Current implementation status

- Architecture, finance API audit, and sync contract are committed on `feat/android-local-first`.
- Implemented: migration 0008, transactional change triggers across 14 finance tables, authenticated bootstrap and incremental pull endpoints, and a first push slice for transaction/transfer creation using existing server handlers and idempotency keys.
- Added: read-only sync migration preflight script. It has not been run against staging or production.
- CI: an earlier commit passed TypeScript check and production build; the latest changes are awaiting CI.
- Not implemented: durable local SQLite repository/outbox, conflict-aware edit/delete and module-command push, Capacitor Android project, APK/AAB, release signing, and end-to-end offline tests.
- No production database migration has been applied as part of this work.
