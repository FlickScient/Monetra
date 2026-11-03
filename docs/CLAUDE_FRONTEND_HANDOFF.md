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
