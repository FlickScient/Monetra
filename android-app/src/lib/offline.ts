import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';

let database: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase() {
  if (!database) {
    database = (async () => {
      let key = await SecureStore.getItemAsync('monetra.offline.sqlcipher-key');
      if (!key) {
        const bytes = await getRandomBytesAsync(32);
        key = Array.from(bytes).map(value => value.toString(16).padStart(2, '0')).join('');
        await SecureStore.setItemAsync('monetra.offline.sqlcipher-key', key);
      }
      const connection = await SQLite.openDatabaseAsync('monetra-offline.db');
      const cipher = await connection.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
      if (!cipher?.cipher_version) throw new Error('Encrypted offline storage is unavailable in this build. Finance data will not be cached.');
      await connection.execAsync("PRAGMA key = 'monetra-" + key + "';");
      return connection;
    })();
  }
  const db = await database;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspace_snapshots (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_operations (
      operation_id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pending_operations_workspace_idx
      ON pending_operations(workspace_id, created_at);
    CREATE TABLE IF NOT EXISTS workspace_index (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  return db;
}

export async function readSnapshot<T>(workspaceId: string): Promise<T | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM workspace_snapshots WHERE workspace_id = ?',
    workspaceId,
  );
  if (!row) return null;
  try { return JSON.parse(row.payload) as T; } catch { return null; }
}

export async function writeSnapshot(workspaceId: string, snapshot: unknown) {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO workspace_snapshots (workspace_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
    workspaceId, JSON.stringify(snapshot), Date.now(),
  );
}

export type QueuedOperation = {
  operationId: string;
  workspaceId: string;
  operationType: string;
  payload: string;
};

export async function queueOperation(workspaceId: string, operationId: string, operationType: string, payload: unknown) {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR IGNORE INTO pending_operations (operation_id, workspace_id, operation_type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
    operationId, workspaceId, operationType, JSON.stringify(payload), Date.now(),
  );
}

export async function readPendingOperations(workspaceId: string): Promise<QueuedOperation[]> {
  const db = await getDatabase();
  return db.getAllAsync<QueuedOperation>(
    'SELECT operation_id as operationId, workspace_id as workspaceId, operation_type as operationType, payload FROM pending_operations WHERE workspace_id = ? ORDER BY created_at ASC',
    workspaceId,
  );
}

export async function removePendingOperation(operationId: string) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM pending_operations WHERE operation_id = ?', operationId);
}

export async function writeWorkspaceIndex(workspaces: unknown[]) {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM workspace_index');
    for (const workspace of workspaces as { id: string }[]) {
      await db.runAsync('INSERT OR REPLACE INTO workspace_index (workspace_id, payload) VALUES (?, ?)', workspace.id, JSON.stringify(workspace));
    }
  });
}

export async function readWorkspaceIndex<T>(): Promise<T[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM workspace_index ORDER BY rowid');
  return rows.flatMap(row => { try { return [JSON.parse(row.payload) as T]; } catch { return []; } });
}
