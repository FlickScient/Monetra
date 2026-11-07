# Monetra Android Sync Contract

Status: design specification only. This document does not claim that offline storage, sync endpoints, or an APK have been implemented.

## Goals and invariants

- The web application remains online-first and continues using its existing authenticated API routes.
- The Android application uses a persistent SQLite database as its read model and durable offline outbox.
- Neon remains the cloud source of truth. Clerk remains the identity provider.
- Fiscus AI is online-only; finance capture, browsing, and editing must not require a network connection.
- Every local record and queued command is scoped to the authenticated owner and one of the owner's Personal, Family, or Business workspaces.
- A client must never write directly to Neon, embed database credentials, or bypass the existing finance rules.
- A successful local save means the command is durably committed to SQLite. It does not mean the cloud has accepted it.
- A command must be applied at most once to financial state, even if the device retries after a timeout.

## Why audit events are not a sync feed

The existing `finance_audit_events` table is best-effort logging written after some mutations. It is not transactionally coupled to every financial write, and it stores summaries rather than complete current entity state. It must not be used as a replication cursor.

Some tables are append-only event histories, while others are mutable current-state records. Some tables have no `updated_at` column. Therefore, timestamp polling is not a safe incremental-sync strategy.

## Server change feed

Implement a dedicated append-only `finance_sync_changes` table with:

- monotonically increasing database sequence/cursor;
- `workspace_id` and owner `user_id`;
- entity/table key and entity UUID;
- operation (`upsert` or `delete`);
- full post-write row JSON for upserts and a tombstone for deletes;
- server creation timestamp.

A database trigger should append a change row in the same Postgres transaction as each source-table INSERT, UPDATE, or DELETE. This makes a failed finance transaction and its feed entry roll back together. The trigger must derive the owner from the row's `user_id` when present, or from the owning workspace for tables such as `goal_allocations`. It must reject or safely skip rows without a valid workspace/owner rather than emit cross-tenant data.

Initial trigger coverage to verify against the live schema:

- Core: `workspaces`, `wallets`, `categories`, `transactions`, `ledger_accounts`, `ledger_entries`.
- Modules: `savings_goals`, `goal_allocations`, `goal_allocation_events`, `due_debts`, `due_debt_payments`, `monthly_budgets`, `recurring_transactions`, `wallet_reconciliations`, `finance_audit_events`.

Do not include `profiles` in the workspace feed without a separate user-profile sync contract. Never publish Clerk secrets, API keys, or server-only fields.

## API contract

### Bootstrap

Authenticated request, one workspace at a time. Return a consistent snapshot of all syncable entities plus a high-water cursor captured from the same database snapshot. The response must include schema version and server timestamp. Large datasets need pagination or a bounded snapshot token; never silently truncate.

### Pull

Authenticated request with workspace ID and last acknowledged cursor. Return ordered changes strictly after the cursor, a next cursor, and `hasMore`. Enforce owner/workspace membership on every request. A cursor from another workspace or user must reveal no data.

### Push

Authenticated batch of commands. Every command carries a client-generated stable UUID operation ID, workspace ID, command type, payload, and client creation time. Persist an operation receipt with a unique constraint on (workspace, operation ID). A repeated identical command returns its prior result; reusing an operation ID with a different payload returns a conflict. Apply the business operation and its receipt in one database transaction.

Push must call the same validated domain operations used by the web API, not duplicate wallet or journal arithmetic in a second implementation. In particular, transaction edits/deletes, transfers, credit-card liability handling, debt payments, goal allocations, and wallet archive behavior must retain their existing ledger and validation semantics.

## Conflict policy

- Financial commands are immutable intents, not blind row overwrites.
- New offline transactions use stable operation IDs and server idempotency.
- For edits to records that changed on the server after the device's base version, return a conflict with the current server row; do not silently last-write-wins.
- Deletes are explicit commands and produce tombstones.
- The client keeps rejected/conflicted commands visible for user resolution; it must never discard them silently.
- Pull applies only rows from the selected workspace and advances the cursor only after the local SQLite transaction commits.

## Android local database

Use SQLite with migrations and foreign keys enabled. Store a separate workspace partition for each fixed workspace. Required tables include cached workspace metadata, wallets, categories, transactions, ledger entities needed by screens, debts/payments, goals/allocations, budgets/recurring records where supported, sync cursor state, and durable outbox commands.

Store money as integer minor units. Preserve server IDs after acknowledgement. For a newly created offline record, use a client UUID as the record ID where the server schema and API support client-provided IDs; otherwise persist the operation-to-server-ID mapping. Do not use floating-point currency values.

Authentication tokens belong in platform secure storage, never SQLite plaintext or source code. Offline access must be gated by a previously authenticated local session and device lock policy; signing out must not expose another account's cached data.

## Rollout sequence

1. Complete mutation-route audit and identify every operation that needs an idempotency receipt.
2. Add the change-log table, trigger function, and trigger coverage in a reviewed migration.
3. Add bootstrap and pull endpoints with strict owner/workspace checks and integration tests.
4. Add durable push receipts and route all supported commands through shared domain logic.
5. Add a typed client repository boundary; web keeps using the API adapter, Android uses SQLite/outbox.
6. Add Capacitor Android shell and SQLite plugin only after the repository boundary is in place.
7. Add CI builds for debug APK and signed release APK/AAB. Keep signing keystore and passwords in protected CI secrets.
8. Run airplane-mode, process-death, duplicate-retry, conflict, workspace-isolation, and ledger-reconciliation tests before calling offline mode production-ready.

## Current implementation status

- Architecture and finance API audit documents are committed on `feat/android-local-first`.
- The existing finance API routes have been inspected for core transaction and module behavior.
- No sync change-log table, trigger, bootstrap/pull/push endpoint, SQLite repository, Capacitor project, Android APK, or release signing configuration is implemented yet.
