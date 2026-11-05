import {
  pgTable, uuid, text, bigint, timestamp, date, integer, boolean, index, uniqueIndex, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces, wallets, categories } from './schema';

export const savingsGoals = pgTable('savings_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  targetMinor: bigint('target_minor', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('BDT'),
  targetDate: date('target_date'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('savings_goals_workspace_idx').on(table.workspaceId, table.createdAt),
  targetPositive: check('savings_goals_target_positive', sql`${table.targetMinor} > 0`),
  statusValid: check('savings_goals_status_valid', sql`${table.status} in ('active', 'completed', 'archived')`),
}));

export const goalAllocations = pgTable('goal_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id').notNull().references(() => savingsGoals.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  goalWalletUnique: uniqueIndex('goal_allocations_goal_wallet_unique').on(table.goalId, table.walletId),
  workspaceIdx: index('goal_allocations_workspace_idx').on(table.workspaceId),
  amountPositive: check('goal_allocations_amount_positive', sql`${table.amountMinor} > 0`),
}));

export const goalAllocationEvents = pgTable('goal_allocation_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id').notNull().references(() => savingsGoals.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('goal_allocation_events_workspace_idx').on(table.workspaceId, table.createdAt),
  actionValid: check('goal_allocation_events_action_valid', sql`${table.action} in ('allocate', 'release')`),
  amountPositive: check('goal_allocation_events_amount_positive', sql`${table.amountMinor} > 0`),
}));

export const dueDebts = pgTable('due_debts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  direction: text('direction').notNull(),
  counterpartyName: text('counterparty_name').notNull(),
  principalMinor: bigint('principal_minor', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('BDT'),
  annualRateBps: integer('annual_rate_bps').notNull().default(0),
  dueDate: date('due_date'),
  note: text('note'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('due_debts_workspace_idx').on(table.workspaceId, table.createdAt),
  directionValid: check('due_debts_direction_valid', sql`${table.direction} in ('receivable', 'payable')`),
  statusValid: check('due_debts_status_valid', sql`${table.status} in ('open', 'partially_settled', 'settled', 'archived')`),
  principalPositive: check('due_debts_principal_positive', sql`${table.principalMinor} > 0`),
  rateNonNegative: check('due_debts_rate_nonnegative', sql`${table.annualRateBps} >= 0`),
}));

export const dueDebtPayments = pgTable('due_debt_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  dueDebtId: uuid('due_debt_id').notNull().references(() => dueDebts.id, { onDelete: 'restrict' }),
  userId: text('user_id').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  paidAt: timestamp('paid_at').notNull().defaultNow(),
  paymentMethod: text('payment_method'),
  note: text('note'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('due_debt_payments_workspace_idx').on(table.workspaceId, table.createdAt),
  debtIdx: index('due_debt_payments_debt_idx').on(table.dueDebtId, table.paidAt),
  idempotencyUnique: uniqueIndex('due_debt_payments_idempotency_unique').on(table.workspaceId, table.idempotencyKey),
  amountPositive: check('due_debt_payments_amount_positive', sql`${table.amountMinor} > 0`),
}));


export const monthlyBudgets = pgTable('monthly_budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  monthStart: date('month_start').notNull(),
  limitMinor: bigint('limit_minor', { mode: 'number' }).notNull(),
  carryForward: boolean('carry_forward').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  workspaceMonthIdx: index('monthly_budgets_workspace_month_idx').on(table.workspaceId, table.monthStart),
  categoryMonthUnique: uniqueIndex('monthly_budgets_category_month_unique').on(table.workspaceId, table.categoryId, table.monthStart),
  limitPositive: check('monthly_budgets_limit_positive', sql`${table.limitMinor} > 0`),
}));

export const recurringTransactions = pgTable('recurring_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  transactionType: text('transaction_type').notNull(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  frequency: text('frequency').notNull(),
  nextRun: date('next_run').notNull(),
  lastGeneratedFor: date('last_generated_for'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  workspaceNextRunIdx: index('recurring_transactions_workspace_next_run_idx').on(table.workspaceId, table.nextRun),
  typeValid: check('recurring_transactions_type_valid', sql`${table.transactionType} in ('income', 'expense')`),
  frequencyValid: check('recurring_transactions_frequency_valid', sql`${table.frequency} in ('weekly', 'monthly', 'yearly')`),
  amountPositive: check('recurring_transactions_amount_positive', sql`${table.amountMinor} > 0`),
}));

export const walletReconciliations = pgTable('wallet_reconciliations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  recordedMinor: bigint('recorded_minor', { mode: 'number' }).notNull(),
  actualMinor: bigint('actual_minor', { mode: 'number' }).notNull(),
  varianceMinor: bigint('variance_minor', { mode: 'number' }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceCreatedIdx: index('wallet_reconciliations_workspace_created_idx').on(table.workspaceId, table.createdAt),
}));

export const financeAuditEvents = pgTable('finance_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceCreatedIdx: index('finance_audit_events_workspace_created_idx').on(table.workspaceId, table.createdAt),
}));
