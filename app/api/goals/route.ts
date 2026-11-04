import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { savingsGoals, goalAllocations } from '@/db/modules-schema';
import { getOrganizationContext, canWriteOrganization } from '@/lib/organization';

export async function GET(req: Request) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    const goals = await db.select().from(savingsGoals)
      .where(and(eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.status, 'active')))
      .orderBy(asc(savingsGoals.createdAt));
    const allocations = goals.length
      ? await db.select().from(goalAllocations).where(eq(goalAllocations.workspaceId, context.workspaceId))
      : [];
    return NextResponse.json(goals.map(goal => ({
      ...goal,
      allocations: allocations.filter(item => item.goalId === goal.id),
    })));
  } catch {
    return NextResponse.json({ error: 'Unable to load savings goals' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!canWriteOrganization(context.role)) return NextResponse.json({ error: 'Read-only workspace access' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const targetMinor = body.targetMinor;
  const currency = body.currency ?? 'BDT';
  const targetDate = body.targetDate;
  if (!name || name.length > 100 || typeof targetMinor !== 'number' || !Number.isSafeInteger(targetMinor) || targetMinor <= 0 ||
      typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
      (targetDate !== undefined && targetDate !== null && (typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)))) {
    return NextResponse.json({ error: 'Provide a valid name, target amount, currency and optional target date' }, { status: 400 });
  }
  try {
    const [goal] = await db.insert(savingsGoals).values({
      workspaceId: context.workspaceId, userId: context.userId, name,
      targetMinor, currency, targetDate: targetDate || null,
    }).returning();
    return NextResponse.json({ ...goal, allocations: [] }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to create savings goal' }, { status: 500 });
  }
}
