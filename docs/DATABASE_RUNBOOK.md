# Monetra database recovery runbook

The workspace API requires the organization foundation migration. A deployment can build successfully while the connected Neon database is still missing that schema.

## 1. Check the Vercel environment

In Vercel → Project → Settings → Environment Variables, confirm `DATABASE_URL` exists for the environment serving the failing deployment (Preview or Production). It must point to the intended Neon project/branch and database. Do not paste the value into chat, issues, screenshots, or logs.

If Preview and Production use different Neon branches, treat them as separate databases and verify each independently.

## 2. Pull the intended environment locally

Install/use the Vercel CLI and authenticate to the correct Vercel project. Then pull the environment you intend to diagnose:

```bash
vercel link
vercel env pull .env.local --environment=preview
```

Use `--environment=production` only when preparing to verify Production. Keep `.env.local` private; it must never be committed.

## 3. Run the read-only diagnostic

From the repository root:

```bash
npm ci
npm run db:diagnose
```

The diagnostic never prints the connection URL. It checks connectivity and the tables/columns required by the current organization-backed workspace API.

- If connection fails, fix the Vercel `DATABASE_URL` value/target first.
- If the database is reachable but required tables/columns are missing, continue only after confirming the target database and taking a Neon backup/restore point.

## 4. Apply the existing migration

The current migration is `drizzle/0000_organization_foundation.sql`. It creates the organization tables and backfills existing finance rows into each user's Personal organization. It assumes the pre-existing finance tables (`profiles`, `wallets`, `categories`, `transactions`, `ledger_accounts`, and `ledger_entries`) already exist.

After a backup and target confirmation:

```bash
npm run db:migrate
npm run db:verify:organization
npm run db:diagnose
```

Do not run this against a database that lacks the base finance tables. Do not manually mark a migration as applied. If the migration partially failed or the verification reports missing ownership, stop and inspect the database before attempting any retry; do not drop tables or reset the Neon branch.

Repeat the process separately for Preview and Production only if both environments are intended to use this schema.

## 5. Verify the deployed app

Redeploy the branch/environment after the migration, then reload the app. If it still fails, inspect the Vercel runtime logs for the `MONETRA_ORG_ERROR` entry and share only the sanitized error message and SQLSTATE/code. Never share environment variable values.

## Safety notes

- The migration is a data migration, not a disposable development reset.
- Do not run it against an unconfirmed Neon branch.
- Do not remove the legacy organization tables or finance ownership columns until a separate, verified workspace migration preserves all IDs, balances, and ledger history.
- The diagnostic is read-only. The migration command is not.
