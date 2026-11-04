import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dueDebts, dueDebtPayments } from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { isUuid, isDateOnly } from '@/lib/validation';

type Params = { params: { id: string } };

export async function GET(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
  try {
    const [debt] = await db.select().from(dueDebts).where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId)));
    if (!debt) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    const payments = await db.select().from(dueDebtPayments).where(and(eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.workspaceId, context.workspaceId)));
    const paidMinor = payments.reduce((sum, payment) => sum + Number(payment.amountMinor), 0);
    return NextResponse.json({ ...debt, paidMinor, outstandingMinor: Math.max(0, Number(debt.principalMinor) - paidMinor), payments });
  } catch { return NextResponse.json({ error: 'Unable to load Due & Debt record' }, { status: 500 }); }
}

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const values: Partial<typeof dueDebts.$inferInsert> = { updatedAt: new Date() };
  if (body.counterpartyName !== undefined) {
    if (typeof body.counterpartyName !== 'string' || !body.counterpartyName.trim() || body.counterpartyName.trim().length > 120) return NextResponse.json({ error: 'Invalid counterparty name' }, { status: 400 });
    values.counterpartyName = body.counterpartyName.trim();
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate !== null && (typeof body.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate))) return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
    values.dueDate = body.dueDate;
  }
  if (body.note !== undefined) {
    if (body.note !== null && (typeof body.note !== 'string' || body.note.length > 2000)) return NextResponse.json({ error: 'Invalid note' }, { status: 400 });
    values.note = body.note;
  }
  if (body.annualRateBps !== undefined) {
    if (typeof body.annualRateBps !== 'number' || !Number.isSafeInteger(body.annualRateBps) || body.annualRateBps < 0 || body.annualRateBps > 100000) return NextResponse.json({ error: 'Invalid annual rate' }, { status: 400 });
    values.annualRateBps = body.annualRateBps;
  }
  try {
    const [debt] = await db.update(dueDebts).set(values)
      .where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.status, 'open')))
      .returning();
    return debt ? NextResponse.json(debt) : NextResponse.json({ error: 'Record not found or no longer editable' }, { status: 404 });
  } catch { return NextResponse.json({ error: 'Unable to update Due & Debt record' }, { status: 500 }); }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    const [debt] = await db.update(dueDebts).set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId), sql`${dueDebts.status} <> 'archived'`))
      .returning({ id: dueDebts.id });
    return debt ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Record not found' }, { status: 404 });
  } catch { return NextResponse.json({ error: 'Unable to archive Due & Debt record' }, { status: 500 }); }
}
