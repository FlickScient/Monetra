import { NextResponse } from 'next/server';
import { getWorkspaceContext } from '@/lib/workspace';
import { db } from '@/db';
import { categories } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

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

export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  try {
    const rows = await db.transaction(async (tx) => {
      // Serialize first-time category seeding for this workspace.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${context.workspaceId}), hashtext('monetra_default_categories'))`);

      const existing = await tx.select().from(categories)
        .where(eq(categories.workspaceId, context.workspaceId));

      if (existing.length === 0) {
        await tx.insert(categories).values(defaults.map((category) => ({
          ...category,
          userId: context.userId,
          workspaceId: context.workspaceId,
        })));
      }

      return tx.select().from(categories)
        .where(eq(categories.workspaceId, context.workspaceId));
    });

    return NextResponse.json(rows);
  } catch (error) {
    console.error('MONETRA_CATEGORIES_ERROR:', error);
    return NextResponse.json({ error: 'Unable to load categories' }, { status: 500 });
  }
}
