import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { transactions } from '@/db/schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const requestedStart = url.searchParams.get('from');
  const requestedEnd = url.searchParams.get('to');
  const monthStart = requestedStart ? new Date(requestedStart) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const nextMonthStart = requestedEnd ? new Date(requestedEnd) : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  if (Number.isNaN(monthStart.getTime()) || Number.isNaN(nextMonthStart.getTime()) || monthStart >= nextMonthStart) {
    return NextResponse.json({ error: 'Invalid summary date range' }, { status: 400 });
  }

  try {
    const [totals] = await db
      .select({
        incomeMinor: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amountMinor} ELSE 0 END), 0)::text`,
        expenseMinor: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amountMinor} ELSE 0 END), 0)::text`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gte(transactions.occurredAt, monthStart), lt(transactions.occurredAt, nextMonthStart)));

    const categoryRows = await db
      .select({
        categoryId: transactions.categoryId,
        totalMinor: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)::text`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.transactionType, 'expense'), gte(transactions.occurredAt, monthStart), lt(transactions.occurredAt, nextMonthStart)))
      .groupBy(transactions.categoryId);

    return NextResponse.json({
      monthStart: monthStart.toISOString(),
      incomeMinor: Number(totals?.incomeMinor ?? 0),
      expenseMinor: Number(totals?.expenseMinor ?? 0),
      categorySpend: categoryRows.map((row) => ({ categoryId: row.categoryId, totalMinor: Number(row.totalMinor) })),
    });
  } catch {
    return NextResponse.json({ error: 'Unable to load financial summary' }, { status: 500 });
  }
}
