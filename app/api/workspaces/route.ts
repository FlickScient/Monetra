import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { verifyToken } from '@clerk/backend';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspaces } from '@/db/schema';

const WORKSPACE_TYPES = ['personal', 'family', 'business'] as const;
const WORKSPACE_NAMES: Record<(typeof WORKSPACE_TYPES)[number], string> = {
  personal: 'Personal',
  family: 'Family',
  business: 'Business',
};

const WORKSPACE_ORDER: Record<(typeof WORKSPACE_TYPES)[number], number> = {
  personal: 0,
  family: 1,
  business: 2,
};

export async function GET(request: NextRequest) {
  // Browser sessions are authenticated by Clerk cookies. Capacitor's native
  // WebView sends the same Clerk session as an Authorization bearer token.
  const session = await auth();
  let userId: string | null = session.userId;

  if (!userId) {
    const authorization = request.headers.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const claims = await verifyToken(match[1], {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      userId = claims.sub;
    } catch (error) {
      console.warn('MONETRA_NATIVE_AUTH_REJECTED:', error instanceof Error ? error.message : 'Invalid bearer token');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const authenticatedUserId = userId;

  try {
    await db.transaction(async (tx) => {
      for (const workspaceType of WORKSPACE_TYPES) {
        await tx.insert(workspaces).values({
          userId: authenticatedUserId,
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
      .where(eq(workspaces.userId, authenticatedUserId))
      .orderBy(asc(workspaces.createdAt));

    const response = rows
      .map((workspace) => ({ ...workspace, role: 'owner' as const }))
      .sort((a, b) => WORKSPACE_ORDER[a.type as (typeof WORKSPACE_TYPES)[number]] - WORKSPACE_ORDER[b.type as (typeof WORKSPACE_TYPES)[number]]);

    return NextResponse.json(response);
  } catch (error) {
    console.error('MONETRA_WORKSPACES_ERROR:', error);
    return NextResponse.json({ error: 'Unable to load finance workspaces' }, { status: 503 });
  }
}
