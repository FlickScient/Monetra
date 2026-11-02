import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { wallets } from '@/db/schema';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, walletType, currency, openingBalanceMinor } = await req.json();

  if (!name || !walletType) {
    return NextResponse.json({ error: 'name and walletType required' }, { status: 400 });
  }

  const [wallet] = await db
    .insert(wallets)
    .values({
      userId,
      name,
      walletType,
      currency: currency ?? 'BDT',
      openingBalanceMinor: openingBalanceMinor ?? 0,
      currentBalanceMinor: openingBalanceMinor ?? 0,
    })
    .returning();

  return NextResponse.json(wallet);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userWallets = await db.query.wallets.findMany({
    where: (w, { eq }) => eq(w.userId, userId),
  });

  return NextResponse.json(userWallets);
}
