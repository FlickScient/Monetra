# Monetra Neon database runbook

The application now uses Clerk-authenticated, user-owned workspaces. Every finance API resolves the active workspace against the signed-in Clerk user; a supplied workspace ID is never accepted without an ownership match.

## 1. Confirm the Vercel database target

In Vercel → Project → Settings → Environment Variables, confirm `DATABASE_URL` exists for the environment being deployed (Preview or Production). It must point to the intended Neon project and branch.

If Preview and Production use different Neon branches, treat them as separate databases. Never paste the connection string into chat, source code, screenshots, issues, or logs.

## 2. Pull the intended environment locally

From the repository root:

```bash
vercel link
vercel env pull .env.local --environment=preview
npm ci
```

Use `--environment=production` only when preparing a separately approved production maintenance window. Keep `.env.local` private and uncommitted.

## 3. Run read-only diagnostics and preflight

```bash
npm run db:diagnose
node scripts/preflight-workspace-migration.mjs
```

The diagnostic checks the current workspace schema. The preflight checks that the target is the expected legacy Neon finance schema, has no partial migration state, and has no duplicate wallet ledger accounts that would prevent the ledger-integrity index from being created. Neither command mutates data.

Stop if either command reports an unexpected schema. Do not reset the database or manually edit Drizzle migration history.

## 4. Back up before migration

Create a Neon restore point/branch from the exact database being migrated. The guarded GitHub Actions workflow is configured to target a separate backup branch using the `MONETRA_BACKUP_DATABASE_URL` secret and the explicit `APPLY_TO_BACKUP` confirmation.

Do not point that secret at Production. The workflow is a manual backup-branch migration path, not an automatic production migration.

## 5. Apply and verify the migration chain

The reviewed Drizzle chain is:

- `0000_organization_foundation.sql` — preserves the legacy tenant foundation and ownership records.
- `0001_goals_due_debt.sql` — creates savings-goal and Due & Debt tables.
- `0002_private_workspaces.sql` — provisions Personal, Family, and Business workspaces.
- `0003_finance_workspace_scope.sql` — backfills every finance table to its owner workspace and enforces NOT NULL ownership.
- `0004_ledger_integrity.sql` — enforces one wallet ledger account per wallet, one-sided journal lines, and transaction idempotency keys.

After confirming the backup target:

```bash
npm run db:migrate
npm run db:verify:workspace
npm run db:diagnose
```

The migration chain assumes the existing base tables `profiles`, `wallets`, `categories`, `transactions`, `ledger_accounts`, and `ledger_entries` already exist. It is a data migration, not a disposable development reset.

If migration or verification fails, stop and inspect the exact Neon branch and Drizzle history before retrying. Never drop finance tables or mark migrations as applied manually.

## 6. Ledger cutover behavior

New wallet creation, income, expenses, and transfers now post balanced double-entry journal lines in the same Neon transaction as the wallet balance and transaction record.

For an older wallet with no journal history or a mismatch between its stored balance and journal balance, the difference is captured as a clearly labelled `adjustment` opening-position reconciliation the first time the new posting path touches it. This preserves the current balance without inventing historical transaction detail. These internal cutover adjustments are excluded from the normal transaction feed and income/expense summary.

Transaction and transfer endpoints accept an `Idempotency-Key` header. Replaying the same key and payload returns the original transaction; reusing the key with a different payload returns HTTP 409.

## 7. Deployment and app verification

Only after the intended database has the complete migration chain should the matching Vercel environment deploy/use this code. Preview and Production must be checked separately if they use separate Neon branches.

The application build and live-site behavior are separate checks from database migration verification. The user will perform those checks on Vercel after the backend changes are ready.

## Safety notes

- Never run the backup workflow against the Production connection string.
- Do not run the historical Supabase SQL migrations against Neon; they depend on Supabase Auth and RLS.
- Do not claim backup readiness until a restore has actually been tested.
- Do not claim the migration is applied until the read-only verifier passes against the intended Neon branch.
