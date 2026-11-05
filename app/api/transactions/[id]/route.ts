import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { categories, ledgerEntries, transactions, wallets } from '@/db/schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { isUuid } from '@/lib/validation';
import { postFinancialJournal } from '@/lib/ledger';

type Params = { params: { id: string } };
type FinanceType = 'income' | 'expense' | 'transfer';
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function effectsFor(
  transaction: { transactionType: string; walletId: string; destinationWalletId: string | null; amountMinor: number },
  walletTypes: Map<string, string>,
) {
  const effects: Record<string, number> = {};
  const add = (id: string, delta: number) => { effects[id] = (effects[id] || 0) + delta; };
  const sourceType = walletTypes.get(transaction.walletId);
  if (!sourceType) throw new Error('WALLET_NOT_AVAILABLE');
  if (transaction.transactionType === 'income') add(transaction.walletId, sourceType === 'credit_card' ? -transaction.amountMinor : transaction.amountMinor);
  else if (transaction.transactionType === 'expense') add(transaction.walletId, sourceType === 'credit_card' ? transaction.amountMinor : -transaction.amountMinor);
  else if (transaction.transactionType === 'transfer') {
    if (!transaction.destinationWalletId) throw new Error('INVALID_TRANSFER');
    const destinationType = walletTypes.get(transaction.destinationWalletId);
    if (!destinationType || sourceType === 'credit_card') throw new Error('INVALID_TRANSFER');
    add(transaction.walletId, -transaction.amountMinor);
    add(transaction.destinationWalletId, destinationType === 'credit_card' ? -transaction.amountMinor : transaction.amountMinor);
  } else throw new Error('UNSUPPORTED_TRANSACTION');
  return effects;
}

function reverseEntries(rows: Array<typeof ledgerEntries.$inferSelect>, workspaceId: string, userId: string) {
  return rows.map(row => ({
    workspaceId, userId, transactionId: row.transactionId, ledgerAccountId: row.ledgerAccountId,
    debitMinor: row.creditMinor, creditMinor: row.debitMinor,
  }));
}

