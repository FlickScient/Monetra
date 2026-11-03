# Monetra frontend handoff — Claude implementation contract

This document describes the frontend currently present on `ui/monetra-foundation` and the backend work required to make it persistent and operational. It does not authorize destructive schema changes.

## Non-negotiable constraints

- Preserve the existing Clerk authentication, Neon database, Drizzle setup, user records, transactions, wallets, categories, ledger accounts and ledger entries.
- Do not reset Git history, force-push, drop tables, remove columns, or replace existing migrations.
- The user has unpushed local work in `db/schema.ts`. Inspect and reconcile that work before proposing schema changes; never overwrite it blindly.
- Do not bring organization/team invitations, memberships, roles or team administration into the user-facing product. The intended product model is three isolated workspaces: Personal, Family and Business. Keep the existing data safe while migrating from the current organization-backed implementation.
- Due & Debt is a separate subledger. Borrowed principal is not income; principal repayment/collection is not ordinary expense/income. It must not silently change wallet balances or standard income/expense reports.
- All money is integer minor units (poisha) in APIs and database calculations. UI formatting converts to BDT display only.
- Enforce ownership and workspace authorization server-side on every request. Never trust a workspace ID supplied by the browser without checking access.
- Do not return fabricated/demo financial records as if they were real.

## Current frontend surfaces

- `app/page.tsx`: main client shell, workspace selector, overview, wallets, transactions, Financial Radar, Due & Debt, Fiscus A.I., settings, and global floating calculator.
- `components/monetra/financial-intelligence-view.tsx`: seven financial tools. These currently calculate from loaded workspace data or local inputs; most are not persisted.
- `components/monetra/due-debt-view.tsx`: receivable/payable records, partial principal collections/repayments, due-date indicators, filters and repayment history. State is currently in-memory only. Interest rate is reference-only and is not accrued.
- `components/monetra/module-views.tsx`: Fiscus A.I. interface, analysis-scope selector, prompt chips and settings. Sending is intentionally disabled until a real authorized backend exists.
- `components/monetra/floating-calculator.tsx`: global in-app calculator; should remain available across all views without navigation or refresh.

## Workspace model and isolation

Create or preserve three workspace records per user:
- `personal`
- `family`
- `business`

Every workspace-scoped resource must carry a workspace identifier (or equivalent validated relation). Switching workspace must reload all relevant data and clear stale view state. Personal, Family and Business must never leak transactions, wallets, categories, reports, goals or reconciliation records into one another.

Remove user-facing team/organization concepts after the migration is safely complete. Do not remove the current organization tables until data has been migrated, verified and backed up. The current frontend still uses organization APIs for workspace resolution; replace those calls with the final workspace API only after implementing and testing the migration.

Suggested API shape (adapt to existing route conventions rather than duplicating endpoints):
- `GET /api/workspaces` → `{ workspaces: [{ id, key, name, currency }] }`
- `GET /api/workspaces/active` or client-selected workspace ID
- `GET /api/workspaces/:workspaceId/summary`
- `GET /api/workspaces/:workspaceId/wallets`
- `GET /api/workspaces/:workspaceId/categories`
- `GET /api/workspaces/:workspaceId/transactions`

## Due & Debt backend contract

Suggested routes:
- `GET /api/due-debt?workspaceId=...` — list current user's due/debt records (separate from regular workspace totals; optionally globally scoped to the user if product decision is global).
- `POST /api/due-debt` — create a receivable or payable.
- `GET /api/due-debt/:id` — detail plus repayment/collection history.
- `PATCH /api/due-debt/:id` — update permitted metadata, due date, rate and status.
- `POST /api/due-debt/:id/payments` — append a partial or final repayment/collection.
- `POST /api/due-debt/:id/settle` — settle remaining balance with explicit confirmation.
- `DELETE /api/due-debt/:id` — archive/void with audit trail; avoid destructive hard-delete after payments exist.

A record should support:
- direction: `receivable` (owed to user) or `payable` (user owes)
- counterparty type and name/reference
- principal amount, currency, created date, due date, note
- annual rate and rate type, if applicable
- optional installment schedule and late-fee terms
- status: open, partially_settled, settled, overdue, archived
- immutable payment history with amount, date, note, payment method and idempotency key

