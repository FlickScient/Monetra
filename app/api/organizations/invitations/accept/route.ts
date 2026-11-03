import { createHash } from 'node:crypto';
import { currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { invitations, organizationMembers, organizations } from '@/db/schema';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  if (!primaryEmail || primaryEmail.verification?.status !== 'verified') {
    return NextResponse.json({ error: 'A verified primary email is required to accept an invitation' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    return NextResponse.json({ error: 'Invalid invitation token' }, { status: 400 });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();

  try {
    const result = await db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, tokenHash))
        .limit(1);

      if (!invitation || invitation.expiresAt <= now) throw new Error('INVITATION_INVALID');
      if (invitation.email.toLowerCase() !== primaryEmail.emailAddress.toLowerCase()) {
        throw new Error('INVITATION_EMAIL_MISMATCH');
      }

      // A retry from the same verified account is safe and idempotent.
      if (invitation.acceptedAt) {
        const [existingMembership] = await tx
          .select({ id: organizationMembers.id })
          .from(organizationMembers)
          .where(and(
            eq(organizationMembers.organizationId, invitation.organizationId),
            eq(organizationMembers.userId, user.id),
          ))
          .limit(1);
        if (!existingMembership) throw new Error('INVITATION_INVALID');
      } else {
        const [claimed] = await tx
          .update(invitations)
          .set({ acceptedAt: now })
          .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)))
          .returning({ id: invitations.id });

        if (!claimed) throw new Error('INVITATION_INVALID');

        await tx.insert(organizationMembers).values({
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
        }).onConflictDoNothing();
      }

      const [organization] = await tx
        .select({ id: organizations.id, name: organizations.name, type: organizations.organizationType })
        .from(organizations)
        .where(eq(organizations.id, invitation.organizationId))
        .limit(1);

      return { organization, role: invitation.role };
    });

    return NextResponse.json(result);

  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'INVITATION_EMAIL_MISMATCH') {
      return NextResponse.json({ error: 'This invitation was sent to a different email address' }, { status: 403 });
    }
    if (code === 'INVITATION_INVALID') {
      return NextResponse.json({ error: 'This invitation is invalid, expired, or already used' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to accept invitation' }, { status: 500 });
  }
}
