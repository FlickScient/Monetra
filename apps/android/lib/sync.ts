import * as Crypto from "expo-crypto";
import { getDatabase, readCachedWorkspace, saveCachedWorkspace } from "./database";

const API_URL = (process.env.EXPO_PUBLIC_MONETRA_API_URL || "https://monetra-4rax.vercel.app").replace(/\/+$/, "");

export type SyncResult = { status: "synced" | "offline" | "needs-attention"; message: string; cursor?: string };

function endpoint(path: string) {
  if (!API_URL) throw new Error("Set EXPO_PUBLIC_MONETRA_API_URL before building the app.");
  return API_URL + path;
}

async function request(path: string, token: string, workspaceId: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint(path), {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-workspace-id": workspaceId,
        ...(init?.headers ?? {})
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : `Sync failed (${response.status})`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function queueOfflineOperation(input: {
  userId: string; workspaceId: string; type: "transaction.create" | "transfer.create" | "debt.payment";
  payload: Record<string, unknown>;
}) {
  const db = await getDatabase();
  const operationId = makeUuid();
  await db.runAsync(
    `INSERT INTO pending_operations(operation_id,user_id,workspace_id,operation_type,payload_json,created_at)
     VALUES(?,?,?,?,?,?)`,
    operationId, input.userId, input.workspaceId, input.type, JSON.stringify(input.payload), new Date().toISOString()
  );
  return operationId;
}

function makeUuid() {
  return Crypto.randomUUID();
}

async function performSyncWorkspace(userId: string, workspaceId: string, token: string): Promise<SyncResult> {
  const db = await getDatabase();
  try {
    // A full, consistent snapshot is only needed when this user/workspace has no local copy.
    const cached = await readCachedWorkspace(userId, workspaceId);
    let cursor = cached?.cursor ?? "0";
    if (!cached) {
      const snapshot = await request("/api/sync/bootstrap", token, workspaceId);
      cursor = String(snapshot.cursor ?? "0");
      await saveCachedWorkspace(userId, workspaceId, snapshot, cursor);
    }

    // Send oldest queued writes first. Keep the same operation UUID on every retry.
    const pending = await db.getAllAsync<{
      operation_id: string; operation_type: string; payload_json: string;
    }>(
      "SELECT operation_id, operation_type, payload_json FROM pending_operations WHERE user_id = ? AND workspace_id = ? ORDER BY created_at LIMIT 25",
      userId, workspaceId
    );
    if (pending.length) {
      const pushed = await request("/api/sync/push", token, workspaceId, {
        method: "POST",
        body: JSON.stringify({ operations: pending.map((item) => ({
          operationId: item.operation_id,
          type: item.operation_type,
          payload: JSON.parse(item.payload_json)
        })) })
      });
      for (const result of (pushed.results ?? []) as Array<{ operationId: string; ok: boolean; error?: string }>) {
        if (result.ok) {
          await db.runAsync("DELETE FROM pending_operations WHERE operation_id = ?", result.operationId);
        } else {
          await db.runAsync("UPDATE pending_operations SET last_error = ? WHERE operation_id = ?", result.error ?? "Rejected", result.operationId);
        }
      }
      if (!pushed.complete) {
        return { status: "needs-attention", message: "Some saved actions need attention. Your pending records were kept.", cursor };
      }
    }

    // Pull pages in cursor order. Apply a page and its cursor in one SQLite transaction.
    let hasMore = true;
    while (hasMore) {
      const page = await request(`/api/sync/changes?after=${encodeURIComponent(cursor)}&limit=200`, token, workspaceId);
      const current = await readCachedWorkspace(userId, workspaceId);
      if (!current) throw new Error("Local workspace cache disappeared during sync.");
      const snapshot = JSON.parse(current.snapshot_json) as Record<string, any>;
      const data = snapshot.data as Record<string, unknown[]>;

      const snapshotKeys: Record<string, string> = {
        ledger_accounts: "ledgerAccounts", ledger_entries: "ledgerEntries",
        savings_goals: "savingsGoals", goal_allocations: "goalAllocations",
        goal_allocation_events: "goalAllocationEvents", due_debts: "dueDebts",
        due_debt_payments: "dueDebtPayments", monthly_budgets: "monthlyBudgets",
        recurring_transactions: "recurringTransactions", wallet_reconciliations: "walletReconciliations",
        finance_audit_events: "financeAuditEvents"
      };
      for (const change of (page.changes ?? []) as Array<{ entityType: string; entityId: string; operation: "upsert" | "delete"; payload: Record<string, unknown> | null }>) {
        const key = snapshotKeys[change.entityType] ?? change.entityType;
        if (!Array.isArray(data[key])) continue;
        const rows = data[key] as Array<Record<string, unknown>>;
        const next = rows.filter((row) => row.id !== change.entityId);
        if (change.operation === "upsert" && change.payload) next.push(change.payload);
        data[key] = next;
      }

      const nextCursor = String(page.nextCursor ?? cursor);
      await db.withTransactionAsync(async () => {
        await saveCachedWorkspace(userId, workspaceId, snapshot, nextCursor);
        await db.runAsync(
          `INSERT INTO sync_state(user_id,workspace_id,last_success_at,last_error)
           VALUES(?,?,?,NULL)
           ON CONFLICT(user_id,workspace_id) DO UPDATE SET last_success_at=excluded.last_success_at,last_error=NULL`,
          userId, workspaceId, new Date().toISOString()
        );
      });
      cursor = nextCursor;
      hasMore = Boolean(page.hasMore);
    }

    return { status: "synced", message: "All changes are synchronized.", cursor };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Synchronization failed.";
    await db.runAsync(
      `INSERT INTO sync_state(user_id,workspace_id,last_error) VALUES(?,?,?)
       ON CONFLICT(user_id,workspace_id) DO UPDATE SET last_error=excluded.last_error`,
      userId, workspaceId, message
    );
    if (/network request failed|failed to fetch|networkerror|aborterror|aborted|timeout/i.test(message)) {
      return { status: "offline", message: "Offline. Your last saved workspace remains available." };
    }
    return { status: "needs-attention", message };
  }
}


const inFlightSyncs = new Map<string, Promise<SyncResult>>();

export function syncWorkspace(userId: string, workspaceId: string, token: string): Promise<SyncResult> {
  const key = userId + ":" + workspaceId;
  const existing = inFlightSyncs.get(key);
  if (existing) return existing;
  const task = performSyncWorkspace(userId, workspaceId, token).finally(() => {
    inFlightSyncs.delete(key);
  });
  inFlightSyncs.set(key, task);
  return task;
}
