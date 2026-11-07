import { pgTable, uuid, text, bigint, timestamp, index, uniqueIndex, check, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** A private finance workspace owned directly by one Clerk user. */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  workspaceType: text('workspace_type').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  syncVersion: bigint('sync_version', { mode: 'bigint' }).notNull().default(0n),
}, (table) => ({
  ownerTypeUnique: uniqueIndex('workspaces_user_type_unique').on(table.userId, table.workspaceType),
  ownerIdx: index('workspaces_user_idx').on(table.userId),
  workspaceTypeValid: check('workspaces_workspace_type_check', sql`${table.workspaceType} in ('personal', 'family', 'business')`),
}));

export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(), // Clerk user id
  displayName: text('display_name'),
  currency: text('currency').notNull().default('BDT'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  walletType: text('wallet_type').notNull(),
  currency: text('currency').notNull().default('BDT'),
  openingBalanceMinor: bigint('opening_balance_minor', { mode: 'number' }).notNull().default(0),
  currentBalanceMinor: bigint('current_balance_minor', { mode: 'number' }).notNull().default(0),
  creditLimitMinor: bigint('credit_limit_minor', { mode: 'number' }).notNull().default(0),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('wallets_workspace_idx').on(table.workspaceId),
}));

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  categoryType: text('category_type').notNull(),
  parentId: uuid('parent_id'),
  color: text('color').notNull().default('#0f766e'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('categories_workspace_idx').on(table.workspaceId),
}));

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull(),
  transactionType: text('transaction_type').notNull(),
  walletId: uuid('wallet_id').notNull(),
  destinationWalletId: uuid('destination_wallet_id'),
  categoryId: uuid('category_id'),
  idempotencyKey: text('idempotency_key'),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  description: text('description').notNull(),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  voidedAt: timestamp('voided_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceDateIdx: index('transactions_workspace_date_idx').on(table.workspaceId, table.occurredAt),
  activeDateIdx: index('transactions_workspace_active_date_idx').on(table.workspaceId, table.occurredAt.desc()).where(sql`${table.voidedAt} IS NULL`),
  workspaceUserActiveDateIdx: index('transactions_workspace_user_active_date_idx').on(table.workspaceId, table.userId, table.occurredAt.desc()).where(sql`${table.voidedAt} IS NULL`),
  idempotencyUnique: uniqueIndex('transactions_workspace_idempotency_unique').on(table.workspaceId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
}));

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull(),
  walletId: uuid('wallet_id'),
  accountType: text('account_type').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('ledger_accounts_workspace_idx').on(table.workspaceId),
  walletUnique: uniqueIndex('ledger_accounts_workspace_wallet_unique').on(table.workspaceId, table.walletId).where(sql`${table.walletId} IS NOT NULL`),
}));

export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull(),
  transactionId: uuid('transaction_id').notNull(),
  ledgerAccountId: uuid('ledger_account_id').notNull(),
  debitMinor: bigint('debit_minor', { mode: 'number' }).notNull().default(0),
  creditMinor: bigint('credit_minor', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('ledger_entries_workspace_idx').on(table.workspaceId),
  workspaceAccountIdx: index('ledger_entries_workspace_account_idx').on(table.workspaceId, table.ledgerAccountId),
  transactionIdx: index('ledger_entries_transaction_idx').on(table.transactionId),
  oneSide: check('ledger_entries_one_side_check', sql`(${table.debitMinor} > 0 AND ${table.creditMinor} = 0) OR (${table.creditMinor} > 0 AND ${table.debitMinor} = 0)`),
}));


/** Transactionally captured, workspace-scoped feed for reliable offline replication. */
export const financeSyncChanges = pgTable('finance_sync_changes', {
  cursor: bigint('cursor', { mode: 'bigint' }).notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  operation: text('operation').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  cursorPk: primaryKey({ columns: [table.workspaceId, table.cursor], name: 'finance_sync_changes_pkey' }),
  ownerCursorIdx: index('finance_sync_changes_owner_cursor_idx').on(table.userId, table.workspaceId, table.cursor),
}));
