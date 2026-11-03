import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dueDebts, dueDebtPayments } from '@/db/modules-schema';
import { getOrganizationContext, canWriteOrganization } from '@/lib/organization';

type Params = { params: { id: string } };

export async function GET(req: Request, { params }: Params) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    const payments = await db.select().from(dueDebtPayments)
      .where(and(eq(dueDebtPayments.dueDebtId, params.id), eq(dueDebtPayments.organizationId, context.organizationId)))
      .orderBy(sql`${dueDebtPayments.paidAt} desc`);
    return NextResponse.json(payments);
  } catch { return NextResponse.json({ error: 'Unable to load payment history' }, { status: 500 }); }
}

export async function POST(req: Request, { params }: Params) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!canWriteOrganization(context.role)) return NextResponse.json({ error: 'Read-only workspace access' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { amountMinor, paidAt, paymentMethod = null, note = null } = body;
  const idempotencyKey = req.headers.get('idempotency-key') || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '');
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
      !idempotencyKey || idempotencyKey.length > 128 ||
      (paymentMethod !== null && (typeof paymentMethod !== 'string' || paymentMethod.length > 40)) ||
      (note !== null && (typeof note !== 'string' || note.length > 1000))) {
    return NextResponse.json({ error: 'Provide a positive amount and a valid idempotency key' }, { status: 400 });
  }
  const date = paidAt === undefined ? new Date() : new Date(String(paidAt));
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid payment date' }, { status: 400 });

  try {
    const result = await db.transaction(async tx => {
      const [prior] = await tx.select().from(dueDebtPayments)
        .where(and(eq(dueDebtPayments.organizationId, context.organizationId), eq(dueDebtPayments.idempotencyKey, idempotencyKey)));
      if (prior) return { payment: prior, replayed: true };

      const [debt] = await tx.select().from(dueDebts)
        .where(and(eq(dueDebts.id, params.id), eq(dueDebts.organizationId, context.organizationId)))
        .for('update');
      if (!debt || debt.status === 'archived') throw new Error('DEBT_NOT_FOUND');

      const [totals] = await tx.select({ paid: sql<string>`coalesce(sum(${dueDebtPayments.amountMinor}),0)::text` })
        .from(dueDebtPayments).where(and(eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.organizationId, context.organizationId)));
      const outstanding = Number(debt.principalMinor) - Number(totals?.paid ?? 0);
      if (amountMinor > outstanding) throw new Error('PAYMENT_EXCEEDS_OUTSTANDING');

      const [payment] = await tx.insert(dueDebtPayments).values({
        organizationId: context.organizationId, dueDebtId: debt.id, userId: context.userId,
        amountMinor, paidAt: date, paymentMethod, note, idempotencyKey,
      }).returning();
      const nextStatus = amountMinor === outstanding ? 'settled' : 'partially_settled';
      await tx.update(dueDebts).set({ status: nextStatus, updatedAt: new Date() })
        .where(and(eq(dueDebts.id, debt.id), eq(dueDebts.organizationId, context.organizationId)));
      return { payment, replayed: false, outstandingMinor: outstanding - amountMinor };
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'DEBT_NOT_FOUND') return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    if (code === 'PAYMENT_EXCEEDS_OUTSTANDING') return NextResponse.json({ error: 'Payment exceeds the outstanding principal' }, { status: 400 });
    return NextResponse.json({ error: 'Unable to record payment' }, { status: 500 });
  }
}
