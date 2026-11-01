import { pgTable, uuid, text, bigint, timestamp, boolean } from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(), // Clerk user id
  displayName: text('display_name'),
  currency: text('currency').notNull().default('BDT'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
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
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  categoryType: text('category_type').notNull(),
  parentId: uuid('parent_id'),
  color: text('color').notNull().default('#0f766e'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  transactionType: text('transaction_type').notNull(),
  walletId: uuid('wallet_id').notNull(),
  destinationWalletId: uuid('destination_wallet_id'),
  categoryId: uuid('category_id'),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  description: text('description').notNull(),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  walletId: uuid('wallet_id'),
  accountType: text('account_type').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  transactionId: uuid('transaction_id').notNull(),
  ledgerAccountId: uuid('ledger_account_id').notNull(),
  debitMinor: bigint('debit_minor', { mode: 'number' }).notNull().default(0),
  creditMinor: bigint('credit_minor', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
