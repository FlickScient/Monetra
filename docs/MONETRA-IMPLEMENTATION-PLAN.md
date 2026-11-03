# Monetra implementation audit and delivery plan

Audit baseline: `main` at `dd479211fa5141af0cab8c95a791521fec4c11cf` (2026-11-03).

Monetra is the product. The earlier VAULT master prompt is the product requirements specification. This document records the verified baseline, implementation progress, and safe delivery order; it does not represent unfinished features as complete.

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


## Phase 1 implementation update — 2026-11-03

The following Phase 1 code has been committed to `main`:

- Added Drizzle schema definitions for organizations, organization memberships, and invitations.
- Added a versioned Drizzle migration at `drizzle/0000_organization_foundation.sql`. It creates Personal organizations and owner memberships for existing Clerk user IDs, then backfills existing wallets, categories, transactions, and ledger rows before enforcing organization ownership.
- Added a server-side organization context resolver. It verifies the signed-in Clerk user is a member of the requested organization; a client-provided organization ID is never trusted on its own.
- Added first-login Personal organization provisioning for accounts created after the migration.
- Scoped wallet, transaction, transfer, category, and summary APIs to the verified organization.
- Added organization list/create APIs and a workspace selector in the Monetra UI.
- Added role checks for owner, administrator, editor, and viewer.
- Added invitation creation and acceptance using hashed random tokens, a seven-day expiry, and verified Clerk email matching. The invite URL is returned for manual sharing; automated email delivery is not configured.
- Added member listing, role management, and removal endpoints. Owner protections and administrator restrictions are enforced server-side.
- Added `npm run db:migrate` and a GitHub Actions TypeScript-check workflow.

### Important migration gate

A read-only verifier is available as `npm run db:verify:organization`. It checks required organization tables/columns, null organization ownership, Personal organization + owner membership coverage for existing users, and membership role validity. Run it only after applying the migration to the intended staging or production database; it does not mutate data and cannot prove historical balances match unless you have separately captured pre-migration counts/balances.

**The database migration has been committed but has not been run against the Neon database.** The app code now expects the organization tables and `organization_id` columns to exist. Before using the updated app against production data:

1. Take a Neon snapshot/backup using the controls available in the Neon project.
2. Test the migration against a separate Neon branch or staging database containing a recent copy of the schema/data.
3. Set `DATABASE_URL` in the shell/CI environment without editing or committing `.env`.
4. Run `npm run db:migrate` from the project root.
5. Verify each existing user has exactly one Personal organization and owner membership, and verify wallet/transaction counts and balances match before and after.
6. Only then treat the organization foundation as live.

Do not claim backup readiness until an actual restore test has been completed.

### Build verification

The Vercel checks for the latest organization-foundation commits reported a Vercel `build-rate-limit` failure. This is a platform build-limit response, not a compiler diagnostic. The GitHub Actions TypeScript check completed successfully on commit `aefd53c21bc9690b92f11884b04eeffdaf3aac72` (run 41585870409). Vercel checks remain blocked by the account's `build-rate-limit`, not by a compiler diagnostic.

### Still outstanding in Phase 1

- Apply and verify the migration against a staging Neon database and then production.
- Add automated migration/backfill verification tests.
- Configure actual invitation email delivery (the current flow creates a secure link for manual sharing).
- Verify the Clerk dashboard settings for Google OAuth, email verification, and password recovery.
- Verify organization access behavior with multiple real test accounts and roles.



### Additional release risks found during dependency installation

The CI dependency install reported 29 npm audit advisories (8 moderate, 20 high, 1 critical) and specifically warned that the currently locked Next.js 13.5.6 version has a published security vulnerability. Do not run `npm audit fix --force` blindly; schedule a controlled dependency upgrade with compatibility checks and a lockfile update before calling the platform production-hardened.
