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
    const [debt] = await db.select().from(dueDebts).where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId)));
    if (!debt) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    const payments = await db.select().from(dueDebtPayments).where(and(eq(dueDebtPayments.dueDebtId, debt.id), eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId)));
    const paidMinor = payments.reduce((sum, payment) => sum + Number(payment.amountMinor), 0);
    return NextResponse.json({ ...debt, paidMinor, outstandingMinor: Math.max(0, Number(debt.principalMinor) - paidMinor), payments });
  } catch { return NextResponse.json({ error: 'Unable to load Due & Debt record' }, { status: 500 }); }
}

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const values: Partial<typeof dueDebts.$inferInsert> = { updatedAt: new Date() };
  if (body.direction !== undefined && !['receivable', 'payable'].includes(String(body.direction))) return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });
  if (body.principalMinor !== undefined && (typeof body.principalMinor !== 'number' || !Number.isSafeInteger(body.principalMinor) || body.principalMinor <= 0)) return NextResponse.json({ error: 'Invalid principal amount' }, { status: 400 });
  if (body.counterpartyName !== undefined) {
    if (typeof body.counterpartyName !== 'string' || !body.counterpartyName.trim() || body.counterpartyName.trim().length > 120) return NextResponse.json({ error: 'Invalid counterparty name' }, { status: 400 });
    values.counterpartyName = body.counterpartyName.trim();
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate !== null && (typeof body.dueDate !== 'string' || !isDateOnly(body.dueDate))) return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
    values.dueDate = body.dueDate;
  }
  if (body.note !== undefined) {
    if (body.note !== null && (typeof body.note !== 'string' || body.note.length > 2000)) return NextResponse.json({ error: 'Invalid note' }, { status: 400 });
    values.note = body.note;
  }
  try {
    const debt = await db.transaction(async tx => {
      const [current] = await tx.select().from(dueDebts)
        .where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId), sql`${dueDebts.status} <> 'archived'`))
        .for('update');
      if (!current) throw new Error('DEBT_NOT_FOUND');
      const [paid] = await tx.select({ total: sql<string>`coalesce(sum(${dueDebtPayments.amountMinor}),0)::text` })
        .from(dueDebtPayments).where(and(eq(dueDebtPayments.dueDebtId, current.id), eq(dueDebtPayments.workspaceId, context.workspaceId), eq(dueDebtPayments.userId, context.userId)));
      const paidMinor = Number(paid?.total ?? 0);
      if (body.principalMinor !== undefined && Number(body.principalMinor) < paidMinor) throw new Error('PRINCIPAL_BELOW_PAID');
      if (body.direction !== undefined && body.direction !== current.direction && paidMinor > 0) throw new Error('DIRECTION_LOCKED_AFTER_PAYMENT');
      if (body.direction !== undefined) values.direction = String(body.direction);
      if (body.principalMinor !== undefined) {
        values.principalMinor = body.principalMinor as number;
        values.status = Number(body.principalMinor) === paidMinor ? 'settled' : paidMinor > 0 ? 'partially_settled' : 'open';
      }
      const [saved] = await tx.update(dueDebts).set(values)
        .where(and(eq(dueDebts.id, current.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId)))
        .returning();
      return saved;
    });
    return NextResponse.json(debt);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'DEBT_NOT_FOUND') return NextResponse.json({ error: 'Record not found or archived' }, { status: 404 });
    if (code === 'PRINCIPAL_BELOW_PAID') return NextResponse.json({ error: 'Principal cannot be lower than payments already recorded' }, { status: 400 });
    if (code === 'DIRECTION_LOCKED_AFTER_PAYMENT') return NextResponse.json({ error: 'Direction cannot change after a payment has been recorded' }, { status: 409 });
    return NextResponse.json({ error: 'Unable to update Due & Debt record' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
  try {
    const [debt] = await db.update(dueDebts).set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(dueDebts.id, params.id), eq(dueDebts.workspaceId, context.workspaceId), eq(dueDebts.userId, context.userId), sql`${dueDebts.status} <> 'archived'`))
      .returning({ id: dueDebts.id });
    return debt ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Record not found' }, { status: 404 });
  } catch { return NextResponse.json({ error: 'Unable to archive Due & Debt record' }, { status: 500 }); }
}
