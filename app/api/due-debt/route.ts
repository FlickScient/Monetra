import { NextResponse } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dueDebts, dueDebtPayments } from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    const debts = await db.select().from(dueDebts)
      .where(and(eq(dueDebts.workspaceId, context.workspaceId), sql`${dueDebts.status} <> 'archived'`))
      .orderBy(asc(dueDebts.createdAt));
    const payments = debts.length ? await db.select().from(dueDebtPayments)
      .where(eq(dueDebtPayments.workspaceId, context.workspaceId)) : [];
    return NextResponse.json(debts.map(debt => {
      const paidMinor = payments.filter(payment => payment.dueDebtId === debt.id)
        .reduce((sum, payment) => sum + Number(payment.amountMinor), 0);
      return { ...debt, paidMinor, outstandingMinor: Math.max(0, Number(debt.principalMinor) - paidMinor), repayments: payments.filter(payment => payment.dueDebtId === debt.id).map(payment => ({ id: payment.id, amount: Number(payment.amountMinor), date: payment.paidAt.toISOString().slice(0, 10), note: payment.note ?? '' })) };
    }));
  } catch { return NextResponse.json({ error: 'Unable to load Due & Debt records' }, { status: 500 }); }
}

export async function POST(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { direction, counterpartyName, principalMinor, currency = 'BDT', annualRateBps = 0, dueDate = null, note = null } = body;
  if (!['receivable', 'payable'].includes(String(direction)) ||
      typeof counterpartyName !== 'string' || !counterpartyName.trim() || counterpartyName.trim().length > 120 ||
      typeof principalMinor !== 'number' || !Number.isSafeInteger(principalMinor) || principalMinor <= 0 ||
      typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
      typeof annualRateBps !== 'number' || !Number.isSafeInteger(annualRateBps) || annualRateBps < 0 || annualRateBps > 100000 ||
      (dueDate !== null && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) ||
      (note !== null && (typeof note !== 'string' || note.length > 2000))) {
    return NextResponse.json({ error: 'Invalid Due & Debt details' }, { status: 400 });
  }
  try {
    const [debt] = await db.insert(dueDebts).values({
      workspaceId: context.workspaceId, userId: context.userId, direction: String(direction),
      counterpartyName: counterpartyName.trim(), principalMinor, currency,
      annualRateBps, dueDate, note,
    }).returning();
    return NextResponse.json({ ...debt, paidMinor: 0, outstandingMinor: principalMinor, payments: [] }, { status: 201 });
  } catch { return NextResponse.json({ error: 'Unable to create Due & Debt record' }, { status: 500 }); }
}
