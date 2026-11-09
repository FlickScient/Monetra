import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "monetra-v1.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS workspace_cache (
          user_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          cursor TEXT NOT NULL DEFAULT '0',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, workspace_id)
        );
        CREATE TABLE IF NOT EXISTS pending_operations (
          operation_id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          operation_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS pending_operations_owner
          ON pending_operations(user_id, workspace_id, created_at);
        CREATE TABLE IF NOT EXISTS sync_state (
          user_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          last_success_at TEXT,
          last_error TEXT,
          PRIMARY KEY (user_id, workspace_id)
        );
        CREATE TABLE IF NOT EXISTS fiscus_local_cache (
          user_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          messages_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, workspace_id)
        );
      `);
      return db;
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export type CachedWorkspace = {
  user_id: string;
  workspace_id: string;
  snapshot_json: string;
  cursor: string;
  updated_at: string;
};

export async function readCachedWorkspace(userId: string, workspaceId: string) {
  const db = await getDatabase();
  return db.getFirstAsync<CachedWorkspace>(
    "SELECT * FROM workspace_cache WHERE user_id = ? AND workspace_id = ?",
    userId, workspaceId
  );
}

export async function readAllCachedWorkspaces(userId: string) {
  const db = await getDatabase();
  return db.getAllAsync<CachedWorkspace>(
    "SELECT * FROM workspace_cache WHERE user_id = ? ORDER BY updated_at DESC",
    userId
  );
}

export async function saveCachedWorkspace(userId: string, workspaceId: string, snapshot: unknown, cursor: string) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO workspace_cache(user_id, workspace_id, snapshot_json, cursor, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, workspace_id) DO UPDATE SET
       snapshot_json = excluded.snapshot_json, cursor = excluded.cursor, updated_at = excluded.updated_at`,
    userId, workspaceId, JSON.stringify(snapshot), cursor, new Date().toISOString()
  );
}

export async function readFiscusCache(userId: string, workspaceId: string) {
  const db = await getDatabase();
  return db.getFirstAsync<{ messages_json: string }>(
    "SELECT messages_json FROM fiscus_local_cache WHERE user_id = ? AND workspace_id = ?",
    userId, workspaceId
  );
}

export async function saveFiscusCache(userId: string, workspaceId: string, messages: unknown) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO fiscus_local_cache(user_id,workspace_id,messages_json,updated_at)
     VALUES(?,?,?,?)
     ON CONFLICT(user_id,workspace_id) DO UPDATE SET
       messages_json=excluded.messages_json,updated_at=excluded.updated_at`,
    userId, workspaceId, JSON.stringify(messages), new Date().toISOString()
  );
}
