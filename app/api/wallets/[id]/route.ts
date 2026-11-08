import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ledgerAccounts, wallets } from '@/db/schema';
import { goalAllocations } from '@/db/modules-schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { recordFinanceAudit } from '@/lib/audit';
import { isUuid } from '@/lib/validation';

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid wallet ID' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const values: Partial<typeof wallets.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) return NextResponse.json({ error: 'Wallet name must be between 1 and 80 characters' }, { status: 400 });
    values.name = body.name.trim();
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 1000)) return NextResponse.json({ error: 'Notes must be 1,000 characters or fewer' }, { status: 400 });
    values.notes = body.notes;
  }
  if (body.creditLimitMinor !== undefined) {
    if (typeof body.creditLimitMinor !== 'number' || !Number.isSafeInteger(body.creditLimitMinor) || body.creditLimitMinor < 0) return NextResponse.json({ error: 'Invalid credit limit' }, { status: 400 });
  }
  if (body.status !== undefined && !['active', 'inactive'].includes(String(body.status))) return NextResponse.json({ error: 'Invalid wallet status' }, { status: 400 });

  try {
    const wallet = await db.transaction(async tx => {
      const [current] = await tx.select().from(wallets)
        .where(and(eq(wallets.id, params.id), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId)))
        .for('update');
      if (!current) throw new Error('WALLET_NOT_FOUND');
      if (body.creditLimitMinor !== undefined) {
        if (current.walletType !== 'credit_card') throw new Error('CREDIT_LIMIT_ONLY_FOR_CARDS');
        if (Number(body.creditLimitMinor) > 0 && Number(body.creditLimitMinor) < Number(current.currentBalanceMinor)) throw new Error('LIMIT_BELOW_OUTSTANDING');
        values.creditLimitMinor = body.creditLimitMinor as number;
      }
      if (body.status === 'active' && current.status !== 'active') {
        values.status = 'active';
      } else if (body.status === 'inactive' && current.status !== 'inactive') {
        if (Number(current.currentBalanceMinor) !== 0) throw new Error('WALLET_HAS_BALANCE');
        const [allocation] = await tx.select({ id: goalAllocations.id }).from(goalAllocations)
          .where(and(eq(goalAllocations.walletId, current.id), eq(goalAllocations.workspaceId, context.workspaceId))).limit(1);
        if (allocation) throw new Error('WALLET_HAS_ALLOCATIONS');
        values.status = 'inactive';
      }
      const [updated] = await tx.update(wallets).set(values)
        .where(and(eq(wallets.id, current.id), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId)))
        .returning();
      if (values.name) {
        await tx.update(ledgerAccounts).set({ name: 'Wallet: ' + values.name })
          .where(and(eq(ledgerAccounts.walletId, current.id), eq(ledgerAccounts.workspaceId, context.workspaceId)));
      }
      return updated;
    });
    await recordFinanceAudit(context, { entityType: 'wallet', entityId: wallet.id, action: 'updated', summary: 'Updated wallet: ' + wallet.name });
    return NextResponse.json(wallet);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const errors: Record<string, [number, string]> = {
      WALLET_NOT_FOUND: [404, 'Wallet not found'],
      CREDIT_LIMIT_ONLY_FOR_CARDS: [400, 'Credit limits can only be set on credit-card wallets'],
      LIMIT_BELOW_OUTSTANDING: [400, 'Credit limit cannot be lower than the current outstanding balance'],
      WALLET_HAS_BALANCE: [409, 'Move the remaining balance out of this wallet before archiving it'],
      WALLET_HAS_ALLOCATIONS: [409, 'Release this wallet from all savings goals before archiving it'],
    };
    if (errors[code]) return NextResponse.json({ error: errors[code][1] }, { status: errors[code][0] });
    console.error('MONETRA_WALLET_UPDATE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to update wallet' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid wallet ID' }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [wallet] = await tx.select().from(wallets)
        .where(and(eq(wallets.id, params.id), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId)))
        .for('update');
      if (!wallet) throw new Error('WALLET_NOT_FOUND');
      if (Number(wallet.currentBalanceMinor) !== 0) throw new Error('WALLET_HAS_BALANCE');
      const [allocation] = await tx.select({ id: goalAllocations.id }).from(goalAllocations)
        .where(and(eq(goalAllocations.walletId, wallet.id), eq(goalAllocations.workspaceId, context.workspaceId))).limit(1);
      if (allocation) throw new Error('WALLET_HAS_ALLOCATIONS');
      await tx.update(wallets).set({ status: 'inactive', updatedAt: new Date() })
        .where(and(eq(wallets.id, wallet.id), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId), eq(wallets.status, 'active')));
    });
    await recordFinanceAudit(context, { entityType: 'wallet', entityId: params.id, action: 'archived', summary: 'Archived wallet' });
    return NextResponse.json({ ok: true, archived: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const errors: Record<string, [number, string]> = {
      WALLET_NOT_FOUND: [404, 'Wallet not found'],
      WALLET_HAS_BALANCE: [409, 'Move the remaining balance out of this wallet before archiving it'],
      WALLET_HAS_ALLOCATIONS: [409, 'Release this wallet from all savings goals before archiving it'],
    };
    if (errors[code]) return NextResponse.json({ error: errors[code][1] }, { status: errors[code][0] });
    console.error('MONETRA_WALLET_ARCHIVE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to archive wallet' }, { status: 500 });
  }
}
