import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { categories, transactions } from '@/db/schema';
import { getWorkspaceContext } from '@/lib/workspace';
import { isUuid } from '@/lib/validation';

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const values: Partial<typeof categories.$inferInsert> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 60) return NextResponse.json({ error: 'Category name must be between 1 and 60 characters' }, { status: 400 });
    values.name = body.name.trim();
  }
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color)) return NextResponse.json({ error: 'Use a valid six-digit hex color' }, { status: 400 });
    values.color = body.color;
  }
  if (body.categoryType !== undefined && !['income', 'expense'].includes(String(body.categoryType))) return NextResponse.json({ error: 'Invalid category type' }, { status: 400 });
  try {
    const updated = await db.transaction(async tx => {
      const [current] = await tx.select().from(categories)
        .where(and(eq(categories.id, params.id), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId)));
      if (!current) throw new Error('CATEGORY_NOT_FOUND');
      if (body.categoryType !== undefined && body.categoryType !== current.categoryType) {
        const [usage] = await tx.select({ id: transactions.id }).from(transactions)
          .where(and(eq(transactions.categoryId, current.id), eq(transactions.workspaceId, context.workspaceId), sql`${transactions.voidedAt} IS NULL`)).limit(1);
        if (usage) throw new Error('CATEGORY_IN_USE');
        values.categoryType = String(body.categoryType);
      }
      if (values.name) {
        const [duplicate] = await tx.select({ id: categories.id }).from(categories)
          .where(and(eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId), sql`lower(${categories.name}) = lower(${values.name})`, sql`${categories.id} <> ${current.id}`));
        if (duplicate) throw new Error('CATEGORY_DUPLICATE');
      }
      const [saved] = await tx.update(categories).set(values)
        .where(and(eq(categories.id, current.id), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId))).returning();
      return saved;
    });
    return NextResponse.json(updated);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const errors: Record<string, [number, string]> = {
      CATEGORY_NOT_FOUND: [404, 'Category not found'],
      CATEGORY_IN_USE: [409, 'Change the category type only after reassigning its existing transactions'],
      CATEGORY_DUPLICATE: [409, 'A category with this name already exists in this workspace'],
    };
    if (errors[code]) return NextResponse.json({ error: errors[code][1] }, { status: errors[code][0] });
    console.error('MONETRA_CATEGORY_UPDATE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to update category' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [category] = await tx.select().from(categories)
        .where(and(eq(categories.id, params.id), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId)))
        .for('update');
      if (!category) throw new Error('CATEGORY_NOT_FOUND');
      await tx.update(transactions).set({ categoryId: null })
        .where(and(eq(transactions.categoryId, category.id), eq(transactions.workspaceId, context.workspaceId), eq(transactions.userId, context.userId)));
      await tx.update(categories).set({ parentId: null })
        .where(and(eq(categories.parentId, category.id), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId)));
      await tx.delete(categories)
        .where(and(eq(categories.id, category.id), eq(categories.workspaceId, context.workspaceId), eq(categories.userId, context.userId)));
    });
    return NextResponse.json({ ok: true, unassignedTransactions: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'CATEGORY_NOT_FOUND') return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    console.error('MONETRA_CATEGORY_DELETE_ERROR:', error);
    return NextResponse.json({ error: 'Unable to delete category' }, { status: 500 });
  }
}
