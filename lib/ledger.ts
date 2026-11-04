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

async function getOrCreateWalletAccount(
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

  // Existing wallets may predate journal posting. Capture their cutover balance
  // once as an opening position instead of fabricating historical transactions.
  const [priorEntry] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.workspaceId, owner.workspaceId),
      eq(ledgerEntries.ledgerAccountId, account.id),
    )).limit(1);

  const openingBalance = Number(wallet.currentBalanceMinor);
  if (!priorEntry && openingBalance !== 0) {
    const equity = await getOrCreateSystemAccount(tx, owner, 'equity', 'Opening balance equity');
    const [openingTransaction] = await tx.insert(transactions).values({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      transactionType: 'adjustment',
      walletId: wallet.id,
      amountMinor: Math.abs(openingBalance),
      description: 'Opening balance (ledger cutover)',
      occurredAt: new Date(),
    }).returning();

    const positiveNormalBalance = expectedType === 'asset' ? openingBalance > 0 : openingBalance > 0;
    const walletDebit = expectedType === 'asset' ? positiveNormalBalance : !positiveNormalBalance;
    const amount = Math.abs(openingBalance);
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
  const sourceAccount = await getOrCreateWalletAccount(tx, owner, sourceWallet);

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
    const destinationAccount = await getOrCreateWalletAccount(tx, owner, destinationWallet);
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
    const isLiability = sourceWallet.walletType === 'credit_card';
    lines = isLiability
      ? [
          { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id, ledgerAccountId: sourceAccount.id, debitMinor: transaction.amountMinor, creditMinor: 0 },
          { workspaceId: owner.workspaceId, userId: owner.userId, transactionId: transaction.id, ledgerAccountId: incomeAccount.id, debitMinor: 0, creditMinor: transaction.amountMinor },
        ]
      : [
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