Keep principal outstanding separate from accrued interest, fees and penalties. Define a clear accrual policy before calculating interest. Record principal collection/repayment in this subledger only; only actual interest/fees should affect ordinary financial reporting, and only through explicit user-confirmed ledger entries. Never auto-create wallet transactions without a user action and clear double-entry semantics.

## Seven Financial Radar tools

1. **Financial Radar / forecasting** — month-end cashflow forecast using dated, workspace-scoped actuals and optionally scheduled recurring items. Label forecast assumptions and confidence; do not extrapolate a partial month without explaining the method.
2. **Safe-to-Spend** — liquid available balance minus committed upcoming outflows and a user-defined reserve. Exclude credit limits and avoid double-counting savings/locked funds. Show the calculation inputs.
3. **Quiet Leak Detector** — identify recurring merchants/descriptions, duplicate charges, and unusual spend changes. Return evidence (dates, counts, amounts); call them candidates, not confirmed subscriptions.
4. **What-If Simulator** — scenario-only calculations for purchases, income changes, savings and debt payments. Must never mutate the ledger.
5. **Adaptive Goals** — persistent goals with target amount/date, saved-to-date source, recommended contribution, progress and optional automatic recalculation. Avoid double-counting money already assigned elsewhere.
6. **Cash Reconciliation** — compare system balance to counted balance, save a dated reconciliation record, and require an explicit adjustment transaction if the user wants the ledger changed.
7. **Debt Strategy Engine** — Snowball/Avalanche comparison using all relevant debts, rates, minimums, fees and payment frequency. State assumptions; handle zero/negative amortization and variable rates safely.

Suggested routes:
- `GET /api/intelligence/overview?workspaceId=...`
- `POST /api/intelligence/forecast`
- `POST /api/intelligence/scenarios` (calculation only; no persistence required initially)
- `GET|POST /api/goals?workspaceId=...`
- `PATCH|DELETE /api/goals/:id`
- `GET|POST /api/reconciliations?workspaceId=...`
- `POST /api/debt-strategy/simulate`

The current frontend's seven-card implementation is a prototype. Persist goals and reconciliations only when the API is ready; until then, clearly label local-only calculations.

## Fiscus A.I. contract

The UI currently disables sending. Enable it only after implementing a server-side service with:
- authenticated user and authorized workspace scope derived/validated on server
- scope values: selected workspace, Personal, Family, Business, all workspaces + Due & Debt
- record retrieval and deterministic calculations before LLM narration
- citations/references to transaction IDs, date ranges, workspace and calculation inputs in structured response metadata
- explicit distinction between actuals, estimates, assumptions and recommendations
- refusal to invent missing records or silently cross workspace boundaries
- prompt-injection defense: transaction descriptions, counterparties, notes and imported content are untrusted data, never instructions
- rate limits, request size limits, audit-safe logging (no secrets or unnecessary financial payload logging), and provider key stored server-side only
- streaming response if supported, with clear error/cancel states

Suggested route: `POST /api/fiscus/chat` with `{ message, scope, workspaceId?, conversationId? }`. Response should include assistant text plus structured evidence, calculation metadata, date range and scope. Do not send raw credentials or API keys to the browser.

## Floating calculator

Keep it globally mounted and independent of navigation. It is a convenience calculator, not an accounting entry form. Do not write results to wallets or transactions unless a separate explicit transaction workflow is completed by the user.

## Quality / handoff

- Preserve existing APIs unless a migration plan proves they can be replaced.
- Add runtime validation to every write route; use integer minor units and database transactions for multi-row writes.
- Add authorization tests for cross-user and cross-workspace access, plus unit tests for financial calculations.
- Add migration tests and verify row counts / ownership mapping before retiring organization-backed storage.
- Run `npm run typecheck`, `npm run lint` if configured, and `npm run build`.
- Do not report success unless the command actually passed.


## Current implementation status — 4 November 2026

The branch contains the frontend foundation, not a production-complete finance system.

