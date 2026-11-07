import type {
  FinanceSyncBootstrap,
  FinanceSyncChange,
  LocalOutboxRecord,
  OfflineCommand,
  OfflineCommandResult,
} from './sync-contract';
import type { LocalFinanceSyncStore } from './sync-engine';

/**
 * Small driver boundary so the sync repository does not depend on a specific
 * Capacitor SQLite plugin version. The native adapter must map these methods
 * to parameterized SQLite statements and a real BEGIN/COMMIT transaction.
 */
export interface LocalSqliteConnection {
  run(sql: string, values?: unknown[]): Promise<void>;
  get<T>(sql: string, values?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, values?: unknown[]): Promise<T[]>;
  transaction<T>(work: (tx: LocalSqliteConnection) => Promise<T>): Promise<T>;
}

type OutboxRow = {
  operation_id: string;
  workspace_id: string;
  operation_type: OfflineCommand['type'];
  payload_json: string;
  state: LocalOutboxRecord['state'];
  attempt_count: number;
  created_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  server_result_json: string | null;
};

const ENTITY_TYPES = new Set([
  'wallets', 'categories', 'transactions', 'ledgerAccounts', 'ledgerEntries',
  'savingsGoals', 'goalAllocations', 'goalAllocationEvents', 'dueDebts',
  'dueDebtPayments', 'monthlyBudgets', 'recurringTransactions',
  'walletReconciliations', 'financeAuditEvents',
]);

function asJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('A local finance record was not serializable.');
  return serialized;
}

function mapOutbox(row: OutboxRow): OfflineCommand {
  const payload = JSON.parse(row.payload_json) as OfflineCommand['payload'];
  return {
    operationId: row.operation_id,
    type: row.operation_type,
    payload,
  } as OfflineCommand;
}

/**
 * SQLite-backed implementation of the sync-engine persistence contract.
 *
 * Important: callers must first run android/database/001_initial.sql and
 * create the local_workspaces + workspace_sync_state rows before syncing.
 * This class intentionally does not invent financial ledger calculations:
 * server change-feed payloads remain authoritative.
 */
