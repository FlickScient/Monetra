import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  categories, financeSyncChanges, ledgerAccounts, ledgerEntries, transactions, wallets, workspaces,
} from '@/db/schema';
import {
  dueDebts, dueDebtPayments, financeAuditEvents, goalAllocationEvents,
  goalAllocations, monthlyBudgets, recurringTransactions, savingsGoals, walletReconciliations,
} from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';

/**
 * Consistent first-install snapshot. The snapshot and cursor are read in one
 * repeatable-read transaction so the next pull cannot miss a concurrent write.
 */
export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  try {
    const snapshot = await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);

      const [workspace] = await tx.select({
        id: workspaces.id,
        name: workspaces.name,
        type: workspaces.workspaceType,
        syncVersion: workspaces.syncVersion,
      }).from(workspaces).where(and(
        eq(workspaces.id, context.workspaceId),
        eq(workspaces.userId, context.userId),
      )).limit(1);

      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

      const [
        walletRows, categoryRows, transactionRows, accountRows, entryRows,
        goalRows, allocationRows, allocationEventRows, debtRows, paymentRows,
        budgetRows, recurringRows, reconciliationRows, auditRows,
      ] = await Promise.all([
        tx.select().from(wallets).where(and(eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId))),
        tx.select().from(categories).where(and(eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId))),
        tx.select().from(transactions).where(and(eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId))),
        tx.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.workspaceId, context.workspaceId), eq(ledgerAccounts.userId, context.userId))),
        tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.workspaceId, context.workspaceId), eq(ledgerEntries.userId, context.userId))),
        tx.select().from(savingsGoals).where(and(eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.userId, context.userId))),
        tx.select().from(goalAllocations).where(eq(goalAllocations.workspaceId, context.workspaceId)),
        tx.select().from(goalAllocationEvents).where(and(eq(goalAllocationEvents.workspaceId, context.workspaceId), eq(goalAllocationEvents.userId, context.userId))),
        tx.select().from(dueDebts).where(and(eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId))),
        tx.select().from(dueDebtPayments).where(and(eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId))),
        tx.select().from(monthlyBudgets).where(and(eq(monthlyBudgets.workspaceId, context.workspaceId), eq(monthlyBudgets.userId, context.userId))),
        tx.select().from(recurringTransactions).where(and(eq(recurringTransactions.workspaceId, context.workspaceId), eq(recurringTransactions.userId, context.userId))),
        tx.select().from(walletReconciliations).where(and(eq(walletReconciliations.workspaceId, context.workspaceId), eq(walletReconciliations.userId, context.userId))),
        tx.select().from(financeAuditEvents).where(and(eq(financeAuditEvents.workspaceId, context.workspaceId), eq(financeAuditEvents.userId, context.userId))),
      ]);

      return {
        app: 'Monetra',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        workspace: { id: workspace.id, name: workspace.name, type: workspace.type },
        cursor: String(workspace.syncVersion),
        data: {
          wallets: walletRows,
          categories: categoryRows,
          transactions: transactionRows,
          ledgerAccounts: accountRows,
          ledgerEntries: entryRows,
          savingsGoals: goalRows,
          goalAllocations: allocationRows,
          goalAllocationEvents: allocationEventRows,
          dueDebts: debtRows,
          dueDebtPayments: paymentRows,
          monthlyBudgets: budgetRows,
          recurringTransactions: recurringRows,
          walletReconciliations: reconciliationRows,
          financeAuditEvents: auditRows,
        },
      };
    });

    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKSPACE_NOT_FOUND') {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    console.error('MONETRA_SYNC_BOOTSTRAP_ERROR:', error);
    return NextResponse.json({ error: 'Unable to create a consistent workspace snapshot' }, { status: 500 });
  }
}
