# Monetra Android and Local-First Architecture

## Product decision

Ship Monetra as:
1. A directly downloadable, signed Android APK for initial distribution.
2. A Google Play Android App Bundle (AAB) after production hardening.

Use Capacitor to package the existing React/Next.js client experience. This is a native Android container, not a PWA shortcut.

## Non-negotiable data guarantees

- Existing Neon/Postgres remains the cloud source of truth.
- Clerk remains the identity provider; never embed a service-role key or database credential in the APK.
- The three workspaces (Personal, Family, Business) remain isolated.
- Local writes must be durable before the UI reports "Saved".
- Every queued mutation has a stable client-generated UUID/idempotency key.
- A sync retry must never create a duplicate financial transaction.
- Offline edits/deletes must not silently overwrite a newer cloud revision.
- Never run an automatic destructive migration or reset existing data.
- Keep financial amounts as integer minor units, never floating-point currency values.

## Target architecture

### Android shell
- Capacitor Android application.
- Capacitor SQLite plugin for persistent device storage.
- Native network status and secure credential storage.
- Local app assets bundled with the APK; no remote page load required to open the shell.

### Local data
- SQLite tables for workspace snapshots, wallets, categories, transactions, debts, debt payments, savings goals, budgets, and sync operations.
- Local queries power dashboard totals, transaction history, wallet balances and analytics.
- A workspace-scoped local database boundary; every query and queued operation carries workspace ID and authenticated owner ID.
- Track server revision/updatedAt and local mutation metadata.

### Sync engine
- Initial online sign-in and bootstrap download are required on a new device.
- Once bootstrapped, reads and supported writes operate from SQLite offline.
- Outbox records create/update/delete operations in a durable queue.
- Online sync pushes operations with idempotency keys, then pulls server changes.
- Server validates owner, workspace, ledger invariants and all existing business rules.
- Conflict policy is explicit per entity; financial transactions are immutable events where possible, and edits/deletes use server-validated compensating ledger operations.
- Expose Offline, Pending sync, Syncing, Synced and Sync error states.

## Critical Next.js constraint

The current app is a Next.js app with server API routes and Clerk authentication. Capacitor cannot run those API routes locally inside a static WebView. Therefore, do not simply wrap the production URL and call it offline.

The client data-access layer must be separated from the current fetch calls. In the browser/web build it can use the authenticated API. In the Android build it must use SQLite for reads/writes and the sync service for cloud reconciliation. Fiscus AI remains online-only.

## Delivery phases

1. **Audit and contract:** enumerate all finance entities, API mutations, ledger side effects, IDs, workspace authorization and deletion semantics.
2. **Android shell:** Capacitor config, Android project, app identity, icon/splash, local asset delivery and build workflow. No fake offline claims.
3. **SQLite foundation:** migrations, typed repositories, secure local bootstrap and workspace isolation.
4. **Transactions first:** local create/read/edit/delete, durable outbox, idempotent cloud sync, ledger-safe server reconciliation.
5. **Complete offline finance:** wallets, categories, transfers, debts/payments, savings, budgets, reports and analytics.
6. **Hardening:** airplane-mode tests, process-kill/restart tests, duplicate retry tests, conflict tests, backup/restore and security review.
7. **Distribution:** signed APK for direct download; signed AAB for Play Console. Keep the upload keystore outside the repository and store signing material only in protected CI secrets.

## Release gates

Do not publish an APK as "offline capable" until:
- Fresh install + sign-in + bootstrap succeeds.
- App can be force-closed/reopened in airplane mode and still show local finance data.
- New transactions can be created offline and survive process death.
- Reconnection syncs each operation exactly once.
- Workspace switching never leaks data.
- Cloud failures do not erase local writes.
- Existing production data and server ledger balances remain unchanged by migration.


## Local SQLite schema draft

The Android database schema is now defined in `android/database/001_initial.sql`. It includes:
- Per-owner workspace metadata and per-workspace pull cursors.
- A workspace-partitioned record cache with indexed entity, parent, amount and activity fields.
- A durable outbox keyed by stable operation UUID, with pending/processing/conflict/rejected states, retry counts, errors and server receipts.
- Local session/lock metadata and schema migration tracking.

The shared wire types are in `lib/offline/sync-contract.ts`. These define bootstrap, pull, push and the currently supported offline command types.

**Important:** this is a checked-in schema and contract, not a running SQLite implementation yet. The Capacitor SQLite driver, encrypted database key handling, repository adapters and UI integration still need to be installed and tested on an actual Android device.