async function lockRelatedWallets(tx: DbTx, workspaceId: string, ids: string[]) {
  return tx.select().from(wallets)
    .where(and(eq(wallets.workspaceId, workspaceId), inArray(wallets.id, Array.from(new Set(ids)))))
    .orderBy(asc(wallets.id)).for('update');
}

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  try {
    const updated = await db.transaction(async tx => {
      const [current] = await tx.select().from(transactions)
        .where(and(eq(transactions.id, params.id), eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), isNull(transactions.voidedAt)))
        .for('update');
      if (!current || current.transactionType === 'adjustment') throw new Error('TRANSACTION_NOT_FOUND');

      const type = (body.transactionType === undefined ? current.transactionType : body.transactionType) as FinanceType;
      const walletId = body.walletId === undefined ? current.walletId : body.walletId;
      const destinationWalletId = body.destinationWalletId === undefined ? current.destinationWalletId : body.destinationWalletId;
      const categoryId = body.categoryId === undefined ? current.categoryId : body.categoryId;
      const amountMinor = body.amountMinor === undefined ? Number(current.amountMinor) : body.amountMinor;
      const description = body.description === undefined ? current.description : body.description;
      const occurredAt = body.occurredAt === undefined ? current.occurredAt : new Date(String(body.occurredAt));

      if (!['income', 'expense', 'transfer'].includes(String(type)) || !isUuid(walletId) ||
          (type === 'transfer' ? !isUuid(destinationWalletId) || destinationWalletId === walletId : destinationWalletId !== null && destinationWalletId !== undefined) ||
          (type !== 'transfer' && categoryId !== null && categoryId !== undefined && !isUuid(categoryId)) ||
          typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
          typeof description !== 'string' || !description.trim() || description.trim().length > 500 ||
          Number.isNaN(occurredAt.getTime()) || (type === 'transfer' && categoryId !== null && categoryId !== undefined)) {
        throw new Error('INVALID_TRANSACTION_FIELDS');
      }

      if (categoryId) {
        const [category] = await tx.select().from(categories)
          .where(and(eq(categories.id, String(categoryId)), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId)));
        if (!category || category.categoryType !== type) throw new Error('INVALID_CATEGORY');
      }

      const relatedIds = [current.walletId, ...(current.destinationWalletId ? [current.destinationWalletId] : []), String(walletId), ...(type === 'transfer' ? [String(destinationWalletId)] : [])];
      const locked = await lockRelatedWallets(tx, context.workspaceId, relatedIds);
      const walletMap = new Map(locked.map(wallet => [wallet.id, wallet] as const));
      if (relatedIds.some(id => !walletMap.has(id)) || locked.some(wallet => wallet.status !== 'active')) throw new Error('WALLET_NOT_AVAILABLE');
      if (locked.some(wallet => !Number.isSafeInteger(wallet.currentBalanceMinor))) throw new Error('LEDGER_BALANCE_OUT_OF_RANGE');

      const walletTypes = new Map(locked.map(wallet => [wallet.id, wallet.walletType] as const));
      const oldEffects = effectsFor(current, walletTypes);
      const newDraft = { transactionType: type, walletId: String(walletId), destinationWalletId: type === 'transfer' ? String(destinationWalletId) : null, amountMinor };
      const newEffects = effectsFor(newDraft, walletTypes);
      const intermediate: Record<string, number> = {};
      const finalBalances: Record<string, number> = {};
      locked.forEach(wallet => {
        const reversed = Number(wallet.currentBalanceMinor) - (oldEffects[wallet.id] || 0);
        const finalValue = reversed + (newEffects[wallet.id] || 0);
        if (!Number.isSafeInteger(reversed) || !Number.isSafeInteger(finalValue)) throw new Error('BALANCE_LIMIT_EXCEEDED');
        intermediate[wallet.id] = reversed;
        finalBalances[wallet.id] = finalValue;
      });

      const source = walletMap.get(String(walletId))!;
      if (type === 'transfer') {
        const destination = walletMap.get(String(destinationWalletId))!;
        if (source.walletType === 'credit_card') throw new Error('INVALID_TRANSFER_SOURCE');
        if (source.currency !== destination.currency) throw new Error('CURRENCY_MISMATCH');
        if (intermediate[source.id] < amountMinor) throw new Error('INSUFFICIENT_FUNDS');
        if (destination.walletType === 'credit_card' && intermediate[destination.id] < amountMinor) throw new Error('PAYMENT_EXCEEDS_CARD_BALANCE');
      } else if (source.walletType === 'credit_card') {
        if (type === 'income' && intermediate[source.id] < amountMinor) throw new Error('PAYMENT_EXCEEDS_CARD_BALANCE');
        if (type === 'expense' && Number(source.creditLimitMinor) > 0 && intermediate[source.id] + amountMinor > Number(source.creditLimitMinor)) throw new Error('CREDIT_LIMIT_EXCEEDED');
      }

      const oldLines = await tx.select().from(ledgerEntries)
        .where(and(eq(ledgerEntries.transactionId, current.id), eq(ledgerEntries.workspaceId, context.workspaceId)));
      if (oldLines.length < 2) throw new Error('LEDGER_ENTRIES_MISSING');
      await tx.insert(ledgerEntries).values(reverseEntries(oldLines, context.workspaceId, context.userId));

      for (const wallet of locked) {
        if (intermediate[wallet.id] !== Number(wallet.currentBalanceMinor)) {
          await tx.update(wallets).set({ currentBalanceMinor: intermediate[wallet.id], updatedAt: new Date() })
            .where(and(eq(wallets.id, wallet.id), eq(wallets.workspaceId, context.workspaceId)));
        }
      }

      const [saved] = await tx.update(transactions).set({
        transactionType: type, walletId: String(walletId),
        destinationWalletId: type === 'transfer' ? String(destinationWalletId) : null,
        categoryId: type === 'transfer' ? null : (categoryId ? String(categoryId) : null),
        amountMinor, description: description.trim(), occurredAt,
      }).where(and(eq(transactions.id, current.id), eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), isNull(transactions.voidedAt))).returning();

      if (!saved) throw new Error('TRANSACTION_NOT_FOUND');
      const sourceSnapshot = { ...source, currentBalanceMinor: intermediate[source.id] };
      const destinationSnapshot = type === 'transfer'
        ? { ...walletMap.get(String(destinationWalletId))!, currentBalanceMinor: intermediate[String(destinationWalletId)] }
        : undefined;
      await postFinancialJournal(tx, context, saved, sourceSnapshot, destinationSnapshot);

      for (const wallet of locked) {
        if (finalBalances[wallet.id] !== intermediate[wallet.id]) {
          await tx.update(wallets).set({ currentBalanceMinor: finalBalances[wallet.id], updatedAt: new Date() })
            .where(and(eq(wallets.id, wallet.id), eq(wallets.workspaceId, context.workspaceId)));
        }
      }
      return saved;
    });
    return NextResponse.json(updated);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string, [number, string]> = {
      TRANSACTION_NOT_FOUND: [404, 'Transaction not found or already deleted'],
      INVALID_TRANSACTION_FIELDS: [400, 'Check the transaction type, wallet, amount, date and description'],
      INVALID_CATEGORY: [400, 'Category not found or does not match transaction type'],
      WALLET_NOT_AVAILABLE: [404, 'One of the selected wallets is unavailable'],
      LEDGER_BALANCE_OUT_OF_RANGE: [409, 'Wallet balance needs reconciliation before editing'],
      BALANCE_LIMIT_EXCEEDED: [400, 'This balance exceeds the supported safe integer range'],
      INVALID_TRANSFER: [400, 'Invalid transfer details'],
      UNSUPPORTED_TRANSACTION: [400, 'This transaction type cannot be edited'],
      INVALID_TRANSFER_SOURCE: [400, 'Credit cards cannot be transfer sources'],
      CURRENCY_MISMATCH: [400, 'Transfers require wallets with the same currency'],
      INSUFFICIENT_FUNDS: [400, 'The selected wallet would not have enough balance for this transfer'],
      PAYMENT_EXCEEDS_CARD_BALANCE: [400, 'Payment cannot exceed the outstanding card balance'],
      CREDIT_LIMIT_EXCEEDED: [400, 'This change would exceed the card credit limit'],
      LEDGER_ENTRIES_MISSING: [409, 'This transaction has no complete journal entry; it needs reconciliation before editing'],
    };
    const known = messages[code];
    if (known) return NextResponse.json({ error: known[1] }, { status: known[0] });
    console.error('MONETRA_TRANSACTION_UPDATE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to update transaction' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [current] = await tx.select().from(transactions)
        .where(and(eq(transactions.id, params.id), eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), isNull(transactions.voidedAt)))
        .for('update');
      if (!current || current.transactionType === 'adjustment') throw new Error('TRANSACTION_NOT_FOUND');
      const ids = [current.walletId, ...(current.destinationWalletId ? [current.destinationWalletId] : [])];
      const locked = await lockRelatedWallets(tx, context.workspaceId, ids);
      if (ids.some(id => !locked.some(wallet => wallet.id === id))) throw new Error('WALLET_NOT_AVAILABLE');
      if (locked.some(wallet => !Number.isSafeInteger(wallet.currentBalanceMinor))) throw new Error('LEDGER_BALANCE_OUT_OF_RANGE');
      const walletTypes = new Map(locked.map(wallet => [wallet.id, wallet.walletType]));
      const oldEffects = effectsFor(current, walletTypes);
      const oldLines = await tx.select().from(ledgerEntries)
        .where(and(eq(ledgerEntries.transactionId, current.id), eq(ledgerEntries.workspaceId, context.workspaceId)));
      if (oldLines.length < 2) throw new Error('LEDGER_ENTRIES_MISSING');
      await tx.insert(ledgerEntries).values(reverseEntries(oldLines, context.workspaceId, context.userId));
      for (const wallet of locked) {
        const next = Number(wallet.currentBalanceMinor) - (oldEffects[wallet.id] || 0);
        if (!Number.isSafeInteger(next)) throw new Error('BALANCE_LIMIT_EXCEEDED');
        if (next !== Number(wallet.currentBalanceMinor)) {
          await tx.update(wallets).set({ currentBalanceMinor: next, updatedAt: new Date() })
            .where(and(eq(wallets.id, wallet.id), eq(wallets.workspaceId, context.workspaceId)));
        }
      }
      await tx.update(transactions).set({ voidedAt: new Date() })
        .where(and(eq(transactions.id, current.id), eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), isNull(transactions.voidedAt)));
    });
    return NextResponse.json({ ok: true, deleted: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string, [number, string]> = {
      TRANSACTION_NOT_FOUND: [404, 'Transaction not found or already deleted'],
      WALLET_NOT_AVAILABLE: [404, 'Wallet not found'],
      LEDGER_BALANCE_OUT_OF_RANGE: [409, 'Wallet balance needs reconciliation before deleting'],
      BALANCE_LIMIT_EXCEEDED: [400, 'This balance exceeds the supported safe integer range'],
      INVALID_TRANSFER: [400, 'Invalid transfer details'],
      UNSUPPORTED_TRANSACTION: [400, 'This transaction type cannot be deleted'],
      LEDGER_ENTRIES_MISSING: [409, 'This transaction has no complete journal entry; it needs reconciliation before deletion'],
    };
    const known = messages[code];
    if (known) return NextResponse.json({ error: known[1] }, { status: known[0] });
    console.error('MONETRA_TRANSACTION_DELETE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to delete transaction' }, { status: 500 });
  }
}
