import { auth } from '@clerk/nextjs/server';
import { and, asc, eq, sql } from 'drizzle-orm';
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
    let [membership] = await db
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(...conditions))
      .orderBy(asc(organizations.createdAt))
      .limit(1);

    // New Clerk accounts may sign in after the migration has run. Provision
    // their Personal space once, without ever falling back from an explicitly
    // requested organization that they do not belong to.
    if (!membership && !requestedOrganizationId) {
      try {
        await db.transaction(async (tx) => {
          const [existingPersonal] = await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(and(eq(organizations.createdBy, userId), eq(organizations.organizationType, 'personal')))
            .limit(1);

          const [personal] = existingPersonal
            ? [existingPersonal]
            : await tx.insert(organizations).values({
                name: 'Personal',
                organizationType: 'personal',
                createdBy: userId,
              }).returning({ id: organizations.id });

          await tx.insert(organizationMembers).values({
            organizationId: personal.id,
            userId,
            role: 'owner',
          }).onConflictDoNothing();
        });
      } catch {
        // A concurrent first request may have created the unique Personal
        // organization already. Re-read membership below.
      }

      [membership] = await db
        .select({
          organizationId: organizationMembers.organizationId,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(and(eq(organizationMembers.userId, userId), eq(organizations.organizationType, 'personal')))
        .orderBy(asc(organizations.createdAt))
        .limit(1);
    }

    if (!membership || !validRoles.has(membership.role as OrganizationRole)) {
      return { ok: false, status: 403, error: 'No access to this organization' };
    }

    return {
      ok: true,
      userId,
      organizationId: membership.organizationId,
      role: membership.role as OrganizationRole,
    };
  } catch (error) {
    const cause =
      typeof error === 'object' && error !== null && 'cause' in error
        ? error.cause
        : undefined;

    const causeDetails =
      typeof cause === 'object' && cause !== null
        ? {
            name: 'name' in cause ? cause.name : undefined,
            message: 'message' in cause ? cause.message : String(cause),
            code: 'code' in cause ? cause.code : undefined,
            detail: 'detail' in cause ? cause.detail : undefined,
            hint: 'hint' in cause ? cause.hint : undefined,
          }
        : cause instanceof Error
          ? { name: cause.name, message: cause.message }
          : cause;

    let databaseDiagnostics: unknown;
    try {
      const [identity] = await db.execute(sql`select current_database() as database_name, current_schema() as current_schema, current_schemas(true) as search_path, to_regclass('public.organization_members')::text as organization_members_table, to_regclass('public.organizations')::text as organizations_table`);
      databaseDiagnostics = identity;
    } catch (diagnosticError) {
      databaseDiagnostics = {
        message: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      };
    }

    console.error('MONETRA_ORG_ERROR:', {
      databaseDiagnostics,
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      code:
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined,
      cause: causeDetails,
    });

    return {
      ok: false,
      status: 403,
      error: 'Organization access is not available',
    };
  }
}

export function canWriteOrganization(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'administrator' || role === 'editor';
}
