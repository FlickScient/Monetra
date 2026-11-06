import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { categories, ledgerAccounts, ledgerEntries, transactions, wallets, workspaces } from '@/db/schema';
import {
  dueDebts, dueDebtPayments, financeAuditEvents, goalAllocationEvents,
  goalAllocations, monthlyBudgets, recurringTransactions, savingsGoals, walletReconciliations,
} from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { isDateOnly, isUuid } from '@/lib/validation';

const TABLE_KEYS = [
  'wallets', 'categories', 'transactions', 'ledgerAccounts', 'ledgerEntries',
  'savingsGoals', 'goalAllocations', 'goalAllocationEvents', 'dueDebts',
  'dueDebtPayments', 'monthlyBudgets', 'recurringTransactions',
  'walletReconciliations', 'financeAuditEvents',
] as const;

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
function validTimestamp(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}
function timestamp(value: unknown): Date {
  return new Date(String(value));
}
function withOwner(row: Record<string, any>, workspaceId: string, userId: string, fields: string[] = []) {
  const result: Record<string, any> = { ...row, workspaceId, userId };
  for (const field of fields) {
    if (result[field] !== null && result[field] !== undefined) result[field] = timestamp(result[field]);
  }
  return result;
}

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    const [workspace] = await db.select({ name: workspaces.name, type: workspaces.workspaceType })
      .from(workspaces).where(and(eq(workspaces.id, context.workspaceId), eq(workspaces.userId, context.userId))).limit(1);
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const [walletRows, categoryRows, transactionRows, accountRows, entryRows, goalRows, allocationRows, allocationEventRows, debtRows, paymentRows, budgetRows, recurringRows, reconciliationRows, auditRows] = await Promise.all([
      db.select().from(wallets).where(and(eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId))),
      db.select().from(categories).where(and(eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId))),
      db.select().from(transactions).where(and(eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId))),
      db.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.workspaceId, context.workspaceId), eq(ledgerAccounts.userId, context.userId))),
      db.select().from(ledgerEntries).where(and(eq(ledgerEntries.workspaceId, context.workspaceId), eq(ledgerEntries.userId, context.userId))),
      db.select().from(savingsGoals).where(and(eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.userId, context.userId))),
      db.select().from(goalAllocations).where(eq(goalAllocations.workspaceId, context.workspaceId)),
      db.select().from(goalAllocationEvents).where(and(eq(goalAllocationEvents.workspaceId, context.workspaceId), eq(goalAllocationEvents.userId, context.userId))),
      db.select().from(dueDebts).where(and(eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId))),
      db.select().from(dueDebtPayments).where(and(eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId))),
      db.select().from(monthlyBudgets).where(and(eq(monthlyBudgets.workspaceId, context.workspaceId), eq(monthlyBudgets.userId, context.userId))),
      db.select().from(recurringTransactions).where(and(eq(recurringTransactions.workspaceId, context.workspaceId), eq(recurringTransactions.userId, context.userId))),
      db.select().from(walletReconciliations).where(and(eq(walletReconciliations.workspaceId, context.workspaceId), eq(walletReconciliations.userId, context.userId))),
      db.select().from(financeAuditEvents).where(and(eq(financeAuditEvents.workspaceId, context.workspaceId), eq(financeAuditEvents.userId, context.userId))),
    ]);

    const backup = {
      app: 'Monetra',
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace,
      data: {
        wallets: walletRows, categories: categoryRows, transactions: transactionRows,
        ledgerAccounts: accountRows, ledgerEntries: entryRows, savingsGoals: goalRows,
        goalAllocations: allocationRows, goalAllocationEvents: allocationEventRows,
        dueDebts: debtRows, dueDebtPayments: paymentRows, monthlyBudgets: budgetRows,
        recurringTransactions: recurringRows, walletReconciliations: reconciliationRows,
        financeAuditEvents: auditRows,
      },
    };
    const body = JSON.stringify(backup, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="monetra-backup-' + date + '.json"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('MONETRA_BACKUP_EXPORT_ERROR:', error);
    return NextResponse.json({ error: 'Unable to create workspace backup' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 4_000_000) return NextResponse.json({ error: 'Backup file is larger than the 4 MB restore limit' }, { status: 413 });
    let backup: any;
    try { backup = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Backup file is not valid JSON' }, { status: 400 }); }
    if (!isRecord(backup) || backup.app !== 'Monetra' || backup.backupVersion !== 1 ||
        !isRecord(backup.workspace) || !isRecord(backup.data)) {
      return NextResponse.json({ error: 'This is not a supported Monetra backup file' }, { status: 400 });
    }

    const data = backup.data as Record<string, unknown>;
    const rows: Record<string, Record<string, any>[]> = {};
    let totalRows = 0;
    for (const key of TABLE_KEYS) {
      const value = data[key];
      if (!Array.isArray(value) || value.length > 10000 || value.some((row) => !isRecord(row) || !isUuid(row.id))) {
        return NextResponse.json({ error: 'Backup contains invalid ' + key + ' data' }, { status: 400 });
      }
      rows[key] = value;
      totalRows += value.length;
    }
    if (totalRows > 50000) return NextResponse.json({ error: 'Backup contains too many records to restore safely' }, { status: 413 });

    const ids = (key: typeof TABLE_KEYS[number]) => new Set(rows[key].map((row) => row.id));
    const walletIds = ids('wallets');
    const categoryIds = ids('categories');
    const transactionIds = ids('transactions');
    const accountIds = ids('ledgerAccounts');
    const goalIds = ids('savingsGoals');
    const debtIds = ids('dueDebts');
    const uniqueIds = TABLE_KEYS.every((key) => ids(key).size === rows[key].length);
    if (!uniqueIds) return NextResponse.json({ error: 'Backup contains duplicate record IDs' }, { status: 400 });

    const validMoneyFields: [typeof TABLE_KEYS[number], string, boolean][] = [
      ['wallets', 'openingBalanceMinor', false], ['wallets', 'currentBalanceMinor', false], ['wallets', 'creditLimitMinor', false],
      ['transactions', 'amountMinor', true], ['ledgerEntries', 'debitMinor', false], ['ledgerEntries', 'creditMinor', false],
      ['savingsGoals', 'targetMinor', true], ['goalAllocations', 'amountMinor', true],
      ['goalAllocationEvents', 'amountMinor', true], ['dueDebts', 'principalMinor', true],
      ['dueDebtPayments', 'amountMinor', true], ['monthlyBudgets', 'limitMinor', true],
      ['recurringTransactions', 'amountMinor', true], ['walletReconciliations', 'recordedMinor', false],
      ['walletReconciliations', 'actualMinor', false], ['walletReconciliations', 'varianceMinor', false],
    ];
    for (const [table, field, positive] of validMoneyFields) {
      if (rows[table].some((row) => !safeInteger(row[field]) || (positive && row[field] <= 0))) {
        return NextResponse.json({ error: 'Backup contains an invalid amount in ' + table }, { status: 400 });
      }
    }

    if (rows.wallets.some((row) => typeof row.name !== 'string' || !row.name.trim() || typeof row.currency !== 'string') ||
        rows.categories.some((row) => typeof row.name !== 'string' || !['income', 'expense'].includes(row.categoryType) ||
          (row.parentId && !rows.categories.some((parent) => parent.id === row.parentId))) ||
        rows.transactions.some((row) => !['income', 'expense', 'transfer', 'adjustment'].includes(row.transactionType) ||
          !walletIds.has(row.walletId) || (row.destinationWalletId && !walletIds.has(row.destinationWalletId)) ||
          (row.categoryId && !categoryIds.has(row.categoryId)) || !validTimestamp(row.occurredAt) ||
          (row.voidedAt !== null && row.voidedAt !== undefined && !validTimestamp(row.voidedAt)) ||
          (row.transactionType === 'transfer' && (!row.destinationWalletId || row.destinationWalletId === row.walletId)) ||
          (row.transactionType !== 'transfer' && row.destinationWalletId))) ||
        rows.ledgerAccounts.some((row) => row.walletId && !walletIds.has(row.walletId)) ||
        rows.ledgerEntries.some((row) => !transactionIds.has(row.transactionId) || !accountIds.has(row.ledgerAccountId) || !safeInteger(row.debitMinor) || !safeInteger(row.creditMinor) || !((row.debitMinor > 0 && row.creditMinor === 0) || (row.creditMinor > 0 && row.debitMinor === 0))) ||
        rows.goalAllocations.some((row) => !goalIds.has(row.goalId) || !walletIds.has(row.walletId)) ||
        rows.goalAllocationEvents.some((row) => !goalIds.has(row.goalId) || !walletIds.has(row.walletId) || !['allocate', 'release'].includes(row.action)) ||
        rows.dueDebts.some((row) => !['receivable', 'payable'].includes(row.direction) ||
          typeof row.counterpartyName !== 'string' || !row.counterpartyName.trim() ||
          typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency) ||
          !['open', 'partially_settled', 'settled', 'archived'].includes(row.status) ||
          !Number.isSafeInteger(row.annualRateBps) || row.annualRateBps < 0) ||
        rows.dueDebtPayments.some((row) => !debtIds.has(row.dueDebtId) || !validTimestamp(row.paidAt) ||
          typeof row.idempotencyKey !== 'string' || !row.idempotencyKey.trim()) ||
        rows.monthlyBudgets.some((row) => !categoryIds.has(row.categoryId) || !isDateOnly(row.monthStart)) ||
        rows.recurringTransactions.some((row) => !walletIds.has(row.walletId) || (row.categoryId && !categoryIds.has(row.categoryId)) || !isDateOnly(row.nextRun)) ||
        rows.walletReconciliations.some((row) => !walletIds.has(row.walletId))) {
      return NextResponse.json({ error: 'Backup has missing or mismatched record references' }, { status: 400 });
    }

    // The database enforces balanced journal lines. Validate the same invariant
    // before inserting so an invalid backup fails with a clear 400 response.
    const journalTotals = new Map<string, { debit: bigint; credit: bigint; count: number }>();
    for (const entry of rows.ledgerEntries) {
      const total = journalTotals.get(entry.transactionId) ?? { debit: BigInt(0), credit: BigInt(0), count: 0 };
      total.debit += BigInt(entry.debitMinor);
      total.credit += BigInt(entry.creditMinor);
      total.count += 1;
      journalTotals.set(entry.transactionId, total);
    }
    for (const total of journalTotals.values()) {
      if (total.debit !== total.credit || total.count < 2) {
        return NextResponse.json({ error: 'Backup contains an unbalanced or incomplete ledger journal' }, { status: 400 });
      }
    }

    // Wallet-linked ledger accounts must be unique and use the correct normal
    // balance type. Their journal balance must equal the wallet's stored balance.
    const walletLedgerAccounts = new Map<string, Record<string, any>>();
    const ledgerAccountById = new Map(rows.ledgerAccounts.map((account) => [account.id, account]));
    for (const account of rows.ledgerAccounts) {
      if (account.walletId) {
        const wallet = rows.wallets.find((item) => item.id === account.walletId);
        const expectedType = wallet?.walletType === 'credit_card' ? 'liability' : 'asset';
        if (!wallet || account.accountType !== expectedType || walletLedgerAccounts.has(account.walletId)) {
          return NextResponse.json({ error: 'Backup contains an invalid or duplicate wallet ledger account' }, { status: 400 });
        }
        walletLedgerAccounts.set(account.walletId, account);
      } else if (!['income', 'expense', 'equity'].includes(account.accountType)) {
        return NextResponse.json({ error: 'Backup contains an invalid system ledger account' }, { status: 400 });
      }
    }
    const walletLedgerBalances = new Map<string, { debit: bigint; credit: bigint }>();
    for (const entry of rows.ledgerEntries) {
      const account = ledgerAccountById.get(entry.ledgerAccountId);
      if (!account) {
        return NextResponse.json({ error: 'Backup contains a journal entry with a missing ledger account' }, { status: 400 });
      }
      if (account.walletId) {
        const balance = walletLedgerBalances.get(account.walletId) ?? { debit: BigInt(0), credit: BigInt(0) };
        balance.debit += BigInt(entry.debitMinor);
        balance.credit += BigInt(entry.creditMinor);
        walletLedgerBalances.set(account.walletId, balance);
      }
    }
    for (const [walletId, account] of walletLedgerAccounts) {
      const wallet = rows.wallets.find((item) => item.id === walletId)!;
      const balance = walletLedgerBalances.get(walletId) ?? { debit: BigInt(0), credit: BigInt(0) };
      const ledgerBalance = account.accountType === 'liability'
        ? balance.credit - balance.debit
        : balance.debit - balance.credit;
      if (ledgerBalance !== BigInt(wallet.currentBalanceMinor)) {
        return NextResponse.json({ error: 'Backup wallet balances do not match their ledger history' }, { status: 400 });
      }
    }

    // Reconcile repayment history against each debt's principal and stored status.
    const paidByDebt = new Map<string, bigint>();
    for (const payment of rows.dueDebtPayments) {
      const paid = (paidByDebt.get(payment.dueDebtId) ?? BigInt(0)) + BigInt(payment.amountMinor);
      paidByDebt.set(payment.dueDebtId, paid);
    }
    for (const debt of rows.dueDebts) {
      const paid = paidByDebt.get(debt.id) ?? BigInt(0);
      const principal = BigInt(debt.principalMinor);
      if (paid > principal) {
        return NextResponse.json({ error: 'Backup contains repayments greater than the original debt principal' }, { status: 400 });
      }
      if (debt.status !== 'archived') {
        const expected = paid === BigInt(0) ? 'open' : paid === principal ? 'settled' : 'partially_settled';
        if (debt.status !== expected) {
          return NextResponse.json({ error: 'Backup contains a Due & Debt status that does not match its payment history' }, { status: 400 });
        }
      }
    }

    // Validate current goal reservations against targets, wallet balances,
    // and the allocation/release event history.
    const goalById = new Map(rows.savingsGoals.map((goal) => [goal.id, goal]));
    const walletById = new Map(rows.wallets.map((wallet) => [wallet.id, wallet]));
    const allocationTotalsByGoal = new Map<string, bigint>();
    const allocationTotalsByWallet = new Map<string, bigint>();
    const allocationByPair = new Map<string, bigint>();
    const eventTotalsByPair = new Map<string, bigint>();
    for (const allocation of rows.goalAllocations) {
      const goal = goalById.get(allocation.goalId);
      const wallet = walletById.get(allocation.walletId);
      const amount = BigInt(allocation.amountMinor);
      if (!goal || !wallet || goal.currency !== wallet.currency || wallet.walletType === 'credit_card') {
        return NextResponse.json({ error: 'Backup contains an allocation linked to an incompatible goal or wallet' }, { status: 400 });
      }
      const pair = allocation.goalId + ':' + allocation.walletId;
      allocationByPair.set(pair, amount);
      allocationTotalsByGoal.set(allocation.goalId, (allocationTotalsByGoal.get(allocation.goalId) ?? BigInt(0)) + amount);
      allocationTotalsByWallet.set(allocation.walletId, (allocationTotalsByWallet.get(allocation.walletId) ?? BigInt(0)) + amount);
    }
    for (const event of rows.goalAllocationEvents) {
      const pair = event.goalId + ':' + event.walletId;
      const change = BigInt(event.amountMinor) * (event.action === 'allocate' ? BigInt(1) : BigInt(-1));
      eventTotalsByPair.set(pair, (eventTotalsByPair.get(pair) ?? BigInt(0)) + change);
    }
    for (const [goalId, total] of allocationTotalsByGoal) {
      const goal = goalById.get(goalId)!;
      if (total > BigInt(goal.targetMinor)) {
        return NextResponse.json({ error: 'Backup contains savings allocations above a goal target' }, { status: 400 });
      }
    }
    for (const [walletId, total] of allocationTotalsByWallet) {
      const wallet = walletById.get(walletId)!;
      if (total > BigInt(wallet.currentBalanceMinor)) {
        return NextResponse.json({ error: 'Backup contains savings allocations above a wallet balance' }, { status: 400 });
      }
    }
    const allAllocationPairs = new Set([...allocationByPair.keys(), ...eventTotalsByPair.keys()]);
    for (const pair of allAllocationPairs) {
      if ((allocationByPair.get(pair) ?? BigInt(0)) !== (eventTotalsByPair.get(pair) ?? BigInt(0))) {
        return NextResponse.json({ error: 'Backup savings allocation history does not match current allocations' }, { status: 400 });
      }
    }

    const result = await db.transaction(async (tx) => {
      const [workspace] = await tx.select().from(workspaces)
        .where(and(eq(workspaces.id, context.workspaceId), eq(workspaces.userId, context.userId)))
        .for('update');
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
      if (workspace.workspaceType !== backup.workspace.type) throw new Error('WORKSPACE_TYPE_MISMATCH');

      const existingChecks = [
        await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: savingsGoals.id }).from(savingsGoals).where(eq(savingsGoals.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: goalAllocations.id }).from(goalAllocations).where(eq(goalAllocations.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: goalAllocationEvents.id }).from(goalAllocationEvents).where(eq(goalAllocationEvents.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: dueDebts.id }).from(dueDebts).where(eq(dueDebts.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: dueDebtPayments.id }).from(dueDebtPayments).where(eq(dueDebtPayments.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: monthlyBudgets.id }).from(monthlyBudgets).where(eq(monthlyBudgets.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: recurringTransactions.id }).from(recurringTransactions).where(eq(recurringTransactions.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: walletReconciliations.id }).from(walletReconciliations).where(eq(walletReconciliations.workspaceId, context.workspaceId)).limit(1),
        await tx.select({ id: financeAuditEvents.id }).from(financeAuditEvents).where(eq(financeAuditEvents.workspaceId, context.workspaceId)).limit(1),
      ];
      if (existingChecks.some((result) => result.length > 0)) throw new Error('WORKSPACE_NOT_EMPTY');

      await tx.delete(categories).where(eq(categories.workspaceId, context.workspaceId));

      const ownerRows = (key: typeof TABLE_KEYS[number], dateFields: string[] = []) =>
        rows[key].map((row) => withOwner(row, context.workspaceId, context.userId, dateFields));
      const plainRows = (key: typeof TABLE_KEYS[number], dateFields: string[] = []) =>
        rows[key].map((row) => {
          const result: Record<string, any> = { ...row, workspaceId: context.workspaceId };
          for (const field of dateFields) if (result[field]) result[field] = timestamp(result[field]);
          return result;
        });
      const insert = async (table: any, values: any[]) => { if (values.length) await tx.insert(table).values(values); };

      await insert(categories, ownerRows('categories'));
      await insert(wallets, ownerRows('wallets', ['createdAt', 'updatedAt']));
      await insert(transactions, ownerRows('transactions', ['occurredAt', 'voidedAt', 'createdAt']));
      await insert(ledgerAccounts, ownerRows('ledgerAccounts', ['createdAt']));
      await insert(ledgerEntries, ownerRows('ledgerEntries', ['createdAt']));
      await insert(savingsGoals, ownerRows('savingsGoals', ['createdAt', 'updatedAt']));
      await insert(dueDebts, ownerRows('dueDebts', ['createdAt', 'updatedAt']));
      await insert(goalAllocations, plainRows('goalAllocations', ['createdAt', 'updatedAt']));
      await insert(goalAllocationEvents, ownerRows('goalAllocationEvents', ['createdAt']));
      await insert(dueDebtPayments, ownerRows('dueDebtPayments', ['paidAt', 'createdAt']));
      await insert(monthlyBudgets, ownerRows('monthlyBudgets', ['createdAt', 'updatedAt']));
      await insert(recurringTransactions, ownerRows('recurringTransactions', ['createdAt', 'updatedAt']));
      await insert(walletReconciliations, ownerRows('walletReconciliations', ['createdAt']));
      await insert(financeAuditEvents, ownerRows('financeAuditEvents', ['createdAt']));
      return { restoredRecords: totalRows };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'WORKSPACE_NOT_FOUND') return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    if (code === 'WORKSPACE_TYPE_MISMATCH') return NextResponse.json({ error: 'Restore this backup into a workspace of the same type' }, { status: 400 });
    if (code === 'WORKSPACE_NOT_EMPTY') return NextResponse.json({ error: 'Restore is only allowed into an empty workspace. Export a backup first; existing records will never be overwritten.' }, { status: 409 });
    console.error('MONETRA_BACKUP_RESTORE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to restore this backup. No partial changes were saved.' }, { status: 500 });
  }
}