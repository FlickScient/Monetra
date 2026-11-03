import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizationMembers, organizations } from '@/db/schema';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      type: organizations.organizationType,
      role: organizationMembers.role,
      createdAt: organizations.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const type = body.type;
  if (!name || name.length > 80 || (type !== 'family' && type !== 'business')) {
    return NextResponse.json({ error: 'Provide a valid name and organization type (family or business)' }, { status: 400 });
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({
        name,
        organizationType: type,
        createdBy: userId,
      }).returning();

      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        userId,
        role: 'owner',
      });

      return organization;
    });

    return NextResponse.json({ ...created, role: 'owner' }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to create organization' }, { status: 500 });
  }
}
