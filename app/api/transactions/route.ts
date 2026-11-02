import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { wallets, transactions } from '@/db/schema';
import { eq, sql, and, desc } from 'drizzle-orm';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db.query.transactions.findMany({
    where: (t, { eq }) => eq(t.userId, userId),
    orderBy: (t, { desc }) => desc(t.occurredAt),
    limit: 50,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { walletId, transactionType, amountMinor, categoryId, description, occurredAt } =
    await req.json();

  if (!walletId || !transactionType || !amountMinor || !description) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (!['income', 'expense'].includes(transactionType)) {
    return NextResponse.json({ error: 'Invalid transactionType' }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const wallet = await tx.query.wallets.findFirst({
      where: and(eq(wallets.id, walletId), eq(wallets.userId, userId)),
    });
    if (!wallet) throw new Error('Wallet not found');

    const isCreditCard = wallet.walletType === 'credit_card';
    const increasesBalance = transactionType === 'income' || (transactionType === 'expense' && isCreditCard);
    const delta = increasesBalance ? amountMinor : -amountMinor;

    const [updatedWallet] = await tx
      .update(wallets)
      .set({
        currentBalanceMinor: sql`${wallets.currentBalanceMinor} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, walletId))
      .returning();

    const [txn] = await tx
      .insert(transactions)
      .values({
        userId,
        transactionType,
        walletId,
        categoryId,
        amountMinor,
        description,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      })
      .returning();

    return { transaction: txn, wallet: updatedWallet };
  });

  return NextResponse.json(result);
}
