import { NextResponse } from 'next/server';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { categories, transactions, wallets } from '@/db/schema';
import { postFinancialJournal } from '@/lib/ledger';
import { financeAuditEvents, monthlyBudgets, recurringTransactions, walletReconciliations } from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { isDateOnly, isUuid } from '@/lib/validation';

const validMoney = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const monthDate = (value: Date) => new Date(value.getFullYear(), value.getMonth(), 1).toISOString().slice(0, 10);
function advanceRecurringDate(value: string, frequency: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (frequency === 'weekly') return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  const targetYear = frequency === 'yearly' ? year + 1 : year;
  const targetMonth = frequency === 'yearly' ? month - 1 : month;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  const now = new Date();
  const start = monthDate(now);
  const next = monthDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const previous = monthDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  try {
    const [budgetRows, spending, previousBudgets, previousSpending, recurringRows, walletRows, reconciliationRows, auditRows] = await Promise.all([
      db.select({ id: monthlyBudgets.id, categoryId: monthlyBudgets.categoryId, monthStart: monthlyBudgets.monthStart, limitMinor: monthlyBudgets.limitMinor, carryForward: monthlyBudgets.carryForward, categoryName: categories.name, categoryColor: categories.color })
        .from(monthlyBudgets).innerJoin(categories, eq(categories.id, monthlyBudgets.categoryId))
        .where(and(eq(monthlyBudgets.workspaceId, context.workspaceId), eq(monthlyBudgets.userId, context.userId), eq(monthlyBudgets.monthStart, start))),
      db.select({ categoryId: transactions.categoryId, totalMinor: sql<string>`coalesce(sum(${transactions.amountMinor}), 0)::text` })
        .from(transactions).where(and(eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), eq(transactions.transactionType, 'expense'), isNull(transactions.voidedAt), gte(transactions.occurredAt, new Date(start + 'T00:00:00')), lt(transactions.occurredAt, new Date(next + 'T00:00:00')))).groupBy(transactions.categoryId),
      db.select({ categoryId: monthlyBudgets.categoryId, limitMinor: monthlyBudgets.limitMinor, carryForward: monthlyBudgets.carryForward })
        .from(monthlyBudgets).where(and(eq(monthlyBudgets.workspaceId, context.workspaceId), eq(monthlyBudgets.userId, context.userId), eq(monthlyBudgets.monthStart, previous))),
      db.select({ categoryId: transactions.categoryId, totalMinor: sql<string>`coalesce(sum(${transactions.amountMinor}), 0)::text` })
        .from(transactions).where(and(eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), eq(transactions.transactionType, 'expense'), isNull(transactions.voidedAt), gte(transactions.occurredAt, new Date(previous + 'T00:00:00')), lt(transactions.occurredAt, new Date(start + 'T00:00:00')))).groupBy(transactions.categoryId),
      db.select({ id: recurringTransactions.id, transactionType: recurringTransactions.transactionType, walletId: recurringTransactions.walletId, categoryId: recurringTransactions.categoryId, description: recurringTransactions.description, amountMinor: recurringTransactions.amountMinor, frequency: recurringTransactions.frequency, nextRun: recurringTransactions.nextRun, enabled: recurringTransactions.enabled, walletName: wallets.name })
        .from(recurringTransactions).leftJoin(wallets, eq(wallets.id, recurringTransactions.walletId))
        .where(and(eq(recurringTransactions.workspaceId, context.workspaceId), eq(recurringTransactions.userId, context.userId))).orderBy(recurringTransactions.nextRun),
      db.select({ id: wallets.id, name: wallets.name, currency: wallets.currency, currentBalanceMinor: wallets.currentBalanceMinor })
        .from(wallets).where(and(eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId), eq(wallets.status, 'active'))),
      db.select({ id: walletReconciliations.id, walletId: walletReconciliations.walletId, recordedMinor: walletReconciliations.recordedMinor, actualMinor: walletReconciliations.actualMinor, varianceMinor: walletReconciliations.varianceMinor, note: walletReconciliations.note, createdAt: walletReconciliations.createdAt, walletName: wallets.name })
        .from(walletReconciliations).leftJoin(wallets, eq(wallets.id, walletReconciliations.walletId))
        .where(and(eq(walletReconciliations.workspaceId, context.workspaceId), eq(walletReconciliations.userId, context.userId))).orderBy(desc(walletReconciliations.createdAt)).limit(30),
      db.select().from(financeAuditEvents).where(and(eq(financeAuditEvents.workspaceId, context.workspaceId), eq(financeAuditEvents.userId, context.userId))).orderBy(desc(financeAuditEvents.createdAt)).limit(40),
    ]);
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const trends = await db.select({
      month: sql<string>`to_char(date_trunc('month', ${transactions.occurredAt}), 'YYYY-MM')`,
      incomeMinor: sql<string>`coalesce(sum(case when ${transactions.transactionType} = 'income' then ${transactions.amountMinor} else 0 end), 0)::text`,
      expenseMinor: sql<string>`coalesce(sum(case when ${transactions.transactionType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)::text`,
    }).from(transactions).where(and(
      eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId),
      isNull(transactions.voidedAt), gte(transactions.occurredAt, trendStart), lt(transactions.occurredAt, new Date(next + 'T00:00:00')),
    )).groupBy(sql`date_trunc('month', ${transactions.occurredAt})`).orderBy(sql`date_trunc('month', ${transactions.occurredAt})`);
    const categoryBreakdown = await db.select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      color: categories.color,
      totalMinor: sql<string>`coalesce(sum(${transactions.amountMinor}), 0)::text`,
    }).from(transactions).leftJoin(categories, eq(categories.id, transactions.categoryId)).where(and(
      eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId),
      eq(transactions.transactionType, 'expense'), isNull(transactions.voidedAt),
      gte(transactions.occurredAt, new Date(start + 'T00:00:00')), lt(transactions.occurredAt, new Date(next + 'T00:00:00')),
    )).groupBy(transactions.categoryId, categories.name, categories.color).orderBy(sql`sum(${transactions.amountMinor}) desc`).limit(6);
    const spent = new Map(spending.map(row => [row.categoryId || '', Number(row.totalMinor)]));
    const previousSpent = new Map(previousSpending.map(row => [row.categoryId || '', Number(row.totalMinor)]));
    const previousBudget = new Map(previousBudgets.map(row => [row.categoryId, row]));
    return NextResponse.json({
      monthStart: start,
      trends: trends.map(row => ({ month: row.month, incomeMinor: Number(row.incomeMinor), expenseMinor: Number(row.expenseMinor) })),
      categoryBreakdown: categoryBreakdown.map(row => ({ categoryId: row.categoryId, name: row.categoryName || 'Uncategorized', color: row.color || '#87928a', totalMinor: Number(row.totalMinor) })),
      budgets: budgetRows.map(row => { const prior = previousBudget.get(row.categoryId); const carryInMinor = row.carryForward && prior ? Math.max(0, Number(prior.limitMinor) - (previousSpent.get(row.categoryId) || 0)) : 0; return { ...row, carryInMinor, spentMinor: spent.get(row.categoryId) || 0 }; }),
      recurring: recurringRows,
      wallets: walletRows,
      reconciliations: reconciliationRows,
      audit: auditRows,
    });
  } catch (error) {
    console.error('MONETRA_FINANCE_TOOLS_GET_ERROR:', error);
    return NextResponse.json({ error: 'Unable to load finance tools' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const now = new Date();
  try {
    if (body.kind === 'recurring-run') {
      const { id } = body;
      if (!isUuid(id)) return NextResponse.json({ error: 'Valid recurring item ID is required' }, { status: 400 });
      const result = await db.transaction(async tx => {
        const [schedule] = await tx.select().from(recurringTransactions)
          .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.workspaceId, context.workspaceId), eq(recurringTransactions.userId, context.userId), eq(recurringTransactions.enabled, true))).for('update');
        if (!schedule) throw new Error('RECURRING_NOT_FOUND');
        const today = new Date().toISOString().slice(0, 10);
        if (schedule.nextRun > today) throw new Error('RECURRING_NOT_DUE');
        const idempotencyKey = `recurring:${schedule.id}:${schedule.nextRun}`;
        const [prior] = await tx.select().from(transactions)
          .where(and(eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), eq(transactions.idempotencyKey, idempotencyKey))).limit(1);
        if (!prior) {
          const [wallet] = await tx.select().from(wallets)
            .where(and(eq(wallets.id, schedule.walletId), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId), eq(wallets.status, 'active'))).for('update');
          if (!wallet) throw new Error('RECURRING_WALLET_UNAVAILABLE');
          if (schedule.categoryId) {
            const [category] = await tx.select().from(categories).where(and(eq(categories.id, schedule.categoryId), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId), eq(categories.categoryType, schedule.transactionType as 'income' | 'expense'))).limit(1);
            if (!category) throw new Error('RECURRING_CATEGORY_INVALID');
          }
          const isCreditCard = wallet.walletType === 'credit_card';
          if (!Number.isSafeInteger(Number(wallet.currentBalanceMinor)) || !Number.isSafeInteger(Number(wallet.currentBalanceMinor) + Number(schedule.amountMinor))) throw new Error('RECURRING_BALANCE_RANGE');
          if (isCreditCard && schedule.transactionType === 'expense' && Number(wallet.creditLimitMinor) > 0 && Number(wallet.currentBalanceMinor) + Number(schedule.amountMinor) > Number(wallet.creditLimitMinor)) throw new Error('RECURRING_CREDIT_LIMIT');
          if (isCreditCard && schedule.transactionType === 'income' && Number(wallet.currentBalanceMinor) < Number(schedule.amountMinor)) throw new Error('RECURRING_INSUFFICIENT');
          const delta = isCreditCard ? (schedule.transactionType === 'expense' ? Number(schedule.amountMinor) : -Number(schedule.amountMinor)) : (schedule.transactionType === 'income' ? Number(schedule.amountMinor) : -Number(schedule.amountMinor));
          const [updatedWallet] = await tx.update(wallets).set({ currentBalanceMinor: sql`${wallets.currentBalanceMinor} + ${delta}`, updatedAt: new Date() })
            .where(and(eq(wallets.id, wallet.id), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId))).returning();
          if (!updatedWallet) throw new Error('RECURRING_WALLET_UNAVAILABLE');
          const [created] = await tx.insert(transactions).values({
            workspaceId: context.workspaceId, userId: context.userId, transactionType: schedule.transactionType,
            walletId: wallet.id, categoryId: schedule.categoryId, idempotencyKey, amountMinor: Number(schedule.amountMinor),
            description: schedule.description, occurredAt: new Date(schedule.nextRun + 'T12:00:00.000Z'),
          }).returning();
          await postFinancialJournal(tx, context, created, wallet);
        }
        const nextDate = advanceRecurringDate(schedule.nextRun, schedule.frequency);
        await tx.update(recurringTransactions).set({ lastGeneratedFor: schedule.nextRun, nextRun: nextDate, updatedAt: new Date() })
          .where(and(eq(recurringTransactions.id, schedule.id), eq(recurringTransactions.workspaceId, context.workspaceId), eq(recurringTransactions.userId, context.userId)));
        await tx.insert(financeAuditEvents).values({ workspaceId: context.workspaceId, userId: context.userId, entityType: 'recurring', entityId: schedule.id, action: 'generated', summary: `Recorded scheduled ${schedule.transactionType}: ${schedule.description}` });
        return { recorded: true, nextRun: nextDate, description: schedule.description };
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (body.kind === 'budget') {
      const { categoryId, limitMinor, carryForward = false, monthStart = monthDate(now) } = body;
      if (!isUuid(categoryId) || !validMoney(limitMinor) || typeof carryForward !== 'boolean' || typeof monthStart !== 'string' || !isDateOnly(monthStart) || !monthStart.endsWith('-01')) {
        return NextResponse.json({ error: 'Provide a category, positive budget, and first day of month' }, { status: 400 });
      }
      const [category] = await db.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId), eq(categories.categoryType, 'expense'))).limit(1);
      if (!category) return NextResponse.json({ error: 'Expense category not found' }, { status: 404 });
      const [row] = await db.insert(monthlyBudgets).values({ workspaceId: context.workspaceId, userId: context.userId, categoryId, limitMinor, carryForward, monthStart })
        .onConflictDoUpdate({ target: [monthlyBudgets.workspaceId, monthlyBudgets.categoryId, monthlyBudgets.monthStart], set: { limitMinor, carryForward, updatedAt: now } }).returning();
      await db.insert(financeAuditEvents).values({ workspaceId: context.workspaceId, userId: context.userId, entityType: 'budget', entityId: row.id, action: 'upsert', summary: `Budget set for ${category.name}` });
      return NextResponse.json(row, { status: 201 });
    }
    if (body.kind === 'recurring') {
      const { transactionType, walletId, categoryId = null, description, amountMinor, frequency, nextRun } = body;
      if (!['income', 'expense'].includes(String(transactionType)) || !isUuid(walletId) || (categoryId !== null && !isUuid(categoryId)) ||
          typeof description !== 'string' || !description.trim() || description.trim().length > 160 || !validMoney(amountMinor) ||
          !['weekly', 'monthly', 'yearly'].includes(String(frequency)) || typeof nextRun !== 'string' || !isDateOnly(nextRun)) {
        return NextResponse.json({ error: 'Invalid recurring transaction details' }, { status: 400 });
      }
      const [wallet] = await db.select().from(wallets).where(and(eq(wallets.id, walletId), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId), eq(wallets.status, 'active'))).limit(1);
      if (!wallet) return NextResponse.json({ error: 'Active wallet not found' }, { status: 404 });
      if (categoryId) {
        const [category] = await db.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId), eq(categories.categoryType, transactionType as 'income' | 'expense'))).limit(1);
        if (!category) return NextResponse.json({ error: 'Category does not match transaction type' }, { status: 400 });
      }
      const [row] = await db.insert(recurringTransactions).values({ workspaceId: context.workspaceId, userId: context.userId, transactionType: String(transactionType), walletId, categoryId: categoryId as string | null, description: description.trim(), amountMinor, frequency: String(frequency), nextRun }).returning();
      await db.insert(financeAuditEvents).values({ workspaceId: context.workspaceId, userId: context.userId, entityType: 'recurring', entityId: row.id, action: 'created', summary: `Recurring ${transactionType} scheduled: ${description.trim()}` });
      return NextResponse.json(row, { status: 201 });
    }
    if (body.kind === 'reconciliation') {
      const { walletId, actualMinor, note = null } = body;
      if (!isUuid(walletId) || typeof actualMinor !== 'number' || !Number.isSafeInteger(actualMinor) || (note !== null && (typeof note !== 'string' || note.length > 500))) {
        return NextResponse.json({ error: 'Provide a wallet and valid actual balance' }, { status: 400 });
      }
      const [wallet] = await db.select().from(wallets).where(and(eq(wallets.id, walletId), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId), eq(wallets.status, 'active'))).limit(1);
      if (!wallet) return NextResponse.json({ error: 'Active wallet not found' }, { status: 404 });
      const recordedMinor = Number(wallet.currentBalanceMinor);
      const varianceMinor = actualMinor - recordedMinor;
      if (![recordedMinor, actualMinor, varianceMinor].every(Number.isSafeInteger)) return NextResponse.json({ error: 'Balance exceeds supported range' }, { status: 400 });
      const [row] = await db.insert(walletReconciliations).values({ workspaceId: context.workspaceId, userId: context.userId, walletId, recordedMinor, actualMinor, varianceMinor, note }).returning();
      await db.insert(financeAuditEvents).values({ workspaceId: context.workspaceId, userId: context.userId, entityType: 'wallet', entityId: walletId, action: 'reconciled', summary: `Reconciled ${wallet.name}; variance ${varianceMinor} minor units` });
      return NextResponse.json(row, { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown finance tool action' }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'RECURRING_NOT_FOUND') return NextResponse.json({ error: 'Recurring item not found or paused' }, { status: 404 });
    if (code === 'RECURRING_NOT_DUE') return NextResponse.json({ error: 'This recurring item is not due yet' }, { status: 400 });
    if (code === 'RECURRING_WALLET_UNAVAILABLE') return NextResponse.json({ error: 'The linked wallet is unavailable' }, { status: 409 });
    if (code === 'RECURRING_CATEGORY_INVALID') return NextResponse.json({ error: 'The linked category is no longer valid' }, { status: 409 });
    if (code === 'RECURRING_CREDIT_LIMIT') return NextResponse.json({ error: 'This scheduled expense would exceed the credit limit' }, { status: 409 });
    if (code === 'RECURRING_INSUFFICIENT') return NextResponse.json({ error: 'The credit-card balance is lower than this scheduled payment' }, { status: 409 });
    if (code === 'RECURRING_BALANCE_RANGE') return NextResponse.json({ error: 'The scheduled transaction exceeds the supported wallet balance range' }, { status: 409 });
    console.error('MONETRA_FINANCE_TOOLS_POST_ERROR:', error);
    return NextResponse.json({ error: 'Unable to save finance tool record' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { id, enabled } = body;
  if (!isUuid(id) || typeof enabled !== 'boolean') return NextResponse.json({ error: 'Valid recurring ID and enabled state are required' }, { status: 400 });
  try {
    const [row] = await db.update(recurringTransactions).set({ enabled, updatedAt: new Date() })
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.workspaceId, context.workspaceId), eq(recurringTransactions.userId, context.userId))).returning();
    if (!row) return NextResponse.json({ error: 'Recurring item not found' }, { status: 404 });
    await db.insert(financeAuditEvents).values({ workspaceId: context.workspaceId, userId: context.userId, entityType: 'recurring', entityId: row.id, action: enabled ? 'enabled' : 'paused', summary: `${enabled ? 'Enabled' : 'Paused'} recurring item: ${row.description}` });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: 'Unable to update recurring item' }, { status: 500 });
  }
}
