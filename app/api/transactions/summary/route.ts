import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { transactions } from '@/db/schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

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
      .where(and(eq(transactions.userId, userId), eq(transactions.transactionType, 'expense'), gte(transactions.occurredAt, monthStart)))
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
