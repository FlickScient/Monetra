import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { LocalSqliteConnection } from './sqlite-store';

const DATABASE_NAME = 'monetra';
const DATABASE_VERSION = 1;

class CapacitorSqliteConnection implements LocalSqliteConnection {
  constructor(private readonly connection: SQLiteDBConnection) {}

  async run(sql: string, values: unknown[] = []): Promise<void> {
    await this.connection.run(sql, values as any[], false);
  }

  async get<T>(sql: string, values: unknown[] = []): Promise<T | undefined> {
    const result = await this.connection.query(sql, values as any[]);
    return result.values?.[0] as T | undefined;
  }

  async all<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.connection.query(sql, values as any[]);
    return (result.values ?? []) as T[];
  }

  async transaction<T>(work: (tx: LocalSqliteConnection) => Promise<T>): Promise<T> {
    await this.connection.beginTransaction();
    try {
      const result = await work(this);
      await this.connection.commitTransaction();
      return result;
    } catch (error) {
      await this.connection.rollbackTransaction();
      throw error;
    }
  }
}

let databasePromise: Promise<LocalSqliteConnection> | null = null;

function createDatabaseSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Opens encrypted, durable SQLite storage inside the Android app sandbox. */
export async function openNativeFinanceDatabase(): Promise<LocalSqliteConnection> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native finance storage is available only inside the Monetra Android app.');
  }

  if (!databasePromise) {
    databasePromise = (async () => {
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      await sqlite.checkConnectionsConsistency();

      const secretState = await sqlite.isSecretStored();
      if (!secretState.result) {
        await sqlite.setEncryptionSecret(createDatabaseSecret());
      }

      const existing = await sqlite.isConnection(DATABASE_NAME, false);
      if (!existing.result) {
        await sqlite.createConnection(DATABASE_NAME, true, 'secret', DATABASE_VERSION, false);
      }

      const connection = await sqlite.retrieveConnection(DATABASE_NAME, false);
      await connection.open();

      const response = await fetch('/sqlite/001_initial.sql', { cache: 'no-store' });
      if (!response.ok) throw new Error('The Monetra local database schema could not be loaded.');
      await connection.execute(await response.text(), false);

      return new CapacitorSqliteConnection(connection);
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}
