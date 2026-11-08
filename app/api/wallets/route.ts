import { NextResponse } from 'next/server';
import { getWorkspaceContext } from '@/lib/workspace';
import { recordFinanceAudit } from '@/lib/audit';
import { db } from '@/db';
import { wallets } from '@/db/schema';
import { ensureWalletLedgerAccount } from '@/lib/ledger';

const WALLET_TYPES = new Set([
  'cash',
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'savings',
  'debit_card',
  'credit_card',
  'custom',
]);

export async function POST(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, walletType, currency = 'BDT', openingBalanceMinor = 0, notes = null, creditLimitMinor = 0 } = body;

  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > 80 ||
    typeof walletType !== 'string' ||
    !WALLET_TYPES.has(walletType)
  ) {
    return NextResponse.json({ error: 'Valid name and walletType are required' }, { status: 400 });
  }

  if (
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency) ||
    typeof openingBalanceMinor !== 'number' ||
    !Number.isSafeInteger(openingBalanceMinor) ||
    openingBalanceMinor < 0 ||
    typeof notes !== 'string' && notes !== null ||
    typeof notes === 'string' && notes.length > 1000 ||
    typeof creditLimitMinor !== 'number' || !Number.isSafeInteger(creditLimitMinor) || creditLimitMinor < 0 ||
    walletType !== 'credit_card' && creditLimitMinor !== 0 ||
    walletType === 'credit_card' && creditLimitMinor > 0 && openingBalanceMinor > creditLimitMinor
  ) {
    return NextResponse.json({ error: 'Invalid currency or opening balance' }, { status: 400 });
  }

  try {
    const wallet = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(wallets)
        .values({
          userId: context.userId,
          workspaceId: context.workspaceId,
          name: name.trim(),
          walletType,
          currency,
          openingBalanceMinor,
          currentBalanceMinor: openingBalanceMinor,
          notes,
          creditLimitMinor,
        })
        .returning();

      await ensureWalletLedgerAccount(tx, context, created);
      return created;
    });

    await recordFinanceAudit(context, { entityType: 'wallet', entityId: wallet.id, action: 'created', summary: 'Created wallet: ' + wallet.name });
    return NextResponse.json(wallet, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'LEDGER_BALANCE_OUT_OF_RANGE' || code === 'LEDGER_ACCOUNT_TYPE_MISMATCH') {
      return NextResponse.json({ error: 'Wallet ledger needs reconciliation before this wallet can be created' }, { status: 409 });
    }
    console.error('MONETRA_WALLET_CREATE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to create wallet' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  try {
    const userWallets = await db.query.wallets.findMany({
      where: (w, { and, eq }) => and(eq(w.workspaceId, context.workspaceId), eq(w.userId, context.userId)),
      orderBy: (w, { asc }) => asc(w.createdAt),
    });

    if (userWallets.some((wallet) => !Number.isSafeInteger(wallet.currentBalanceMinor))) {
      return NextResponse.json({ error: 'A wallet balance exceeds the supported safe integer range and needs reconciliation' }, { status: 409 });
    }

    return NextResponse.json(userWallets);
  } catch {
    return NextResponse.json({ error: 'Unable to load wallets' }, { status: 500 });
  }
}
