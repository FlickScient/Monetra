import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { ledgerAccounts, ledgerEntries, transactions, wallets } from '@/db/schema';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type WalletRow = typeof wallets.$inferSelect;
type TransactionRow = typeof transactions.$inferSelect;
type WorkspaceOwner = { userId: string; workspaceId: string };

async function lockLedgerKey(tx: DbTransaction, workspaceId: string, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}), hashtext(${key}))`);
}

export async function ensureWalletLedgerAccount(
  tx: DbTransaction,
  owner: WorkspaceOwner,
  wallet: WalletRow,
) {
  await lockLedgerKey(tx, owner.workspaceId, `wallet:${wallet.id}`);
  let [account] = await tx.select().from(ledgerAccounts)
    .where(and(
      eq(ledgerAccounts.workspaceId, owner.workspaceId),
      eq(ledgerAccounts.walletId, wallet.id),
    )).limit(1);

  const expectedType = wallet.walletType === 'credit_card' ? 'liability' : 'asset';
  if (account && account.accountType !== expectedType) {
    throw new Error('LEDGER_ACCOUNT_TYPE_MISMATCH');
  }

  if (!account) {
    [account] = await tx.insert(ledgerAccounts).values({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      walletId: wallet.id,
      accountType: expectedType,
      name: `Wallet: ${wallet.name}`,
    }).returning();
  }
  if (!account) throw new Error('LEDGER_ACCOUNT_CREATE_FAILED');

  // Reconcile the journal to the wallet's persisted balance at cutover.
  // This preserves the live balance without inventing historical transaction detail.
  const [ledgerBalanceRow] = await tx.select({
    balance: expectedType === 'asset'
      ? sql<string>`(COALESCE(SUM(${ledgerEntries.debitMinor}), 0) - COALESCE(SUM(${ledgerEntries.creditMinor}), 0))::text`
      : sql<string>`(COALESCE(SUM(${ledgerEntries.creditMinor}), 0) - COALESCE(SUM(${ledgerEntries.debitMinor}), 0))::text`,
  }).from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.workspaceId, owner.workspaceId),
      eq(ledgerEntries.ledgerAccountId, account.id),
    ));

  if (!Number.isSafeInteger(wallet.currentBalanceMinor)) throw new Error('LEDGER_BALANCE_OUT_OF_RANGE');
  const balanceDifference = BigInt(wallet.currentBalanceMinor) - BigInt(ledgerBalanceRow?.balance ?? '0');
  if (balanceDifference !== BigInt(0)) {
    const absoluteDifference = balanceDifference < BigInt(0) ? -balanceDifference : balanceDifference;
    if (absoluteDifference > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('LEDGER_BALANCE_OUT_OF_RANGE');
    }

    const equity = await getOrCreateSystemAccount(tx, owner, 'equity', 'Opening balance equity');
    const amount = Number(absoluteDifference);
    const [openingTransaction] = await tx.insert(transactions).values({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      transactionType: 'adjustment',
      walletId: wallet.id,
      amountMinor: amount,
      description: 'Opening balance reconciliation',
      occurredAt: new Date(),
    }).returning();

    // Assets carry a debit-normal balance; liabilities carry a credit-normal balance.
    const walletDebit = expectedType === 'asset' ? balanceDifference > BigInt(0) : balanceDifference < BigInt(0);
    await tx.insert(ledgerEntries).values(walletDebit
      ? [
          { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: openingTransaction.id, ledgerAccountId: account.id, debitMinor: amount, creditMinor: 0 },
          { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: openingTransaction.id, ledgerAccountId: equity.id, debitMinor: 0, creditMinor: amount },
        ]
      : [
          { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: openingTransaction.id, ledgerAccountId: equity.id, debitMinor: amount, creditMinor: 0 },
          { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: openingTransaction.id, ledgerAccountId: account.id, debitMinor: 0, creditMinor: amount },
        ]);
  }

  return account;
}

async function getOrCreateSystemAccount(
  tx: DbTransaction,
  owner: WorkspaceOwner,
  accountType: 'income' | 'expense' | 'equity',
  name: string,
) {
  await lockLedgerKey(tx, owner.workspaceId, `system:${accountType}`);
  let [account] = await tx.select().from(ledgerAccounts)
    .where(and(
      eq(ledgerAccounts.workspaceId, owner.workspaceId),
      eq(ledgerAccounts.accountType, accountType),
      isNull(ledgerAccounts.walletId),
    )).limit(1);

  if (!account) {
    [account] = await tx.insert(ledgerAccounts).values({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      walletId: null,
      accountType,
      name,
    }).returning();
  }
  if (!account) throw new Error('LEDGER_SYSTEM_ACCOUNT_CREATE_FAILED');
  return account;
}

/** Post exactly two equal-and-opposite journal lines for each supported event. */
export async function postFinancialJournal(
  tx: DbTransaction,
  owner: WorkspaceOwner,
  transaction: TransactionRow,
  sourceWallet: WalletRow,
  destinationWallet?: WalletRow,
) {
  const sourceAccount = await ensureWalletLedgerAccount(tx, owner, sourceWallet);

  let lines: Array<{
    workspaceId: string;
    userId: string;
    transactionId: string;
    ledgerAccountId: string;
    debitMinor: number;
    creditMinor: number;
  }>;

  if (transaction.transactionType === 'transfer') {
    if (!destinationWallet) throw new Error('LEDGER_TRANSFER_DESTINATION_REQUIRED');
    const destinationAccount = await ensureWalletLedgerAccount(tx, owner, destinationWallet);
    if (sourceWallet.walletType === 'credit_card') throw new Error('LEDGER_INVALID_TRANSFER_SOURCE');

    // Paying a credit card debits its liability; moving between asset wallets
    // debits the destination asset. Both are balanced against the source asset.
    lines = [
      {
        workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id,
        ledgerAccountId: destinationAccount.id, debitMinor: transaction.amountMinor, creditMinor: 0,
      },
      {
        workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id,
        ledgerAccountId: sourceAccount.id, debitMinor: 0, creditMinor: transaction.amountMinor,
      },
    ];
  } else if (transaction.transactionType === 'income') {
    const incomeAccount = await getOrCreateSystemAccount(tx, owner, 'income', 'Income');
    // Debit increases an asset and reduces a liability, so the same journal
    // shape correctly handles income/refunds posted to either wallet type.
    lines = [
      { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id, ledgerAccountId: sourceAccount.id, debitMinor: transaction.amountMinor, creditMinor: 0 },
      { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id, ledgerAccountId: incomeAccount.id, debitMinor: 0, creditMinor: transaction.amountMinor },
    ];
  } else if (transaction.transactionType === 'expense') {
    const expenseAccount = await getOrCreateSystemAccount(tx, owner, 'expense', 'Expenses');
    lines = [
      { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id, ledgerAccountId: expenseAccount.id, debitMinor: transaction.amountMinor, creditMinor: 0 },
      { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id, ledgerAccountId: sourceAccount.id, debitMinor: 0, creditMinor: transaction.amountMinor },
    ];
  } else {
    throw new Error('LEDGER_UNSUPPORTED_TRANSACTION_TYPE');
  }

  const totalDebits = lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const totalCredits = lines.reduce((sum, line) => sum + line.creditMinor, 0);
  if (totalDebits !== totalCredits) throw new Error('LEDGER_UNBALANCED_JOURNAL');

  await tx.insert(ledgerEntries).values(lines);
}
