import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizationMembers, organizations } from '@/db/schema';

export type OrganizationRole = 'owner' | 'administrator' | 'editor' | 'viewer';

export type OrganizationContext =
  | { ok: true; userId: string; organizationId: string; role: OrganizationRole }
  | { ok: false; status: 401 | 403; error: string };

const validRoles = new Set<OrganizationRole>(['owner', 'administrator', 'editor', 'viewer']);

/**
 * Resolves the requested organization only after verifying the signed-in
 * Clerk user has an active membership. With no header, the oldest membership
 * is selected to preserve the existing single-person workspace experience.
 */
export async function getOrganizationContext(request?: Request): Promise<OrganizationContext> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };

  const requestedOrganizationId = request?.headers.get('x-organization-id')?.trim();
  const conditions = [eq(organizationMembers.userId, userId)];
  if (requestedOrganizationId) {
    conditions.push(eq(organizationMembers.organizationId, requestedOrganizationId));
  }

  try {
    const [membership] = await db
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(...conditions))
      .orderBy(asc(organizations.createdAt))
      .limit(1);

    if (!membership || !validRoles.has(membership.role as OrganizationRole)) {
      return { ok: false, status: 403, error: 'No access to this organization' };
    }

    return {
      ok: true,
      userId,
      organizationId: membership.organizationId,
      role: membership.role as OrganizationRole,
    };
  } catch {
    return { ok: false, status: 403, error: 'Organization access is not available' };
  }
}
