import { auth } from '@clerk/nextjs/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { workspaces } from '@/db/schema';

export type WorkspaceContext =
  | { ok: true; userId: string; workspaceId: string; organizationId: string; role: 'owner' }
  | { ok: false; status: 401 | 403 | 503; error: string };

const workspaceTypes = ['personal', 'family', 'business'] as const;

/**
 * Resolve a workspace only when it belongs to the authenticated Clerk user.
 * The legacy organizationId alias is temporary compatibility for API handlers
 * while their query fields are switched to workspaceId.
 */
export async function getOrganizationContext(request?: Request): Promise<WorkspaceContext> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };

  const requestedWorkspaceId = request?.headers.get('x-workspace-id')?.trim()
    || request?.headers.get('x-organization-id')?.trim();

  try {
    if (!requestedWorkspaceId) {
      await db.transaction(async (tx) => {
        for (const workspaceType of workspaceTypes) {
          await tx.insert(workspaces).values({
            userId,
            workspaceType,
            name: workspaceType[0].toUpperCase() + workspaceType.slice(1),
          }).onConflictDoNothing({
            target: [workspaces.userId, workspaces.workspaceType],
          });
        }
      });
    }

    const conditions = [eq(workspaces.userId, userId)];
    if (requestedWorkspaceId) conditions.push(eq(workspaces.id, requestedWorkspaceId));

    const [workspace] = await db.select({ id: workspaces.id })
      .from(workspaces).where(and(...conditions)).limit(1);

    if (!workspace) return { ok: false, status: 403, error: 'You do not own this workspace' };

    return {
      ok: true,
      userId,
      workspaceId: workspace.id,
      organizationId: workspace.id,
      role: 'owner',
    };
  } catch (error) {
    console.error('MONETRA_WORKSPACE_ERROR:', error);
    return {
      ok: false,
      status: 503,
      error: 'Finance database is unavailable. Verify DATABASE_URL and apply the pending Drizzle migrations.',
    };
  }
}

export const canWriteOrganization = (_role: 'owner'): boolean => true;
