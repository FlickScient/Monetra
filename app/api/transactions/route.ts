import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { wallets, transactions, categories } from '@/db/schema';
import { eq, sql, and, desc } from 'drizzle-orm';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await db.query.transactions.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
      orderBy: (t, { desc }) => desc(t.occurredAt),
      limit: 50,
    });
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: 'Unable to load transactions' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { walletId, transactionType, amountMinor, categoryId, description, occurredAt } = body;

  if (
    typeof walletId !== 'string' ||
    typeof transactionType !== 'string' ||
    typeof description !== 'string' ||
    !description.trim() ||
    typeof amountMinor !== 'number' ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    return NextResponse.json({ error: 'Invalid or missing transaction fields' }, { status: 400 });
  }

  if (!['income', 'expense'].includes(transactionType)) {
    return NextResponse.json({ error: 'Invalid transactionType' }, { status: 400 });
  }

  if (categoryId !== undefined && categoryId !== null && typeof categoryId !== 'string') {
    return NextResponse.json({ error: 'Invalid categoryId' }, { status: 400 });
  }

  const parsedDate = occurredAt === undefined ? new Date() : new Date(String(occurredAt));
  if (Number.isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: 'Invalid occurredAt date' }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const wallet = await tx.query.wallets.findFirst({
        where: and(eq(wallets.id, walletId), eq(wallets.userId, userId)),
      });
      if (!wallet || wallet.status !== 'active') {
        throw new Error('WALLET_NOT_AVAILABLE');
      }

      if (categoryId) {
        const category = await tx.query.categories.findFirst({
          where: and(eq(categories.id, categoryId), eq(categories.userId, userId)),
        });
        if (!category || category.categoryType !== transactionType) {
          throw new Error('INVALID_CATEGORY');
        }
      }

      const isCreditCard = wallet.walletType === 'credit_card';
      const increasesBalance =
        transactionType === 'income' || (transactionType === 'expense' && isCreditCard);
      const delta = increasesBalance ? amountMinor : -amountMinor;

      const [updatedWallet] = await tx
        .update(wallets)
        .set({
          currentBalanceMinor: sql`${wallets.currentBalanceMinor} + ${delta}`,
          updatedAt: new Date(),
        })
        .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
        .returning();

      const [txn] = await tx
        .insert(transactions)
        .values({
          userId,
          transactionType,
          walletId,
          categoryId: categoryId ? categoryId : null,
          amountMinor,
          description: description.trim(),
          occurredAt: parsedDate,
        })
        .returning();

      return { transaction: txn, wallet: updatedWallet };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'WALLET_NOT_AVAILABLE') {
      return NextResponse.json({ error: 'Wallet not found or inactive' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'INVALID_CATEGORY') {
      return NextResponse.json({ error: 'Category not found or does not match transaction type' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to create transaction' }, { status: 500 });
  }
}
