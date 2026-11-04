import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspaces } from '@/db/schema';

const WORKSPACE_TYPES = ['personal', 'family', 'business'] as const;
const WORKSPACE_NAMES: Record<(typeof WORKSPACE_TYPES)[number], string> = {
  personal: 'Personal',
  family: 'Family',
  business: 'Business',
};

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await db.transaction(async (tx) => {
      for (const workspaceType of WORKSPACE_TYPES) {
        await tx.insert(workspaces).values({
          userId,
          workspaceType,
          name: WORKSPACE_NAMES[workspaceType],
        }).onConflictDoNothing({
          target: [workspaces.userId, workspaces.workspaceType],
        });
      }
    });

    const rows = await db.select({
      id: workspaces.id,
      name: workspaces.name,
      type: workspaces.workspaceType,
      createdAt: workspaces.createdAt,
    }).from(workspaces)
      .where(eq(workspaces.userId, userId))
      .orderBy(asc(workspaces.createdAt));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('MONETRA_WORKSPACES_ERROR:', error);
    return NextResponse.json({ error: 'Unable to load finance workspaces' }, { status: 503 });
  }
}
