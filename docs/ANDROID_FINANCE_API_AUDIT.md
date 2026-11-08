# Finance API Audit for Offline Sync

This is an implementation audit of the current server contract. It is not an offline implementation and must not be treated as one.

## Existing authenticated read endpoints

| Data | Endpoint | Notes |
|---|---|---|
| Workspace list | GET /api/workspaces | Establishes owner/workspace context |
| Wallets | GET /api/wallets | Returns server-computed balances |
| Categories | GET /api/categories | GET may seed defaults on first access |
| Transactions | GET /api/transactions | Offset pagination, max 100 per request |
| Transaction summary | GET /api/transactions/summary | Server aggregates by date window |
| Income/expense | GET /api/transactions/income-expense | Separate reporting query |
| Debts/payments | GET /api/due-debt and nested payment routes | Outstanding/status derived from payment records |
| Goals/allocations | GET /api/goals and nested allocations | Allocation totals constrain available wallet funds |
| Reports/tools | GET /api/reports, /api/finance-tools | Derived server-side data |
| Backup | GET /api/backup | Workspace-scoped full backup; candidate for first-device bootstrap |

## Financial writes that cannot be blindly replayed

| Operation | Current endpoint | Server-side effects / invariants |
|---|---|---|
| Create income/expense | POST /api/transactions | Updates wallet balance, inserts transaction, posts double-entry journal; supports idempotency key |
| Edit transaction | PATCH /api/transactions/:id | Reverses prior journal effects and posts replacement effects; locks wallets |
| Delete transaction | DELETE /api/transactions/:id | Voids/reverses journal and restores wallet balance |
| Transfer | POST /api/transfers | Locks both wallets, updates both balances and journals; supports idempotency |
| Wallet create/edit/archive | /api/wallets and /api/wallets/:id | Creates ledger account; archive preserves history |
| Category create/edit/delete | /api/categories and /api/categories/:id | Type changes prohibited while used; delete unassigns transactions |
| Debt/payment changes | /api/due-debt/* | Payment totals drive debt status/outstanding; payment creation is idempotent |
| Savings allocations | /api/goals/:id/allocations | Checks available wallet funds and goal target; records allocation events |
| Goal and budget changes | /api/goals/* and related routes | Workspace scoped |

## Consequences for offline-first implementation

1. Do not make a local transaction directly mutate the cloud wallet balance. It creates a local projection and outbox command; cloud ledger posting remains server-authoritative.
2. Transfer commands must be atomic across both wallets when applied on the server.
3. Transaction edit/delete cannot be a generic upsert. They must invoke existing server ledger-safe business operations.
4. Debt payment and savings allocation operations require server validation because they depend on aggregate outstanding/reserved amounts.
5. Category deletion and wallet archival must preserve existing reference/history behavior.
6. The current backup endpoint is a possible bootstrap source but must be versioned and paired with a reliable incremental sync cursor before use as a general delta-sync protocol.
7. Client-generated stable UUID idempotency keys must be created before a local write and reused for every retry.

## Required server protocol before full offline mode

- Authenticated bootstrap snapshot with workspace identity and monotonic server change cursor.
- Workspace-scoped change feed for incremental pull.
- Typed mutation commands for transaction create/edit/void, transfer, debt payment, allocation and metadata changes.
- Idempotency records for every replayable command, not only transaction create and transfer.
- Server-side validation of workspace ownership and entity revisions.
- Explicit conflict response with current server record and revision; no silent last-write-wins for financial events.
- Durable client outbox with retry/backoff and per-command state.
- Reconciliation checks for wallet balances and journal totals after sync.

## Current client coupling

The main page currently loads workspaces and finance data directly through fetch calls, then stores results in React state. Mutations also call API routes directly. There is not yet a repository abstraction or durable local database. Adding SQLite alone will not make the existing screens offline; the app must migrate to a typed data gateway feature by feature.

## Current scope and release guard

No schema migration or production database write is required for this audit. Keep Neon tables, Clerk auth, Supabase Fiscus auth, and workspace authorization unchanged. Do not release an APK as offline-capable until airplane-mode and sync idempotency tests pass.
