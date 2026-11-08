import { db } from '@/db';
import { financeAuditEvents } from '@/db/modules-schema';

type AuditOwner = { userId: string; workspaceId: string };
type AuditEvent = {
  entityType: string;
  entityId?: string | null;
  action: string;
  summary: string;
};

/** Audit writes are best-effort so a logging failure never turns a successful money operation into a failed request. */
export async function recordFinanceAudit(owner: AuditOwner, event: AuditEvent): Promise<void> {
  try {
    await db.insert(financeAuditEvents).values({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      entityType: event.entityType.slice(0, 60),
      entityId: event.entityId || null,
      action: event.action.slice(0, 60),
      summary: event.summary.slice(0, 500),
    });
  } catch (error) {
    console.error('MONETRA_AUDIT_WRITE_ERROR:', error);
  }
}