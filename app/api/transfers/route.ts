import { NextResponse } from 'next/server';
import { getWorkspaceContext } from '@/lib/workspace';
import { db } from '@/db';
import { wallets, transactions } from '@/db/schema';
import { postFinancialJournal } from '@/lib/ledger';
import { isUuid } from '@/lib/validation';
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
    !isUuid(walletId) ||
    !isUuid(destinationWalletId) ||
    typeof amountMinor !== 'number' ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    (description !== undefined && (typeof description !== 'string' || description.trim().length > 500))
  ) {
    return NextResponse.json({ error: 'Invalid or missing transfer fields' }, { status: 400 });
  }

  if (walletId === destinationWalletId) {
    return NextResponse.json({ error: 'Cannot transfer to same wallet' }, { status: 400 });
  }

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '');
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
    return NextResponse.json({ error: 'Invalid idempotency key' }, { status: 400 });
  }

  const normalizedDescription = typeof description === 'string' && description.trim() ? description.trim() : 'Transfer';
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
          const sameRequest = prior.transactionType === 'transfer' && prior.walletId === walletId &&
            prior.destinationWalletId === destinationWalletId && Number(prior.amountMinor) === amountMinor &&
            prior.description === normalizedDescription;
          if (!sameRequest) throw new Error('IDEMPOTENCY_KEY_REUSED');
          return { transaction: prior, replayed: true };
        }
      }

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

      if (toWallet.walletType === 'credit_card' && amountMinor > Number(toWallet.currentBalanceMinor)) {
        throw new Error('PAYMENT_EXCEEDS_CARD_BALANCE');
      }
      const destinationDelta = toWallet.walletType === 'credit_card' ? -amountMinor : amountMinor;
      if (!Number.isSafeInteger(Number(toWallet.currentBalanceMinor) + destinationDelta)) {
        throw new Error('BALANCE_LIMIT_EXCEEDED');
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
          idempotencyKey: idempotencyKey || null,
          description: normalizedDescription,
          occurredAt: parsedDate,
        })
        .returning();

      await postFinancialJournal(tx, context, txn, fromWallet, toWallet);
      return { transaction: txn, replayed: false };
    });

    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'IDEMPOTENCY_KEY_REUSED') {
      return NextResponse.json({ error: 'This idempotency key was already used for a different transfer' }, { status: 409 });
    }
    if (code === 'WALLET_NOT_AVAILABLE') {
      return NextResponse.json({ error: 'Wallet not found or inactive' }, { status: 404 });
    }
    if (code === 'INVALID_SOURCE_WALLET') {
      return NextResponse.json({ error: 'Credit cards cannot be used as transfer sources' }, { status: 400 });
    }
    if (code === 'CURRENCY_MISMATCH') {
      return NextResponse.json({ error: 'Transfers require wallets with the same currency' }, { status: 400 });
    }
    if (code === 'PAYMENT_EXCEEDS_CARD_BALANCE') {
      return NextResponse.json({ error: 'Payment cannot exceed the card outstanding balance' }, { status: 400 });
    }
    if (code === 'BALANCE_LIMIT_EXCEEDED') {
      return NextResponse.json({ error: 'This balance exceeds the supported safe integer range' }, { status: 400 });
    }
    if (code === 'INSUFFICIENT_FUNDS') {
      return NextResponse.json({ error: 'Insufficient funds' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to create transfer' }, { status: 500 });
  }
}
