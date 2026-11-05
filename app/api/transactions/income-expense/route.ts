import { NextResponse } from 'next/server';
import { and, eq, gte, lt, isNull, sql, desc } from 'drizzle-orm';
import { getWorkspaceContext } from '@/lib/workspace';
import { db } from '@/db';
import { transactions, categories, wallets } from '@/db/schema';

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const context = await getWorkspaceContext(request);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' });
  if (!monthPattern.test(month)) return NextResponse.json({ error: 'Month must use YYYY-MM format.' }, { status: 400 });

  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const start = new Date(`${month}-01T00:00:00+06:00`);
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+06:00`);
  const baseFilter = and(
    eq(transactions.workspaceId, context.workspaceId),
    eq(transactions.userId, context.userId),
    isNull(transactions.voidedAt),
    gte(transactions.occurredAt, start),
    lt(transactions.occurredAt, end),
  );

  try {
    const [totals] = await db.select({
      incomeMinor: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amountMinor} ELSE 0 END), 0)::text`,
      expenseMinor: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amountMinor} ELSE 0 END), 0)::text`,
    }).from(transactions).where(and(baseFilter, sql`${transactions.transactionType} IN ('income', 'expense')`));

    const days = await db.select({
      date: sql<string>`to_char(${transactions.occurredAt} AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD')`,
      incomeMinor: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amountMinor} ELSE 0 END), 0)::text`,
      expenseMinor: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amountMinor} ELSE 0 END), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    }).from(transactions).where(and(baseFilter, sql`${transactions.transactionType} IN ('income', 'expense')`))
      .groupBy(sql`to_char(${transactions.occurredAt} AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${transactions.occurredAt} AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') DESC`);

    const rows = await db.select({
      id: transactions.id,
      transactionType: transactions.transactionType,
      amountMinor: transactions.amountMinor,
      description: transactions.description,
      occurredAt: transactions.occurredAt,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      walletName: wallets.name,
      currency: wallets.currency,
      localDate: sql<string>`to_char(${transactions.occurredAt} AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD')`,
    }).from(transactions)
      .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId)))
      .leftJoin(wallets, and(eq(wallets.id, transactions.walletId), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId)))
      .where(and(baseFilter, sql`${transactions.transactionType} IN ('income', 'expense')`))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(2000);

    const incomeMinor = BigInt(totals?.incomeMinor || '0');
    const expenseMinor = BigInt(totals?.expenseMinor || '0');
    if (incomeMinor > BigInt(Number.MAX_SAFE_INTEGER) || expenseMinor > BigInt(Number.MAX_SAFE_INTEGER) ||
        days.some(day => BigInt(day.incomeMinor) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(day.expenseMinor) > BigInt(Number.MAX_SAFE_INTEGER))) {
      return NextResponse.json({ error: 'This month exceeds the supported safe calculation range.' }, { status: 409 });
    }

    return NextResponse.json({
      month,
      incomeMinor: Number(incomeMinor),
      expenseMinor: Number(expenseMinor),
      netMinor: Number(incomeMinor - expenseMinor),
      days: days.map(day => ({ date: day.date, incomeMinor: Number(day.incomeMinor), expenseMinor: Number(day.expenseMinor), netMinor: Number(day.incomeMinor) - Number(day.expenseMinor), count: day.count })),
      transactions: rows.map(row => ({ ...row, amountMinor: Number(row.amountMinor), occurredAt: row.occurredAt.toISOString() })),
      truncated: rows.length === 2000,
    });
  } catch (error) {
    console.error('MONETRA_INCOME_EXPENSE_LEDGER_ERROR:', error);
    return NextResponse.json({ error: 'Unable to load this month’s income and expense ledger.' }, { status: 500 });
  }
}
