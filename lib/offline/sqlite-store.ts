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

const ENTITY_TYPE_MAP: Record<string, string> = {
  wallets: 'wallets',
  categories: 'categories',
  transactions: 'transactions',
  ledger_accounts: 'ledgerAccounts',
  ledger_entries: 'ledgerEntries',
  savings_goals: 'savingsGoals',
  goal_allocations: 'goalAllocations',
  goal_allocation_events: 'goalAllocationEvents',
  due_debts: 'dueDebts',
  due_debt_payments: 'dueDebtPayments',
  monthly_budgets: 'monthlyBudgets',
  recurring_transactions: 'recurringTransactions',
  wallet_reconciliations: 'walletReconciliations',
  finance_audit_events: 'financeAuditEvents',
};

function normalizeEntityType(entityType: string): string | null {
  return ENTITY_TYPE_MAP[entityType] ?? (Object.values(ENTITY_TYPE_MAP).includes(entityType) ? entityType : null);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid finance record.');
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    entry,
  ]));
}

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

async function rollbackOptimisticTransaction(
  tx: LocalSqliteConnection,
  operationId: string,
): Promise<void> {
  const row = await tx.get<OutboxRow>(
    `SELECT operation_id, workspace_id, operation_type, payload_json, state,
            attempt_count, created_at, last_attempt_at, last_error, server_result_json
     FROM sync_outbox WHERE operation_id = ?`,
    [operationId],
  );
  if (!row) return;
  const command = mapOutbox(row);
  if (command.type === 'transaction.create') {
    const walletRow = await tx.get<{ record_json: string }>(
      `SELECT record_json FROM local_records
       WHERE workspace_id = ? AND entity_type = 'wallets' AND entity_id = ?`,
      [row.workspace_id, command.payload.walletId],
    );
    if (walletRow) {
      const wallet = JSON.parse(walletRow.record_json) as Record<string, unknown>;
      const isCreditCard = wallet.walletType === 'credit_card';
      const increased = isCreditCard
        ? command.payload.transactionType === 'expense'
        : command.payload.transactionType === 'income';
      const current = Number(wallet.currentBalanceMinor ?? 0);
      const restored = current + (increased ? -command.payload.amountMinor : command.payload.amountMinor);
      await tx.run(
        `UPDATE local_records SET record_json = ?,
           local_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE workspace_id = ? AND entity_type = 'wallets' AND entity_id = ?`,
        [asJson({ ...wallet, currentBalanceMinor: restored }), row.workspace_id, command.payload.walletId],
      );
    }
    await tx.run('DELETE FROM local_records WHERE local_operation_id = ?', [operationId]);
  }
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
    await this.database.transaction(async (tx) => {
      const response = result.result as {
        transaction?: Record<string, unknown>;
        wallet?: Record<string, unknown>;
      } | undefined;
      const transaction = response?.transaction;
      const wallet = response?.wallet;

      // Promote the optimistic row to the server-issued ID. The next pull
      // upserts the same entity, so a successful offline save never vanishes
      // between push and pull and never appears twice.
      if (transaction && typeof transaction.id === 'string') {
        await tx.run(
          `UPDATE local_records SET entity_id = ?, parent_id = ?, amount_minor = ?,
             occurred_at = ?, record_json = ?, local_operation_id = NULL,
             local_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE local_operation_id = ?`,
          [
            transaction.id,
            typeof transaction.walletId === 'string' ? transaction.walletId : null,
            typeof transaction.amountMinor === 'number' ? transaction.amountMinor : null,
            typeof transaction.occurredAt === 'string' ? transaction.occurredAt : null,
            asJson(transaction),
            operationId,
          ],
        );
      }

      if (wallet && typeof wallet.id === 'string') {
        await tx.run(
          `UPDATE local_records SET record_json = ?,
             local_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE workspace_id = ? AND entity_type = 'wallets' AND entity_id = ?`,
          [asJson(wallet), (await tx.get<{ workspace_id: string }>(
            'SELECT workspace_id FROM sync_outbox WHERE operation_id = ?',
            [operationId],
          ))?.workspace_id ?? '', wallet.id],
        );
      }

      await tx.run(
        `DELETE FROM sync_outbox WHERE operation_id = ? AND state = 'processing'`,
        [operationId],
      );
    });
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
    await this.database.transaction(async (tx) => {
      await rollbackOptimisticTransaction(tx, operationId);
      await tx.run(
        `UPDATE sync_outbox
         SET state = 'conflict', last_error = ?, server_result_json = ?
         WHERE operation_id = ? AND state = 'processing'`,
        [reason.slice(0, 1000), asJson(result), operationId],
      );
    });
  }

  async markCommandRejected(
    operationId: string,
    reason: string,
    result: OfflineCommandResult,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await rollbackOptimisticTransaction(tx, operationId);
      await tx.run(
        `UPDATE sync_outbox
         SET state = 'rejected', last_error = ?, server_result_json = ?
         WHERE operation_id = ? AND state = 'processing'`,
        [reason.slice(0, 1000), asJson(result), operationId],
      );
    });
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
        if (cursor !== previous + BigInt('1') || cursor > targetCursor) {
          throw new Error('The server returned a missing, unordered, or out-of-range change cursor.');
        }
        previous = cursor;
        const entityType = normalizeEntityType(change.entityType);
        if (!entityType) {
          throw new Error(`Unsupported finance sync entity: ${change.entityType}`);
        }
        const record = change.operation === 'delete' ? null : normalizeRecord(change.payload);
        await tx.run(
          `INSERT INTO local_records (
             workspace_id, entity_type, entity_id, parent_id, amount_minor,
             occurred_at, record_json, is_deleted, server_cursor, local_updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(workspace_id, entity_type, entity_id) DO UPDATE SET
             parent_id = excluded.parent_id,
             amount_minor = excluded.amount_minor,
             occurred_at = excluded.occurred_at,
             record_json = excluded.record_json,
             is_deleted = excluded.is_deleted,
             server_cursor = excluded.server_cursor,
             local_updated_at = excluded.local_updated_at`,
          [
            workspaceId,
            entityType,
            change.entityId,
            typeof record?.walletId === 'string' ? record.walletId : typeof record?.dueDebtId === 'string' ? record.dueDebtId : null,
            typeof record?.amountMinor === 'number' ? record.amountMinor : null,
            typeof record?.occurredAt === 'string' ? record.occurredAt : typeof record?.paidAt === 'string' ? record.paidAt : null,
            record ? asJson(record) : '{}',
            change.operation === 'delete' ? 1 : 0,
            cursor.toString(),
          ],
        );
      }

      if (changes.length > 0 && previous !== targetCursor) {
        throw new Error('The server cursor does not match the final change in this page.');
      }
      if (changes.length === 0 && targetCursor !== currentCursor) {
        throw new Error('The server attempted to advance the cursor without returning changes.');
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
        const normalizedType = normalizeEntityType(entityType);
        if (!normalizedType) continue;
        for (const rawRecord of records) {
          const value = normalizeRecord(rawRecord);
          if (typeof value.id !== 'string') {
            throw new Error(`Bootstrap returned an invalid ${entityType} record.`);
          }
          await tx.run(
            `INSERT INTO local_records (
               workspace_id, entity_type, entity_id, parent_id, amount_minor,
               occurred_at, record_json, server_cursor, local_updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              snapshot.workspace.id,
              normalizedType,
              value.id,
              typeof value.walletId === 'string' ? value.walletId : typeof value.dueDebtId === 'string' ? value.dueDebtId : null,
              typeof value.amountMinor === 'number' ? value.amountMinor : null,
              typeof value.occurredAt === 'string' ? value.occurredAt : typeof value.paidAt === 'string' ? value.paidAt : null,
              asJson(value),
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

  /** Persist an intent and its optimistic transaction row atomically before UI success. */
  async enqueueCommand(workspaceId: string, command: OfflineCommand): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO sync_outbox (operation_id, workspace_id, operation_type, payload_json)
         VALUES (?, ?, ?, ?)`,
        [command.operationId, workspaceId, command.type, asJson(command.payload)],
      );

      if (command.type === 'transaction.create') {
        const payload = command.payload;
        if (!Number.isSafeInteger(payload.amountMinor) || payload.amountMinor <= 0) {
          throw new Error('Enter a valid positive transaction amount before saving offline.');
        }
        if (!Number.isFinite(Date.parse(payload.occurredAt))) {
          throw new Error('The transaction date is invalid.');
        }

        const walletRow = await tx.get<{ record_json: string }>(
          `SELECT record_json FROM local_records
           WHERE workspace_id = ? AND entity_type = 'wallets'
             AND entity_id = ? AND is_deleted = 0`,
          [workspaceId, payload.walletId],
        );
        if (!walletRow) throw new Error('This wallet is not available in the offline cache. Connect once to refresh it.');
        const wallet = JSON.parse(walletRow.record_json) as Record<string, unknown>;
        if (wallet.status !== 'active') throw new Error('This wallet is inactive and cannot receive offline transactions.');

        if (payload.categoryId) {
          const categoryRow = await tx.get<{ record_json: string }>(
            `SELECT record_json FROM local_records
             WHERE workspace_id = ? AND entity_type = 'categories'
               AND entity_id = ? AND is_deleted = 0`,
            [workspaceId, payload.categoryId],
          );
          if (!categoryRow) throw new Error('This category is not available in the offline cache.');
          const category = JSON.parse(categoryRow.record_json) as Record<string, unknown>;
          if (category.categoryType !== payload.transactionType) {
            throw new Error('Choose a category that matches the transaction type.');
          }
        }

        const currentBalance = Number(wallet.currentBalanceMinor ?? 0);
        const creditLimit = Number(wallet.creditLimitMinor ?? 0);
        const isCreditCard = wallet.walletType === 'credit_card';
        const increasesBalance = isCreditCard
          ? payload.transactionType === 'expense'
          : payload.transactionType === 'income';
        const nextBalance = currentBalance + (increasesBalance ? payload.amountMinor : -payload.amountMinor);
        if (!Number.isSafeInteger(nextBalance)) throw new Error('This wallet balance exceeds the supported amount range.');
        if (isCreditCard && payload.transactionType === 'expense' && creditLimit > 0 && nextBalance > creditLimit) {
          throw new Error('This transaction would exceed the wallet credit limit.');
        }
        if (isCreditCard && payload.transactionType === 'income' && currentBalance < payload.amountMinor) {
          throw new Error('This payment is greater than the current card balance.');
        }

        const optimisticWallet = { ...wallet, currentBalanceMinor: nextBalance };
        await tx.run(
          `UPDATE local_records SET record_json = ?,
             local_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE workspace_id = ? AND entity_type = 'wallets' AND entity_id = ?`,
          [asJson(optimisticWallet), workspaceId, payload.walletId],
        );

        const localRecord = {
          id: command.operationId,
          transactionType: payload.transactionType,
          walletId: payload.walletId,
          destinationWalletId: null,
          categoryId: payload.categoryId ?? null,
          amountMinor: payload.amountMinor,
          description: payload.description,
          occurredAt: payload.occurredAt,
          pendingSync: true,
        };
        await tx.run(
          `INSERT INTO local_records (
             workspace_id, entity_type, entity_id, parent_id, amount_minor,
             occurred_at, record_json, is_deleted, server_cursor,
             local_operation_id, local_updated_at
           ) VALUES (?, 'transactions', ?, ?, ?, ?, ?, 0, '0', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
          [
            workspaceId,
            command.operationId,
            payload.walletId,
            payload.amountMinor,
            payload.occurredAt,
            asJson(localRecord),
            command.operationId,
          ],
        );
      }
    });
  }

  async listLocalRecords<T>(workspaceId: string, entityType: string): Promise<T[]> {
    const rows = await this.database.all<{ record_json: string }>(
      `SELECT record_json FROM local_records
       WHERE workspace_id = ? AND entity_type = ? AND is_deleted = 0
       ORDER BY occurred_at DESC, entity_id DESC`,
      [workspaceId, entityType],
    );
    return rows.map((row) => JSON.parse(row.record_json) as T);
  }

  async rememberLocalSession(ownerId: string): Promise<void> {
    await this.database.run(
      `INSERT INTO local_session_state (owner_id, last_authenticated_at, lock_required)
       VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
       ON CONFLICT(owner_id) DO UPDATE SET
         last_authenticated_at = excluded.last_authenticated_at`,
      [ownerId],
    );
  }

  async getLastLocalSessionOwner(): Promise<string | null> {
    const row = await this.database.get<{ owner_id: string }>(
      `SELECT owner_id FROM local_session_state
       ORDER BY last_authenticated_at DESC LIMIT 1`,
    );
    return row?.owner_id ?? null;
  }

  async listLocalWorkspaces(ownerId: string): Promise<Array<{
    id: string;
    name: string;
    workspace_type: 'personal' | 'family' | 'business';
  }>> {
    return this.database.all(
      `SELECT id, name, workspace_type FROM local_workspaces
       WHERE owner_id = ? ORDER BY CASE workspace_type
         WHEN 'personal' THEN 0 WHEN 'family' THEN 1 ELSE 2 END`,
      [ownerId],
    );
  }
}
