import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { savingsGoals, goalAllocations, goalAllocationEvents } from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { recordFinanceAudit } from '@/lib/audit';
import { isUuid, isDateOnly } from '@/lib/validation';

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid goal ID' }, { status: 400 });
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
    if (body.targetDate !== null && (typeof body.targetDate !== 'string' || !isDateOnly(body.targetDate))) return NextResponse.json({ error: 'Invalid target date' }, { status: 400 });
    values.targetDate = body.targetDate;
  }
  try {
    const goal = await db.transaction(async tx => {
      const [current] = await tx.select().from(savingsGoals)
        .where(and(eq(savingsGoals.id, params.id), eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.userId, context.userId), eq(savingsGoals.status, 'active')))
        .for('update');
      if (!current) throw new Error('GOAL_NOT_FOUND');
      if (body.targetMinor !== undefined) {
        const [allocated] = await tx.select({ total: sql<string>`coalesce(sum(${goalAllocations.amountMinor}),0)::text` })
          .from(goalAllocations).where(and(eq(goalAllocations.goalId, current.id), eq(goalAllocations.workspaceId, context.workspaceId)));
        if (Number(body.targetMinor) < Number(allocated?.total ?? 0)) throw new Error('TARGET_BELOW_ALLOCATED');
      }
      const [saved] = await tx.update(savingsGoals).set(values)
        .where(and(eq(savingsGoals.id, current.id), eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.userId, context.userId)))
        .returning();
      return saved;
    });
    await recordFinanceAudit(context, { entityType: 'savings_goal', entityId: goal.id, action: 'updated', summary: 'Updated savings goal: ' + goal.name });
    return NextResponse.json(goal);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'GOAL_NOT_FOUND') return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    if (code === 'TARGET_BELOW_ALLOCATED') return NextResponse.json({ error: 'Target cannot be lower than the money already allocated to this goal' }, { status: 409 });
    return NextResponse.json({ error: 'Unable to update savings goal' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid goal ID' }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [goal] = await tx.select().from(savingsGoals)
        .where(and(eq(savingsGoals.id, params.id), eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.userId, context.userId), eq(savingsGoals.status, 'active')))
        .for('update');
      if (!goal) throw new Error('GOAL_NOT_FOUND');
      const allocations = await tx.select().from(goalAllocations)
        .where(and(eq(goalAllocations.goalId, goal.id), eq(goalAllocations.workspaceId, context.workspaceId)));
      if (allocations.length) {
        await tx.insert(goalAllocationEvents).values(allocations.map(allocation => ({
          workspaceId: context.workspaceId, goalId: goal.id, walletId: allocation.walletId,
          userId: context.userId, action: 'release', amountMinor: allocation.amountMinor,
        })));
        await tx.delete(goalAllocations)
          .where(and(eq(goalAllocations.goalId, goal.id), eq(goalAllocations.workspaceId, context.workspaceId)));
      }
      await tx.update(savingsGoals).set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(savingsGoals.id, goal.id), eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.userId, context.userId)));
    });
    await recordFinanceAudit(context, { entityType: 'savings_goal', entityId: params.id, action: 'archived', summary: 'Archived savings goal and released its allocations' });
    return NextResponse.json({ ok: true, archived: true, allocationsReleased: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'GOAL_NOT_FOUND') return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    return NextResponse.json({ error: 'Unable to archive savings goal' }, { status: 500 });
  }
}
