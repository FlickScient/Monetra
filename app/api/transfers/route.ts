import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { wallets, transactions } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { walletId, destinationWalletId, amountMinor, description, occurredAt } = await req.json();

  if (!walletId || !destinationWalletId || !amountMinor) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (walletId === destinationWalletId) {
    return NextResponse.json({ error: 'Cannot transfer to same wallet' }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const fromWallet = await tx.query.wallets.findFirst({
      where: and(eq(wallets.id, walletId), eq(wallets.userId, userId)),
    });
    const toWallet = await tx.query.wallets.findFirst({
      where: and(eq(wallets.id, destinationWalletId), eq(wallets.userId, userId)),
    });
    if (!fromWallet || !toWallet) throw new Error('Wallet not found');
    if (fromWallet.currentBalanceMinor < amountMinor) throw new Error('Insufficient funds');

    await tx
      .update(wallets)
      .set({ currentBalanceMinor: sql`${wallets.currentBalanceMinor} - ${amountMinor}`, updatedAt: new Date() })
      .where(eq(wallets.id, walletId));

    await tx
      .update(wallets)
      .set({ currentBalanceMinor: sql`${wallets.currentBalanceMinor} + ${amountMinor}`, updatedAt: new Date() })
      .where(eq(wallets.id, destinationWalletId));

    const [txn] = await tx
      .insert(transactions)
      .values({
        userId,
        transactionType: 'transfer',
        walletId,
        destinationWalletId,
        amountMinor,
        description: description ?? 'Transfer',
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      })
      .returning();

    return { transaction: txn };
  });

  return NextResponse.json(result);
}