export class SqliteFinanceSyncStore implements LocalFinanceSyncStore {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly database: LocalSqliteConnection) {}

  async withWorkspaceSyncLock<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.locks.set(workspaceId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(workspaceId) === tail) this.locks.delete(workspaceId);
    }
  }

  async recoverInterruptedPushes(workspaceId: string): Promise<void> {
    await this.database.run(
      `UPDATE sync_outbox
       SET state = 'pending', last_error = COALESCE(last_error, 'Recovered after interrupted sync')
       WHERE workspace_id = ? AND state = 'processing'`,
      [workspaceId],
    );
  }

  async listPendingCommands(workspaceId: string, limit: number): Promise<OfflineCommand[]> {
    const rows = await this.database.all<OutboxRow>(
      `SELECT operation_id, workspace_id, operation_type, payload_json, state,
              attempt_count, created_at, last_attempt_at, last_error, server_result_json
       FROM sync_outbox
       WHERE workspace_id = ? AND state = 'pending'
       ORDER BY created_at ASC, operation_id ASC
       LIMIT ?`,
      [workspaceId, Math.min(Math.max(Math.trunc(limit), 1), 25)],
    );
    return rows.map(mapOutbox);
  }

  async markCommandsProcessing(operationIds: string[]): Promise<void> {
    if (!operationIds.length) return;
    await this.database.transaction(async (tx) => {
      for (const id of operationIds) {
        await tx.run(
          `UPDATE sync_outbox
           SET state = 'processing', attempt_count = attempt_count + 1,
               last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL
           WHERE operation_id = ? AND state = 'pending'`,
          [id],
        );
      }
    });
  }

  async markCommandSynced(operationId: string, result: OfflineCommandResult): Promise<void> {
    // The server change feed is the durable copy of the accepted financial row.
    // Remove only the matching outbox intent after a confirmed 2xx response.
    await this.database.run(
      `DELETE FROM sync_outbox WHERE operation_id = ? AND state = 'processing'`,
      [operationId],
    );
    void result;
  }

  async markCommandForRetry(operationId: string, reason: string): Promise<void> {
    await this.database.run(
      `UPDATE sync_outbox SET state = 'pending', last_error = ?
       WHERE operation_id = ? AND state = 'processing'`,
      [reason.slice(0, 1000), operationId],
    );
  }

  async markCommandConflict(
    operationId: string,
    reason: string,
    result: OfflineCommandResult,
  ): Promise<void> {
    await this.database.run(
      `UPDATE sync_outbox
       SET state = 'conflict', last_error = ?, server_result_json = ?
       WHERE operation_id = ? AND state = 'processing'`,
      [reason.slice(0, 1000), asJson(result), operationId],
    );
  }

  async markCommandRejected(
    operationId: string,
    reason: string,
    result: OfflineCommandResult,
  ): Promise<void> {
    await this.database.run(
      `UPDATE sync_outbox
       SET state = 'rejected', last_error = ?, server_result_json = ?
       WHERE operation_id = ? AND state = 'processing'`,
      [reason.slice(0, 1000), asJson(result), operationId],
    );
  }

  async getPullCursor(workspaceId: string): Promise<string> {
    const row = await this.database.get<{ pull_cursor: number | string }>(
      'SELECT pull_cursor FROM workspace_sync_state WHERE workspace_id = ?',
      [workspaceId],
    );
    if (!row) throw new Error('Local sync state is missing for this workspace.');
    const cursor = String(row.pull_cursor);
    if (!/^\d+$/.test(cursor)) throw new Error('Local finance sync cursor is invalid.');
    return cursor;
  }

  async applyChangesAndAdvanceCursor(
    workspaceId: string,
    changes: FinanceSyncChange[],
    nextCursor: string,
  ): Promise<void> {
    if (!/^\d+$/.test(nextCursor)) throw new Error('The server returned an invalid sync cursor.');
    await this.database.transaction(async (tx) => {
      const state = await tx.get<{ pull_cursor: number | string }>(
        'SELECT pull_cursor FROM workspace_sync_state WHERE workspace_id = ?',
        [workspaceId],
      );
      if (!state) throw new Error('Local sync state is missing for this workspace.');
      const currentCursor = BigInt(String(state.pull_cursor));
      const targetCursor = BigInt(nextCursor);
      if (targetCursor < currentCursor) throw new Error('The server attempted to move the local cursor backwards.');

      let previous = currentCursor;
      for (const change of changes) {
        const cursor = BigInt(String(change.cursor));
        if (cursor <= previous || cursor > targetCursor) {
          throw new Error('The server returned an unordered or out-of-range change page.');
        }
        previous = cursor;
        if (!ENTITY_TYPES.has(change.entityType)) {
          throw new Error(`Unsupported finance sync entity: ${change.entityType}`);
        }
        await tx.run(
          `INSERT INTO local_records (
             workspace_id, entity_type, entity_id, record_json, is_deleted,
             server_cursor, local_updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(workspace_id, entity_type, entity_id) DO UPDATE SET
             record_json = excluded.record_json,
             is_deleted = excluded.is_deleted,
             server_cursor = excluded.server_cursor,
             local_updated_at = excluded.local_updated_at`,
          [
            workspaceId,
            change.entityType,
            change.entityId,
            change.operation === 'delete' ? '{}' : asJson(change.payload),
            change.operation === 'delete' ? 1 : 0,
            cursor.toString(),
          ],
        );
      }

      await tx.run(
        `UPDATE workspace_sync_state SET pull_cursor = ?,
           last_successful_pull_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE workspace_id = ?`,
        [targetCursor.toString(), workspaceId],
      );
      await tx.run(
        'UPDATE local_workspaces SET snapshot_cursor = ?, last_synced_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?',
        [targetCursor.toString(), workspaceId],
      );
    });
  }

  /** Install a first consistent snapshot and its cursor atomically. */
  async installBootstrap(ownerId: string, snapshot: FinanceSyncBootstrap): Promise<void> {
    if (!/^\d+$/.test(snapshot.cursor)) throw new Error('The bootstrap cursor is invalid.');
    const now = snapshot.exportedAt || new Date().toISOString();
    await this.database.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO local_workspaces (
           id, owner_id, workspace_type, name, snapshot_cursor, last_synced_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           owner_id = excluded.owner_id,
           workspace_type = excluded.workspace_type,
           name = excluded.name,
           snapshot_cursor = excluded.snapshot_cursor,
           last_synced_at = excluded.last_synced_at,
           updated_at = excluded.updated_at`,
        [snapshot.workspace.id, ownerId, snapshot.workspace.type, snapshot.workspace.name, snapshot.cursor, now, now, now],
      );
      await tx.run('DELETE FROM local_records WHERE workspace_id = ?', [snapshot.workspace.id]);
      for (const [entityType, records] of Object.entries(snapshot.data)) {
        if (!ENTITY_TYPES.has(entityType)) continue;
        for (const record of records) {
          if (typeof record !== 'object' || record === null || !('id' in record) || typeof record.id !== 'string') {
            throw new Error(`Bootstrap returned an invalid ${entityType} record.`);
          }
          const value = record as Record<string, unknown>;
          await tx.run(
            `INSERT INTO local_records (
               workspace_id, entity_type, entity_id, parent_id, amount_minor,
               occurred_at, record_json, server_cursor, local_updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              snapshot.workspace.id,
              entityType,
              value.id,
              typeof value.walletId === 'string' ? value.walletId : typeof value.dueDebtId === 'string' ? value.dueDebtId : null,
              typeof value.amountMinor === 'number' ? value.amountMinor : null,
              typeof value.occurredAt === 'string' ? value.occurredAt : typeof value.paidAt === 'string' ? value.paidAt : null,
              asJson(record),
              snapshot.cursor,
              now,
            ],
          );
        }
      }
      await tx.run(
        `INSERT INTO workspace_sync_state (workspace_id, pull_cursor, last_successful_pull_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           pull_cursor = excluded.pull_cursor,
           last_successful_pull_at = excluded.last_successful_pull_at`,
        [snapshot.workspace.id, snapshot.cursor, now],
      );
    });
  }

  /** Persist a user intent before showing the UI a successful local save. */
  async enqueueCommand(workspaceId: string, command: OfflineCommand): Promise<void> {
    await this.database.run(
      `INSERT INTO sync_outbox (operation_id, workspace_id, operation_type, payload_json)
       VALUES (?, ?, ?, ?)`,
      [command.operationId, workspaceId, command.type, asJson(command.payload)],
    );
  }
}
