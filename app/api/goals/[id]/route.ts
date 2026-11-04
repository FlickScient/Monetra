import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { savingsGoals, goalAllocations } from '@/db/modules-schema';
import { getOrganizationContext, canWriteOrganization } from '@/lib/organization';

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!canWriteOrganization(context.role)) return NextResponse.json({ error: 'Read-only workspace access' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const values: Partial<typeof savingsGoals.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) return NextResponse.json({ error: 'Invalid goal name' }, { status: 400 });
    values.name = body.name.trim();
  }
  if (body.targetMinor !== undefined) {
    if (typeof body.targetMinor !== 'number' || !Number.isSafeInteger(body.targetMinor) || body.targetMinor <= 0) return NextResponse.json({ error: 'Invalid target amount' }, { status: 400 });
    values.targetMinor = body.targetMinor;
  }
  if (body.targetDate !== undefined) {
    if (body.targetDate !== null && (typeof body.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate))) return NextResponse.json({ error: 'Invalid target date' }, { status: 400 });
    values.targetDate = body.targetDate;
  }
  try {
    const [goal] = await db.update(savingsGoals).set(values)
      .where(and(eq(savingsGoals.id, params.id), eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.status, 'active')))
      .returning();
    return goal ? NextResponse.json(goal) : NextResponse.json({ error: 'Goal not found' }, { status: 404 });
  } catch { return NextResponse.json({ error: 'Unable to update savings goal' }, { status: 500 }); }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!canWriteOrganization(context.role)) return NextResponse.json({ error: 'Read-only workspace access' }, { status: 403 });
  try {
    const [goal] = await db.select().from(savingsGoals)
      .where(and(eq(savingsGoals.id, params.id), eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.status, 'active')));
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    const allocations = await db.select().from(goalAllocations).where(eq(goalAllocations.goalId, goal.id));
    if (allocations.length) return NextResponse.json({ error: 'Release all wallet allocations before archiving this goal' }, { status: 409 });
    await db.update(savingsGoals).set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(savingsGoals.id, goal.id), eq(savingsGoals.workspaceId, context.workspaceId)));
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'Unable to archive savings goal' }, { status: 500 }); }
}
