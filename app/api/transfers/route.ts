import { NextResponse } from 'next/server';
import { getWorkspaceContext } from '@/lib/workspace';
import { db } from '@/db';
import { wallets, transactions } from '@/db/schema';
import { eq, sql, and, gte, inArray, asc } from 'drizzle-orm';

export async function POST(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { walletId, destinationWalletId, amountMinor, description, occurredAt } = body;

  if (
    typeof walletId !== 'string' ||
    typeof destinationWalletId !== 'string' ||
    typeof amountMinor !== 'number' ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    (description !== undefined && typeof description !== 'string')
  ) {
    return NextResponse.json({ error: 'Invalid or missing transfer fields' }, { status: 400 });
  }

  if (walletId === destinationWalletId) {
    return NextResponse.json({ error: 'Cannot transfer to same wallet' }, { status: 400 });
  }

  const parsedDate = occurredAt === undefined ? new Date() : new Date(String(occurredAt));
  if (Number.isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: 'Invalid occurredAt date' }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock both wallets in a deterministic order. Opposite-direction transfers
      // therefore cannot deadlock by each locking its source before its destination.
      const lockedWallets = await tx.select().from(wallets)
        .where(and(
          eq(wallets.workspaceId, context.workspaceId),
          inArray(wallets.id, [walletId, destinationWalletId]),
        ))
        .orderBy(asc(wallets.id))
        .for('update');
      const fromWallet = lockedWallets.find((wallet) => wallet.id === walletId);
      const toWallet = lockedWallets.find((wallet) => wallet.id === destinationWalletId);

      if (
        !fromWallet ||
        !toWallet ||
        fromWallet.status !== 'active' ||
        toWallet.status !== 'active'
      ) {
        throw new Error('WALLET_NOT_AVAILABLE');
      }

      if (fromWallet.walletType === 'credit_card') {
        throw new Error('INVALID_SOURCE_WALLET');
      }
      if (fromWallet.currency !== toWallet.currency) {
        throw new Error('CURRENCY_MISMATCH');
      }

      // Keep the balance check inside the UPDATE to prevent concurrent overspending.
      const [updatedSource] = await tx
        .update(wallets)
        .set({
          currentBalanceMinor: sql`${wallets.currentBalanceMinor} - ${amountMinor}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wallets.id, walletId),
            eq(wallets.workspaceId, context.workspaceId),
            gte(wallets.currentBalanceMinor, amountMinor),
          ),
        )
        .returning({ id: wallets.id });

      if (!updatedSource) throw new Error('INSUFFICIENT_FUNDS');

      // A payment into a credit card reduces its outstanding balance.
      const destinationDelta =
        toWallet.walletType === 'credit_card' ? -amountMinor : amountMinor;

      const [updatedDestination] = await tx
        .update(wallets)
        .set({
          currentBalanceMinor: sql`${wallets.currentBalanceMinor} + ${destinationDelta}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(wallets.id, destinationWalletId),
          eq(wallets.workspaceId, context.workspaceId),
          eq(wallets.status, 'active'),
        ))
        .returning({ id: wallets.id });

      if (!updatedDestination) throw new Error('WALLET_NOT_AVAILABLE');

      const [txn] = await tx
        .insert(transactions)
        .values({
          userId: context.userId,
          workspaceId: context.workspaceId,
          transactionType: 'transfer',
          walletId,
          destinationWalletId,
          amountMinor,
          description: typeof description === 'string' && description.trim()
            ? description.trim()
            : 'Transfer',
          occurredAt: parsedDate,
        })
        .returning();

      return { transaction: txn };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'WALLET_NOT_AVAILABLE') {
      return NextResponse.json({ error: 'Wallet not found or inactive' }, { status: 404 });
    }
    if (code === 'INVALID_SOURCE_WALLET') {
      return NextResponse.json({ error: 'Credit cards cannot be used as transfer sources' }, { status: 400 });
    }
    if (code === 'CURRENCY_MISMATCH') {
      return NextResponse.json({ error: 'Transfers require wallets with the same currency' }, { status: 400 });
    }
    if (code === 'INSUFFICIENT_FUNDS') {
      return NextResponse.json({ error: 'Insufficient funds' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to create transfer' }, { status: 500 });
  }
}
