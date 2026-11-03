# VAULT implementation audit and delivery plan

Audit baseline: `main` at `dd479211fa5141af0cab8c95a791521fec4c11cf` (2026-11-03).

VAULT is the target product specification. Monetra is the existing application and should be upgraded incrementally. This document records the verified baseline and the safe implementation order; it does not represent unfinished features as complete.

## Current verified baseline

### Working foundation
- Next.js 13 / React 18 / TypeScript application.
- Clerk is integrated through `ClerkProvider`, sign-in/sign-up routes, and protected middleware.
- Neon Serverless PostgreSQL and Drizzle are wired through `db/index.ts`.
- Drizzle schema currently defines profiles, wallets, categories, transactions, ledger accounts, and ledger entries.
- Wallet APIs support authenticated create/list operations and integer minor-unit balances.
- Transaction APIs support authenticated income/expense creation, pagination, and ownership checks.
- Transfer API moves funds atomically between same-currency wallets and handles credit-card destination payments.
- Monthly income/expense/category aggregates are queried from PostgreSQL.
- Dashboard, light/dark styling, responsive navigation, and a web app manifest exist.
- Latest Vercel checks for the audit baseline commit report success.

### Partial or incomplete
- Authentication UI is Clerk-hosted/integrated, but production provider settings, email verification, Google OAuth, recovery, and multi-device behavior must be verified in the Clerk dashboard.
- The schema has ledger account/entry tables, but live transaction and transfer APIs do not post journal lines. The app is not yet operating as a double-entry accounting system.
- Wallet balances are currently mutated directly by transaction APIs. They are not derived from a balanced, immutable journal.
- Categories are seeded per user; category management is not a complete CRUD module.
- Dashboard aggregates cover the current monthly income/expense summary, not the full VAULT reporting model.
- A PWA manifest exists, but offline caching, installability validation, and background sync are not established.
- Some useful dependencies are present (React Hook Form, Zod, Recharts), but their presence alone does not mean the requested workflows are implemented.

### Not implemented in the current application
- Organizations, organization membership, roles, invitations, and organization-scoped records.
- A Neon/Drizzle-compatible, production-used double-entry posting engine, reversals, idempotency, and audit trail.
- Loans/debts, installment schedules, budgets, savings goals, recurring rules.
- Family sharing and per-wallet/member permissions.
- Business sales, purchases, inventory movements, receivables, payables, and invoices.
- VAULT Intelligence with scoped read-only financial tools and real-data analysis.
- Full reports, exports, attachments/object storage, notifications, backup automation, and tested recovery.
- Automated financial/accounting acceptance tests and a security test suite.

## Architecture decisions

1. **Neon + Drizzle + Clerk remain the runtime stack.** The Supabase SQL migrations in `supabase/migrations` depend on Supabase Auth (`auth.uid()`) and Supabase roles/RLS. They are not compatible with the current Clerk + Neon application and must not be applied to the production database as-is.
2. **Organization is the tenant boundary.** Every finance record will belong to an organization. The server will resolve the active organization only after verifying the Clerk user is a member with the required role; a client-supplied organization ID is never authorization.
3. **Preserve existing user data.** Phase 1 must create a Personal organization for each existing user and backfill existing wallets, categories, transactions, and ledger records before organization ownership becomes mandatory. This must be delivered as a versioned Drizzle migration with rollback/recovery notes.
4. **Journal history is immutable.** Posted financial events will create balanced journal entries and lines inside one database transaction. Corrections use reversal entries; they do not rewrite posted lines.
5. **Minor units remain integers.** Avoid JavaScript floating-point arithmetic. Database aggregates should remain exact (BIGINT/text or decimal-safe representations) until formatted for display.
6. **AI is read-only by default.** The LLM receives only scoped aggregates and selected records returned by server-side tools. It never writes financial data or posts journal entries.
7. **Secrets stay server-side.** Do not expose environment values in client bundles, logs, generated documentation, or commits.

## Delivery phases and exit gates

### Phase 1 — Tenant foundation
- Add organizations, memberships, roles, invitations, and organization settings.
- Backfill one Personal organization per existing user.
- Add organization ownership and indexes to existing finance tables.
- Add a shared server authorization/context helper and migrate existing APIs to membership checks.
- Verify legacy users retain the same wallets, categories, transactions, and balances after migration.
- Exit gate: cross-organization access tests pass; no finance API trusts a raw organization ID.

### Phase 2 — Accounting engine
- Define chart-of-accounts rules for asset, liability, equity, income, and expense accounts.
- Implement atomic posting for income, expense, transfers, refunds, borrowing, lending, and repayments.
- Enforce balanced journal entries, idempotency, safe concurrent balance checks, and immutable reversals.
- Exit gate: the financial acceptance scenarios in the master prompt pass against a test database.

### Phase 3 — Personal finance workflows
- Add debt/loan schedules, budgets, savings goals, recurring transactions, and wallet statements.
- Exit gate: principal, interest, fees, and savings movements reconcile correctly.

### Phase 4 — Family and permissions
- Add invitations, member roles, shared wallets, wallet-level access, and member limits.
- Exit gate: permission matrix tests prove members cannot read or mutate unauthorized records.

### Phase 5 — Business accounting
- Add products, stock movements, sales, purchases, customers, suppliers, receivables, payables, and invoices.
- Exit gate: credit sales do not increase cash; inventory and cost of goods sold reconcile.

### Phase 6 — Dashboard and reporting
- Replace ad-hoc dashboard calculations with shared accounting queries.
- Add date filters, historical net worth, cash flow, budget/debt/savings reporting, CSV/PDF exports.
- Exit gate: dashboard and exported reports reconcile to the ledger.

### Phase 7 — VAULT Intelligence
- Add authenticated, organization-scoped read-only query tools and server-side LLM orchestration.
- Add language handling for English, Bangla, and Banglish.
- Exit gate: every numeric answer includes its period/source context; AI cannot execute financial writes.

### Phase 8 — Reliability and release
- Add PWA service worker/offline-safe behavior, rate limits, audit logs, secure attachments, backup and restore runbooks, monitoring, and acceptance/security tests.
- Exit gate: backup restoration is actually tested and documented; deployment checks are green.

## Known risks and safeguards

- The existing schema uses JavaScript-number mode for BIGINT values. Keep accepted amounts within safe integer limits for now; migrate to a lossless representation before supporting larger balances or cross-currency accounting.
- Current transaction APIs update wallet balance columns without ledger posting. Do not add new financial transaction types on top of that pattern; Phase 2 must make journal posting the authoritative path.
- The Supabase migrations are historical design artifacts only for this runtime. Do not run them against Neon.
- `.env` is already tracked in the repository. It is intentionally excluded from this implementation work and must not be edited or printed. A `.gitignore` rule does not remove an already-tracked file; credentials that have been exposed in repository history should be rotated and the repository history handled separately.
- CI/Vercel success on one commit is not equivalent to accounting correctness, migration safety, backup readiness, or completion of the product requirements.

## Immediate next implementation slice

Begin Phase 1 with a reviewed Drizzle migration and server-side organization context. Preserve the existing single-user experience by automatically selecting the user's Personal organization when only one exists. Do not expose organization switching UI until membership checks and data backfill are in place.
