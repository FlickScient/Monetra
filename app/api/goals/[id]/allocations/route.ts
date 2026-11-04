import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { goalAllocations, goalAllocationEvents, savingsGoals } from '@/db/modules-schema';
import { wallets } from '@/db/schema';
import { getWorkspaceContext } from '@/lib/workspace';

type Params = { params: { id: string } };

export async function GET(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    const goal = await db.query.savingsGoals.findFirst({ where: (g, { and, eq }) => and(eq(g.id, params.id), eq(g.workspaceId, context.workspaceId)) });
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    const history = await db.select().from(goalAllocationEvents)
      .where(and(eq(goalAllocationEvents.goalId, params.id), eq(goalAllocationEvents.workspaceId, context.workspaceId)))
      .orderBy(sql`${goalAllocationEvents.createdAt} desc`);
    return NextResponse.json(history);
  } catch { return NextResponse.json({ error: 'Unable to load allocation history' }, { status: 500 }); }
}

export async function POST(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { walletId, amountMinor, action } = body;
  if (typeof walletId !== 'string' || typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !['allocate', 'release'].includes(String(action))) {
    return NextResponse.json({ error: 'Provide a wallet, positive amount and allocate/release action' }, { status: 400 });
  }
  try {
    const result = await db.transaction(async tx => {
      const [goal] = await tx.select().from(savingsGoals)
        .where(and(eq(savingsGoals.id, params.id), eq(savingsGoals.workspaceId, context.workspaceId), eq(savingsGoals.status, 'active')));
      if (!goal) throw new Error('GOAL_NOT_FOUND');

      // Serialize allocation changes per wallet to prevent concurrent over-allocation.
      const [wallet] = await tx.select().from(wallets)
        .where(and(eq(wallets.id, walletId), eq(wallets.workspaceId, context.workspaceId), eq(wallets.status, 'active')))
        .for('update');
      if (!wallet) throw new Error('WALLET_NOT_FOUND');
      if (wallet.currency !== goal.currency || wallet.walletType === 'credit_card') throw new Error('WALLET_NOT_ELIGIBLE');

      const [existing] = await tx.select().from(goalAllocations)
        .where(and(eq(goalAllocations.goalId, goal.id), eq(goalAllocations.walletId, wallet.id), eq(goalAllocations.workspaceId, context.workspaceId)));
      const current = Number(existing?.amountMinor ?? 0);

      if (action === 'allocate') {
        const [reserved] = await tx.select({ total: sql<string>`coalesce(sum(${goalAllocations.amountMinor}), 0)::text` })
          .from(goalAllocations).where(and(eq(goalAllocations.walletId, wallet.id), eq(goalAllocations.workspaceId, context.workspaceId)));
        const available = Number(wallet.currentBalanceMinor) - Number(reserved?.total ?? 0);
        if (amountMinor > available) throw new Error('INSUFFICIENT_AVAILABLE');
        const next = current + amountMinor;
        if (existing) {
          await tx.update(goalAllocations).set({ amountMinor: next, updatedAt: new Date() }).where(eq(goalAllocations.id, existing.id));
        } else {
          await tx.insert(goalAllocations).values({ workspaceId: context.workspaceId, goalId: goal.id, walletId: wallet.id, amountMinor: next });
        }
      } else {
        if (amountMinor > current) throw new Error('INSUFFICIENT_ALLOCATION');
        const next = current - amountMinor;
        if (next === 0) await tx.delete(goalAllocations).where(eq(goalAllocations.id, existing!.id));
        else await tx.update(goalAllocations).set({ amountMinor: next, updatedAt: new Date() }).where(eq(goalAllocations.id, existing!.id));
      }

      const [event] = await tx.insert(goalAllocationEvents).values({
        workspaceId: context.workspaceId, goalId: goal.id, walletId: wallet.id,
        userId: context.userId, action: String(action), amountMinor,
      }).returning();
      return event;
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'GOAL_NOT_FOUND') return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    if (code === 'WALLET_NOT_FOUND') return NextResponse.json({ error: 'Wallet not found or inactive' }, { status: 404 });
    if (code === 'WALLET_NOT_ELIGIBLE') return NextResponse.json({ error: 'This wallet cannot fund this goal' }, { status: 400 });
    if (code === 'INSUFFICIENT_AVAILABLE') return NextResponse.json({ error: 'Not enough unallocated wallet balance' }, { status: 400 });
    if (code === 'INSUFFICIENT_ALLOCATION') return NextResponse.json({ error: 'Cannot release more than this goal holds in the wallet' }, { status: 400 });
    return NextResponse.json({ error: 'Unable to update goal allocation' }, { status: 500 });
  }
}
