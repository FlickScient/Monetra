import { readFileSync, existsSync } from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

// Read .env.local for local diagnostics without printing or committing secrets.
if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  const source = readFileSync('.env.local', 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env.DATABASE_URL = value;
    break;
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  DATABASE_URL is not available. Add it to .env.local or export it in this shell.');
  process.exit(2);
}

try {
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }
} catch (error) {
  console.error('FAIL  DATABASE_URL is malformed or uses an unsupported protocol.');
  process.exit(2);
}

const pool = new Pool({ connectionString });
const report = (label, ok, detail) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);

try {
  const connection = await pool.query(
    'select current_database() as database_name, current_schema() as schema_name, now() as checked_at',
  );
  report('Neon connection', true, `Connected to database "${connection.rows[0].database_name}" (schema "${connection.rows[0].schema_name}")`);

  const required = {
    organizations: [],
    organization_members: [],
    invitations: [],
    profiles: ['id'],
    wallets: ['organization_id', 'user_id'],
    categories: ['organization_id', 'user_id'],
    transactions: ['organization_id', 'user_id'],
    ledger_accounts: ['organization_id', 'user_id'],
    ledger_entries: ['organization_id', 'user_id'],
  };
  const tables = await pool.query(
    `select table_name, column_name
     from information_schema.columns
     where table_schema = current_schema()
       and table_name = any($1::text[])`,
    [Object.keys(required)],
  );
  const actual = new Map();
  for (const row of tables.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }

  const missing = [];
  for (const [table, columns] of Object.entries(required)) {
    if (!actual.has(table)) missing.push(table);
    for (const column of columns) {
      if (!actual.get(table)?.has(column)) missing.push(`${table}.${column}`);
    }
  }
  report('Required finance schema', missing.length === 0,
    missing.length ? `Missing: ${missing.join(', ')}` : 'Organization and finance tables/columns are present');

  const migrationTable = await pool.query(
    `select to_regclass('drizzle.__drizzle_migrations')::text as migration_table`,
  );
  if (!migrationTable.rows[0]?.migration_table) {
    report('Drizzle migration history', false, 'drizzle.__drizzle_migrations does not exist; migrations may not have run');
  } else {
    const applied = await pool.query(
      'select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 10',
    );
    report('Drizzle migration history', true,
      `${applied.rows.length} recent migration record(s) found. Confirm 0000_organization_foundation is applied from the schema check above.`);
  }

  if (missing.length) {
    console.error('\nDatabase is reachable, but the required Monetra schema is incomplete. Back up the database, review the migration, then run npm run db:migrate.');
    process.exitCode = 1;
  } else {
    console.log('\nThe current organization foundation schema is present. If the app still fails, inspect the sanitized MONETRA_ORG_ERROR entry in Vercel runtime logs.');
  }
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
  const message = error instanceof Error ? error.message : 'Unknown database error';
  console.error(`FAIL  Database diagnostic — ${message} (code: ${code})`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
