import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { categories, transactions, wallets } from '@/db/schema';
import { getWorkspaceContext } from '@/lib/workspace';

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

const destinationWallets = alias(wallets, 'destination_wallets');

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  try {
    const rows = await db.select({
      type: transactions.transactionType,
      description: transactions.description,
      amountMinor: transactions.amountMinor,
      occurredAt: transactions.occurredAt,
      walletName: wallets.name,
      destinationWalletName: destinationWallets.name,
      categoryName: categories.name,
      currency: wallets.currency,
    }).from(transactions)
      .leftJoin(wallets, and(eq(wallets.id, transactions.walletId), eq(wallets.workspaceId, context.workspaceId), eq(wallets.userId, context.userId)))
      .leftJoin(destinationWallets, and(eq(destinationWallets.id, transactions.destinationWalletId), eq(destinationWallets.workspaceId, context.workspaceId), eq(destinationWallets.userId, context.userId)))
      .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId)))
      .where(and(eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId), isNull(transactions.voidedAt), ne(transactions.transactionType, 'adjustment')))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id));

    const header = ['Date', 'Type', 'Description', 'Amount', 'Wallet', 'Destination wallet', 'Category', 'Currency'];
    const lines = [header, ...rows.map(row => [
      row.occurredAt.toISOString(),
      row.type,
      row.description,
      (Number(row.amountMinor) / 100).toFixed(2),
      row.walletName || '',
      row.destinationWalletName || '',
      row.categoryName || 'Uncategorized',
      row.currency || 'BDT',
    ])].map(line => line.map(csvCell).join(','));
    const csv = '\uFEFF' + lines.join('\r\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="monetra-transactions.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('MONETRA_TRANSACTION_EXPORT_ERROR:', error);
    return NextResponse.json({ error: 'Unable to export transactions' }, { status: 500 });
  }
}
