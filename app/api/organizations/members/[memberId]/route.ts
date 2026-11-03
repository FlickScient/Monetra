import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizationMembers } from '@/db/schema';
import { getOrganizationContext } from '@/lib/organization';

type RouteContext = { params: { memberId: string } };

export async function PATCH(req: Request, { params }: RouteContext) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (context.role !== 'owner' && context.role !== 'administrator') {
    return NextResponse.json({ error: 'Only owners and administrators can change member roles' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const role = body.role;
  if (role !== 'administrator' && role !== 'editor' && role !== 'viewer') {
    return NextResponse.json({ error: 'Invalid member role' }, { status: 400 });
  }
  if (role === 'administrator' && context.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can assign administrator access' }, { status: 403 });
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, params.memberId), eq(organizationMembers.organizationId, context.organizationId)))
    .limit(1);

  if (!member || member.role === 'owner') {
    return NextResponse.json({ error: 'Member not found or cannot be changed' }, { status: 404 });
  }
  if (context.role === 'administrator' && member.role === 'administrator') {
    return NextResponse.json({ error: 'Administrators cannot change another administrator' }, { status: 403 });
  }

  const [updated] = await db
    .update(organizationMembers)
    .set({ role })
    .where(and(eq(organizationMembers.id, member.id), eq(organizationMembers.organizationId, context.organizationId)))
    .returning({ id: organizationMembers.id, userId: organizationMembers.userId, role: organizationMembers.role });

  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (context.role !== 'owner' && context.role !== 'administrator') {
    return NextResponse.json({ error: 'Only owners and administrators can remove members' }, { status: 403 });
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, params.memberId), eq(organizationMembers.organizationId, context.organizationId)))
    .limit(1);

  if (!member || member.role === 'owner') {
    return NextResponse.json({ error: 'Member not found or cannot be removed' }, { status: 404 });
  }
  if (context.role === 'administrator' && member.role === 'administrator') {
    return NextResponse.json({ error: 'Administrators cannot remove another administrator' }, { status: 403 });
  }

  await db.delete(organizationMembers)
    .where(and(eq(organizationMembers.id, member.id), eq(organizationMembers.organizationId, context.organizationId)));

  return NextResponse.json({ success: true });
}
