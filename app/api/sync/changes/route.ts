import { NextResponse } from 'next/server';
import { and, asc, eq, gt } from 'drizzle-orm';
import { db } from '@/db';
import { financeSyncChanges } from '@/db/schema';
import { getWorkspaceContext } from '@/lib/workspace';

/**
 * Pull an ordered, workspace-scoped change page for an authenticated device.
 * The cursor is a per-workspace monotonic version allocated while holding the
 * workspace row lock inside the source mutation transaction.
 */
export async function GET(req: Request) {
  const context = await getWorkspaceContext(req);
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const url = new URL(req.url);
  const rawCursor = url.searchParams.get('after') ?? '0';
  const rawLimit = Number(url.searchParams.get('limit') ?? 200);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  let after: bigint;
  try {
    if (!/^\d+$/.test(rawCursor)) throw new Error('invalid');
    after = BigInt(rawCursor);
    if (after < BigInt('0')) throw new Error('invalid');
  } catch {
    return NextResponse.json({ error: 'Invalid sync cursor' }, { status: 400 });
  }

  try {
    const rows = await db.select({
      cursor: financeSyncChanges.cursor,
      entityType: financeSyncChanges.entityType,
      entityId: financeSyncChanges.entityId,
      operation: financeSyncChanges.operation,
      payload: financeSyncChanges.payload,
      createdAt: financeSyncChanges.createdAt,
    })
      .from(financeSyncChanges)
      .where(and(
        eq(financeSyncChanges.workspaceId, context.workspaceId),
        eq(financeSyncChanges.userId, context.userId),
        gt(financeSyncChanges.cursor, after),
      ))
      .orderBy(asc(financeSyncChanges.cursor))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const selectedRows = hasMore ? rows.slice(0, limit) : rows;
    const changes = selectedRows.map((row) => ({ ...row, cursor: String(row.cursor) }));
    const nextCursor = changes.length
      ? changes[changes.length - 1].cursor
      : rawCursor;

    return NextResponse.json({
      workspaceId: context.workspaceId,
      changes,
      nextCursor,
      hasMore,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('MONETRA_SYNC_PULL_ERROR:', error);
    return NextResponse.json({ error: 'Unable to retrieve workspace changes' }, { status: 500 });
  }
}
