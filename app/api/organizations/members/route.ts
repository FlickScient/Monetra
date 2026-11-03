import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizationMembers } from '@/db/schema';
import { getOrganizationContext } from '@/lib/organization';

export async function GET(req: Request) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (context.role !== 'owner' && context.role !== 'administrator') {
    return NextResponse.json({ error: 'Only owners and administrators can view members' }, { status: 403 });
  }

  const members = await db
    .select({
      id: organizationMembers.id,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      joinedAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, context.organizationId))
    .orderBy(asc(organizationMembers.createdAt));

  return NextResponse.json(members);
}
