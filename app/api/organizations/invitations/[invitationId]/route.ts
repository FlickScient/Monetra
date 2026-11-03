import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { invitations } from '@/db/schema';
import { getOrganizationContext } from '@/lib/organization';

export async function DELETE(req: Request, { params }: { params: { invitationId: string } }) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (context.role !== 'owner' && context.role !== 'administrator') {
    return NextResponse.json({ error: 'Only owners and administrators can revoke invitations' }, { status: 403 });
  }

  const [revoked] = await db
    .delete(invitations)
    .where(and(
      eq(invitations.id, params.invitationId),
      eq(invitations.organizationId, context.organizationId),
      isNull(invitations.acceptedAt),
    ))
    .returning({ id: invitations.id });

  if (!revoked) return NextResponse.json({ error: 'Pending invitation not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
