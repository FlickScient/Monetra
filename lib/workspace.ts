import { auth } from '@clerk/nextjs/server';
import { verifyToken } from '@clerk/backend';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspaces } from '@/db/schema';

export type WorkspaceContext =
  | { ok: true; userId: string; workspaceId: string }
  | { ok: false; status: 400 | 401 | 403 | 503; error: string };

const WORKSPACE_TYPES = ['personal', 'family', 'business'] as const;

/**
 * Resolve a workspace strictly within the authenticated Clerk user's ownership.
 * Browser sessions use Clerk cookies; Capacitor clients may use a Clerk bearer token.
 * Requests without x-workspace-id intentionally fall back to Personal.
 */
export async function getWorkspaceContext(request?: Request): Promise<WorkspaceContext> {
  const session = await auth();
  let userId: string | null = session.userId;

  if (!userId && request) {
    const authorization = request.headers.get('authorization') || '';
    const match = authorization.match(/^Bearer\\s+(.+)$/i);
    if (match?.[1]) {
      try {
        const claims = await verifyToken(match[1], {
          secretKey: process.env.CLERK_SECRET_KEY,
        });
        userId = claims.sub;
      } catch (error) {
        console.warn('MONETRA_NATIVE_AUTH_REJECTED:', error instanceof Error ? error.message : 'Invalid bearer token');
      }
    }
  }

  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };

  const requestedWorkspaceId = request?.headers.get('x-workspace-id')?.trim();

  if (requestedWorkspaceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedWorkspaceId)) {
    return { ok: false, status: 400, error: 'Invalid workspace ID' };
  }

  try {
    if (!requestedWorkspaceId) {
      await db.transaction(async (tx) => {
        for (const workspaceType of WORKSPACE_TYPES) {
          await tx.insert(workspaces).values({
            userId: userId!,
            workspaceType,
            name: workspaceType[0].toUpperCase() + workspaceType.slice(1),
          }).onConflictDoNothing({
            target: [workspaces.userId, workspaces.workspaceType],
          });
        }
      });
    }

    const conditions = [
      eq(workspaces.userId, userId),
      requestedWorkspaceId
        ? eq(workspaces.id, requestedWorkspaceId)
        : eq(workspaces.workspaceType, 'personal'),
    ];

    const [workspace] = await db.select({ id: workspaces.id })
      .from(workspaces)
      .where(and(...conditions))
      .limit(1);

    if (!workspace) {
      return { ok: false, status: 403, error: 'You do not own this workspace' } as const;
    }

    return { ok: true, userId, workspaceId: workspace.id } as const;
  } catch (error) {
    console.error('MONETRA_WORKSPACE_ERROR:', error);
    return {
      ok: false,
      status: 503,
      error: 'Finance database is unavailable. Verify DATABASE_URL and apply the pending Drizzle migrations.',
    };
  }
}
