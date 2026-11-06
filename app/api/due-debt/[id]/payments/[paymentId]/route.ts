import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dueDebts, dueDebtPayments } from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { isUuid } from '@/lib/validation';

type Params = { params: { id: string; paymentId: string } };

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id) || !isUuid(params.paymentId)) return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { amountMinor, paidAt, note = null } = body;
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
      (note !== null && (typeof note !== 'string' || note.length > 1000))) {
    return NextResponse.json({ error: 'Enter a valid positive amount and note' }, { status: 400 });
  }
  const date = paidAt === undefined ? null : new Date(String(paidAt) + 'T12:00:00.000Z');
  if (date && Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid payment date' }, { status: 400 });
  try {
    const payment = await db.transaction(async tx => {
      const [debt] = await tx.select().from(dueDebts)
        .where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId), sql`${dueDebts.status} <> 'archived'`))
        .for('update');
      if (!debt) throw new Error('DEBT_NOT_FOUND');
      const [current] = await tx.select().from(dueDebtPayments)
        .where(and(eq(dueDebtPayments.id, params.paymentId), eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId)));
      if (!current) throw new Error('PAYMENT_NOT_FOUND');
      const [totals] = await tx.select({ total: sql<string>`coalesce(sum(${dueDebtPayments.amountMinor}),0)::text` })
        .from(dueDebtPayments).where(and(eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId)));
      const allowed = Number(debt.principalMinor) - (Number(totals?.total ?? 0) - Number(current.amountMinor));
      if (amountMinor > allowed) throw new Error('PAYMENT_EXCEEDS_OUTSTANDING');
      const [saved] = await tx.update(dueDebtPayments).set({ amountMinor, note, ...(date ? { paidAt: date } : {}) })
        .where(and(eq(dueDebtPayments.id, current.id), eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId)))
        .returning();
      const nextPaid = Number(totals?.total ?? 0) - Number(current.amountMinor) + amountMinor;
      const nextStatus = nextPaid >= Number(debt.principalMinor) ? 'settled' : nextPaid > 0 ? 'partially_settled' : 'open';
      await tx.update(dueDebts).set({ status: nextStatus, updatedAt: new Date() })
        .where(and(eq(dueDebts.id, debt.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId)));
      return saved;
    });
    return NextResponse.json({ payment });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'DEBT_NOT_FOUND' || code === 'PAYMENT_NOT_FOUND') return NextResponse.json({ error: 'Debt or payment record not found' }, { status: 404 });
    if (code === 'PAYMENT_EXCEEDS_OUTSTANDING') return NextResponse.json({ error: 'Payment exceeds the remaining principal after other payments' }, { status: 400 });
    return NextResponse.json({ error: 'Unable to update payment' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id) || !isUuid(params.paymentId)) return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [debt] = await tx.select().from(dueDebts)
        .where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId), sql`${dueDebts.status} <> 'archived'`))
        .for('update');
      if (!debt) throw new Error('DEBT_NOT_FOUND');
      const [payment] = await tx.delete(dueDebtPayments)
        .where(and(eq(dueDebtPayments.id, params.paymentId), eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId)))
        .returning({ id: dueDebtPayments.id });
      if (!payment) throw new Error('PAYMENT_NOT_FOUND');
      const [totals] = await tx.select({ total: sql<string>`coalesce(sum(${dueDebtPayments.amountMinor}),0)::text` })
        .from(dueDebtPayments).where(and(eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId)));
      const paid = Number(totals?.total ?? 0);
      const nextStatus = paid >= Number(debt.principalMinor) ? 'settled' : paid > 0 ? 'partially_settled' : 'open';
      await tx.update(dueDebts).set({ status: nextStatus, updatedAt: new Date() })
        .where(and(eq(dueDebts.id, debt.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId)));
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'DEBT_NOT_FOUND' || code === 'PAYMENT_NOT_FOUND') return NextResponse.json({ error: 'Debt or payment record not found' }, { status: 404 });
    return NextResponse.json({ error: 'Unable to delete payment' }, { status: 500 });
  }
}
