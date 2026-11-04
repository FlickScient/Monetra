import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { savingsGoals, goalAllocations } from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
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
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    await db.transaction(async (tx) => {
      // Match the allocation endpoint's lock order to prevent archive/allocation races.
      const [goal] = await tx.select().from(savingsGoals)
        .where(and(
          eq(savingsGoals.id, params.id),
          eq(savingsGoals.workspaceId, context.workspaceId),
          eq(savingsGoals.status, 'active'),
        ))
        .for('update');
      if (!goal) throw new Error('GOAL_NOT_FOUND');

      const [allocation] = await tx.select({ id: goalAllocations.id }).from(goalAllocations)
        .where(and(
          eq(goalAllocations.goalId, goal.id),
          eq(goalAllocations.workspaceId, context.workspaceId),
        )).limit(1);
      if (allocation) throw new Error('GOAL_HAS_ALLOCATIONS');

      await tx.update(savingsGoals).set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(savingsGoals.id, goal.id), eq(savingsGoals.workspaceId, context.workspaceId)));
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'GOAL_NOT_FOUND') return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    if (code === 'GOAL_HAS_ALLOCATIONS') return NextResponse.json({ error: 'Release all wallet allocations before archiving this goal' }, { status: 409 });
    return NextResponse.json({ error: 'Unable to archive savings goal' }, { status: 500 });
  }
}
