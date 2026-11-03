import { randomBytes, createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { invitations, organizations } from '@/db/schema';
import { getOrganizationContext } from '@/lib/organization';

export async function GET(req: Request) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (context.role !== 'owner' && context.role !== 'administrator') {
    return NextResponse.json({ error: 'Only owners and administrators can view invitations' }, { status: 403 });
  }

  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.organizationId, context.organizationId))
    .orderBy(asc(invitations.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const context = await getOrganizationContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  if (context.role !== 'owner' && context.role !== 'administrator') {
    return NextResponse.json({ error: 'Only owners and administrators can invite members' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  if (role !== 'editor' && role !== 'viewer' && !(role === 'administrator' && context.role === 'owner')) {
    return NextResponse.json({ error: 'Invalid invitation role' }, { status: 400 });
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    const [organization] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, context.organizationId))
      .limit(1);

    await db.insert(invitations).values({
      organizationId: context.organizationId,
      email,
      role,
      tokenHash,
      invitedBy: context.userId,
      expiresAt,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const inviteUrl = new URL(`/invite/${token}`, baseUrl).toString();

    return NextResponse.json({
      email,
      role,
      organizationName: organization?.name || 'Monetra',
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
      delivery: 'manual',
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to create invitation' }, { status: 500 });
  }
}