- Personal/Family/Business are represented through the existing organization-backed selector for now. The migration to true three-workspace records and removal of user-facing organization concepts is backend/migration work. Do not delete the existing organization tables or APIs before data is migrated and verified.
- A workspace-switch request guard now clears the previous workspace's visible finance data while the next workspace loads and ignores late responses from older requests. Keep equivalent stale-response protection in any replacement workspace data layer.
- Due & Debt records, repayment history, and record deletion currently live in React component state only. They reset on refresh and are not durable.
- The seven Financial Radar tools are present as a frontend prototype. Goal and reconciliation records are not persisted; forecasts and debt comparisons are estimates based on the currently loaded records and documented assumptions.
- Fiscus A.I. is a non-connected interface. The send action must remain disabled until the authenticated server-side analysis service and evidence contract are implemented.
- The floating calculator is client-side only and must never create ledger entries implicitly.
- No database schema or migration was changed by the frontend work.

## Required implementation order for Claude

1. Inspect the current branch and the user's unpushed local changes, especially `db/schema.ts`. Reconcile; do not overwrite.
2. Diagnose the existing production/preview Neon connection and organization-members lookup failure by confirming which Neon branch/database the deployed `DATABASE_URL` points to. Never request or print secrets in logs.
3. Design a reversible migration from organization-backed records to the three workspace keys. Preserve IDs, ownership, row counts, balances, ledger history and auditability. Add verification and rollback steps before retiring any legacy path.
4. Implement and test server-side workspace authorization and workspace-scoped APIs. Do not trust browser-supplied IDs.
5. Implement Due & Debt persistence and payment history as a separate subledger. Add idempotency and transaction boundaries. Keep principal outside normal income/expense totals and wallet balances unless a user explicitly confirms a separate ledger transaction.
6. Implement persistent goals and cash reconciliations, then the seven-tool calculation APIs. Add deterministic unit tests for money math, dates, rates, zero balances, and edge cases.
7. Implement Fiscus retrieval/calculation/evidence first, then LLM narration. Keep sending disabled until this is complete and authorization tests pass.
8. Wire the frontend to the real APIs, add loading/empty/error/retry states, and remove prototype-only state only when the persistent replacement is working.
9. Run the repository's actual checks: `npm ci`, `npm run typecheck`, configured lint, `npm run build`, migration verification and authorization tests. Fix failures; report exact commands and outcomes.
10. Verify Personal, Family and Business isolation with separate test users and cross-workspace negative tests. Verify Due & Debt does not distort wallet, asset, income or expense totals.

## Handoff acceptance criteria

- Existing user data is preserved and mapped exactly once.
- A user can switch between Personal, Family and Business without stale or cross-workspace data appearing, including during rapid switching and failed requests.
- Refreshing the browser does not erase Due & Debt records, repayments, goals or reconciliations.
- Partial repayment/collection updates outstanding principal correctly; duplicate payment submissions are idempotent.
- Forecasts and debt strategy outputs expose assumptions and never masquerade as guaranteed outcomes.
- Fiscus answers are grounded in authorized records and include workspace/date-range evidence; unsupported questions are answered as unknown, not guessed.
- No demo records are presented as user data, no silent ledger mutations occur, and no existing tables or user data are discarded.


## Savings goals and local prototype storage — November 2026

The frontend now includes a Savings Goals view, backed by existing real wallets:
- Goals have a name, target amount, optional target date, and per-wallet allocations.
- Allocations reserve part of a wallet's available balance across all goals. They do not create transactions, move money between accounts, or increase assets.
- Users can allocate and release amounts from a selected wallet. Deleting a goal with allocations explicitly confirms that those allocations will be released.
- Due & Debt and Savings Goals currently persist in browser localStorage, each isolated by workspace ID. This is a temporary single-device prototype, not cloud persistence or secure server storage.
- Do not treat localStorage as authoritative financial data. Replace it with authenticated, server-authorized APIs and database transactions before production. Migrate or explicitly discard prototype-local data only with user consent; never silently imply that local browser data has synced to the account.
- Suggested persistent goal model: workspace_id, owner_id, name, target_minor, currency, target_date, status, created_at, updated_at.
- Suggested allocation model: goal_id, wallet_id, amount_minor, created_at, updated_at. Enforce that allocations across all active goals for a wallet cannot exceed its eligible available balance. Reconcile against wallet transactions and transfers on the server; do not duplicate wallet balances.
- Goal contribution/release history should be auditable. A contribution is an allocation record, not an income transaction. A real transfer between separate bank/cash accounts remains a wallet transfer and must be recorded separately.
