import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { categories } from '@/db/schema';
import { eq } from 'drizzle-orm';

const defaults = [
  { name: 'Salary', categoryType: 'income', color: '#0f766e' },
  { name: 'Freelance', categoryType: 'income', color: '#14b8a6' },
  { name: 'Business Sale', categoryType: 'income', color: '#2dd4bf' },
  { name: 'Food & Groceries', categoryType: 'expense', color: '#b75235' },
  { name: 'Transport', categoryType: 'expense', color: '#c2703f' },
  { name: 'Bills & Utilities', categoryType: 'expense', color: '#a8554a' },
  { name: 'Shopping', categoryType: 'expense', color: '#9b5c8f' },
  { name: 'Health', categoryType: 'expense', color: '#3f7ea6' },
  { name: 'Education', categoryType: 'expense', color: '#4a6fa5' },
  { name: 'Entertainment', categoryType: 'expense', color: '#8a63d2' },
  { name: 'Other', categoryType: 'expense', color: '#78928b' },
];

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rows = await db.select().from(categories).where(eq(categories.userId, userId));
  if (rows.length === 0) {
    await db.insert(categories).values(defaults.map((c) => ({ ...c, userId })));
    rows = await db.select().from(categories).where(eq(categories.userId, userId));
  }
  return NextResponse.json(rows);
}
