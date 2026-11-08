import { NextResponse } from 'next/server';
import { and, eq, gte, lt, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { categories, transactions } from '@/db/schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { dhakaDateBoundary, dhakaMonthStart, shiftMonthStart } from '@/lib/dhaka-time';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_PATTERN = /^\d{4}$/;

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  const url = new URL(req.url);
  const period = url.searchParams.get('period') || 'month';
  const currentMonth = dhakaMonthStart();
  const value = url.searchParams.get('value') || (period === 'year' ? currentMonth.slice(0, 4) : currentMonth.slice(0, 7));

  if (period !== 'month' && period !== 'year') {
    return NextResponse.json({ error: 'Period must be month or year' }, { status: 400 });
  }
  if ((period === 'month' && !MONTH_PATTERN.test(value)) || (period === 'year' && !YEAR_PATTERN.test(value))) {
    return NextResponse.json({ error: 'Invalid report period value' }, { status: 400 });
  }

  const firstDay = period === 'month' ? value + '-01' : value + '-01-01';
  const afterLastDay = period === 'month'
    ? shiftMonthStart(firstDay, 1)
    : String(Number(value) + 1) + '-01-01';
  const start = dhakaDateBoundary(firstDay);
  const end = dhakaDateBoundary(afterLastDay);

  try {
    const filter = and(
      eq(transactions.workspaceId, context.workspaceId),
      eq(transactions.userId, context.userId),
      isNull(transactions.voidedAt),
      gte(transactions.occurredAt, start),
      lt(transactions.occurredAt, end),
      sql` ${transactions.transactionType} IN ('income', 'expense') `,
    );

    const [totals] = await db.select({
      income: sql<string>`coalesce(sum(case when ${transactions.transactionType} = 'income' then ${transactions.amountMinor} else 0 end), 0)::text`,
      expense: sql<string>`coalesce(sum(case when ${transactions.transactionType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)::text`,
      count: sql<number>`count(*)::int`,
    }).from(transactions).where(filter);

    const bucket = period === 'month'
      ? sql<string>`to_char(${transactions.occurredAt} + interval '6 hours', 'YYYY-MM-DD')`
      : sql<string>`to_char(date_trunc('month', ${transactions.occurredAt} + interval '6 hours'), 'YYYY-MM')`;

    const series = await db.select({
      label: bucket,
      income: sql<string>`coalesce(sum(case when ${transactions.transactionType} = 'income' then ${transactions.amountMinor} else 0 end), 0)::text`,
      expense: sql<string>`coalesce(sum(case when ${transactions.transactionType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)::text`,
      count: sql<number>`count(*)::int`,
    }).from(transactions).where(filter).groupBy(bucket).orderBy(bucket);

    const categoryRows = await db.select({
      id: transactions.categoryId,
      name: categories.name,
      total: sql<string>`coalesce(sum(${transactions.amountMinor}), 0)::text`,
      count: sql<number>`count(*)::int`,
    }).from(transactions)
      .leftJoin(categories, and(
        eq(categories.id, transactions.categoryId),
        eq(categories.workspaceId, context.workspaceId),
        eq(categories.userId, context.userId),
      ))
      .where(and(
        eq(transactions.workspaceId, context.workspaceId),
        eq(transactions.userId, context.userId),
        isNull(transactions.voidedAt),
        eq(transactions.transactionType, 'expense'),
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
      ))
      .groupBy(transactions.categoryId, categories.name)
      .orderBy(sql`sum(${transactions.amountMinor}) desc`);

    const values = [
      BigInt(totals?.income || '0'),
      BigInt(totals?.expense || '0'),
      ...series.flatMap((row) => [BigInt(row.income), BigInt(row.expense)]),
      ...categoryRows.map((row) => BigInt(row.total)),
    ];
    if (values.some((amount) => amount > BigInt(Number.MAX_SAFE_INTEGER))) {
      return NextResponse.json({ error: 'This report exceeds the supported safe calculation range' }, { status: 409 });
    }

    const incomeMinor = Number(totals?.income || 0);
    const expenseMinor = Number(totals?.expense || 0);
    return NextResponse.json({
      period,
      value,
      from: firstDay,
      to: afterLastDay,
      incomeMinor,
      expenseMinor,
      netMinor: incomeMinor - expenseMinor,
      transactionCount: totals?.count || 0,
      series: series.map((row) => ({
        label: row.label,
        incomeMinor: Number(row.income),
        expenseMinor: Number(row.expense),
        count: row.count,
      })),
      categories: categoryRows.map((row) => ({
        id: row.id,
        name: row.name || 'Uncategorized',
        totalMinor: Number(row.total),
        count: row.count,
      })),
    });
  } catch (error) {
    console.error('MONETRA_REPORT_ERROR:', error);
    return NextResponse.json({ error: 'Unable to prepare this financial report' }, { status: 500 });
  }
}