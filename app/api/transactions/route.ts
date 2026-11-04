import { NextResponse } from 'next/server';
import { getWorkspaceContext } from '@/lib/workspace';
import { db } from '@/db';
import { wallets, transactions, categories } from '@/db/schema';
import { eq, sql, and, gte, ne, desc } from 'drizzle-orm';
import { postFinancialJournal } from '@/lib/ledger';
import { isUuid } from '@/lib/validation';

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
  const requestedOffset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100000) : 0;

  try {
    const rows = await db.select({
      id: transactions.id,
      transactionType: transactions.transactionType,
      walletId: transactions.walletId,
      destinationWalletId: transactions.destinationWalletId,
      categoryId: transactions.categoryId,
      amountMinor: transactions.amountMinor,
      description: transactions.description,
      occurredAt: transactions.occurredAt,
    }).from(transactions)
      .where(and(
        eq(transactions.workspaceId, context.workspaceId),
        ne(transactions.transactionType, 'adjustment'),
      ))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(limit + 1)
      .offset(offset);
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: 'Unable to load transactions' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { walletId, transactionType, amountMinor, categoryId, description, occurredAt } = body;

  if (
    !isUuid(walletId) ||
    typeof transactionType !== 'string' ||
    typeof description !== 'string' ||
    !description.trim() ||
    description.trim().length > 500 ||
    typeof amountMinor !== 'number' ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    return NextResponse.json({ error: 'Invalid or missing transaction fields' }, { status: 400 });
  }

  if (!['income', 'expense'].includes(transactionType)) {
    return NextResponse.json({ error: 'Invalid transactionType' }, { status: 400 });
  }

  if (categoryId !== undefined && categoryId !== null && !isUuid(categoryId)) {
    return NextResponse.json({ error: 'Invalid categoryId' }, { status: 400 });
  }

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '');
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
    return NextResponse.json({ error: 'Invalid idempotency key' }, { status: 400 });
  }

  const parsedDate = occurredAt === undefined ? new Date() : new Date(String(occurredAt));
  if (Number.isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: 'Invalid occurredAt date' }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (idempotencyKey) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${context.workspaceId}), hashtext(${idempotencyKey}))`);
        const [prior] = await tx.select().from(transactions)
          .where(and(eq(transactions.workspaceId, context.workspaceId), eq(transactions.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (prior) {
          const sameRequest = prior.walletId === walletId && prior.transactionType === transactionType &&
            prior.categoryId === (categoryId || null) && Number(prior.amountMinor) === amountMinor &&
            prior.description === description.trim() &&
            (occurredAt === undefined || prior.occurredAt.getTime() === parsedDate.getTime());
          if (!sameRequest) throw new Error('IDEMPOTENCY_KEY_REUSED');
          const [currentWallet] = await tx.select().from(wallets)
            .where(and(eq(wallets.id, walletId), eq(wallets.workspaceId, context.workspaceId)));
          return { transaction: prior, wallet: currentWallet, replayed: true };
        }
      }

      const [wallet] = await tx.select().from(wallets)
        .where(and(eq(wallets.id, walletId), eq(wallets.workspaceId, context.workspaceId)))
        .for('update');
      if (!wallet || wallet.status !== 'active') {
        throw new Error('WALLET_NOT_AVAILABLE');
      }

      if (categoryId) {
        const category = await tx.query.categories.findFirst({
          where: and(eq(categories.id, categoryId), eq(categories.workspaceId, context.workspaceId)),
        });
        if (!category || category.categoryType !== transactionType) {
          throw new Error('INVALID_CATEGORY');
        }
      }

      const isCreditCard = wallet.walletType === 'credit_card';
      if (isCreditCard && transactionType === 'expense' && Number(wallet.creditLimitMinor) > 0 &&
          Number(wallet.currentBalanceMinor) + amountMinor > Number(wallet.creditLimitMinor)) {
        throw new Error('CREDIT_LIMIT_EXCEEDED');
      }

      // Credit-card balances represent liabilities: purchases add debt, refunds reduce it.
      const increasesBalance = isCreditCard
        ? transactionType === 'expense'
        : transactionType === 'income';
      const decreasesBalance = !increasesBalance;
      const delta = increasesBalance ? amountMinor : -amountMinor;
      if (!Number.isSafeInteger(Number(wallet.currentBalanceMinor) + delta)) {
        throw new Error('BALANCE_LIMIT_EXCEEDED');
      }

      const [updatedWallet] = await tx
        .update(wallets)
        .set({
          currentBalanceMinor: sql`${wallets.currentBalanceMinor} + ${delta}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wallets.id, walletId),
            eq(wallets.workspaceId, context.workspaceId),
            eq(wallets.status, 'active'),
            ...(decreasesBalance ? [gte(wallets.currentBalanceMinor, amountMinor)] : []),
          ),
        )
        .returning();

      if (!updatedWallet) throw new Error('INSUFFICIENT_FUNDS');

      const [txn] = await tx
        .insert(transactions)
        .values({
          userId: context.userId,
          workspaceId: context.workspaceId,
          transactionType,
          walletId,
          categoryId: categoryId ? categoryId : null,
          idempotencyKey: idempotencyKey || null,
          amountMinor,
          description: description.trim(),
          occurredAt: parsedDate,
        })
        .returning();

      await postFinancialJournal(tx, context, txn, wallet);
      return { transaction: txn, wallet: updatedWallet, replayed: false };
    });

    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
      return NextResponse.json({ error: 'This idempotency key was already used for a different transaction' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'WALLET_NOT_AVAILABLE') {
      return NextResponse.json({ error: 'Wallet not found or inactive' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'INVALID_CATEGORY') {
      return NextResponse.json({ error: 'Category not found or does not match transaction type' }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'CREDIT_LIMIT_EXCEEDED') {
      return NextResponse.json({ error: 'This transaction would exceed the wallet credit limit' }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'BALANCE_LIMIT_EXCEEDED') {
      return NextResponse.json({ error: 'This balance exceeds the supported safe integer range' }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'INSUFFICIENT_FUNDS') {
      return NextResponse.json({ error: 'Insufficient funds' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to create transaction' }, { status: 500 });
  }
}
