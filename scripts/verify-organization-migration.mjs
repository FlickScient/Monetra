import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. Set it in your shell; do not put it in this script or commit it.');
  process.exit(2);
}

const pool = new Pool({ connectionString });

const checks = [];
const add = (name, passed, detail) => checks.push({ name, passed, detail });

try {
  const requiredTables = ['organizations', 'organization_members', 'invitations'];
  const tableResult = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const foundTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !foundTables.has(name));
  add('Organization tables exist', missingTables.length === 0,
    missingTables.length ? `Missing: ${missingTables.join(', ')}` : 'organizations, organization_members, invitations');

  const requiredColumns = {
    wallets: ['organization_id'],
    categories: ['organization_id'],
    transactions: ['organization_id'],
    ledger_accounts: ['organization_id'],
    ledger_entries: ['organization_id'],
  };
  const columnResult = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = ANY($1::text[])
       AND column_name = 'organization_id'`,
    [Object.keys(requiredColumns)],
  );
  const foundColumns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = Object.entries(requiredColumns)
    .flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`))
    .filter((key) => !foundColumns.has(key));
  add('Finance tables have organization ownership columns', missingColumns.length === 0,
    missingColumns.length ? `Missing: ${missingColumns.join(', ')}` : 'All five finance tables');

  if (missingTables.length === 0 && missingColumns.length === 0) {
    const nullCounts = {};
    for (const table of Object.keys(requiredColumns)) {
      const result = await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE organization_id IS NULL`);
      nullCounts[table] = result.rows[0].count;
    }
    const nullTotal = Object.values(nullCounts).reduce((sum, count) => sum + count, 0);
    add('No finance records have a null organization', nullTotal === 0, JSON.stringify(nullCounts));

    const userIntegrity = await pool.query(`
      WITH users AS (
        SELECT id AS user_id FROM profiles
        UNION SELECT user_id FROM wallets
        UNION SELECT user_id FROM categories
        UNION SELECT user_id FROM transactions
        UNION SELECT user_id FROM ledger_accounts
        UNION SELECT user_id FROM ledger_entries
      ),
      personal AS (
        SELECT id, created_by FROM organizations WHERE organization_type = 'personal'
      )
      SELECT count(*)::int AS count
      FROM users u
      LEFT JOIN personal p ON p.created_by = u.user_id
      LEFT JOIN organization_members m
        ON m.organization_id = p.id AND m.user_id = u.user_id AND m.role = 'owner'
      WHERE p.id IS NULL OR m.id IS NULL
    `);
    const missingPersonalOwners = userIntegrity.rows[0].count;
    add('Every existing user has a Personal organization and owner membership',
      missingPersonalOwners === 0, `${missingPersonalOwners} user(s) missing expected membership`);

    const invalidRoles = await pool.query(`
      SELECT count(*)::int AS count FROM organization_members
      WHERE role NOT IN ('owner', 'administrator', 'editor', 'viewer')
    `);
    add('Organization member roles are valid', invalidRoles.rows[0].count === 0,
      `${invalidRoles.rows[0].count} invalid role row(s)`);

    const personalOwnerMismatch = await pool.query(`
      SELECT count(*)::int AS count
      FROM organizations o
      LEFT JOIN organization_members m
        ON m.organization_id = o.id AND m.user_id = o.created_by AND m.role = 'owner'
      WHERE o.organization_type = 'personal' AND m.id IS NULL
    `);
    add('Every Personal organization has its creator as owner',
      personalOwnerMismatch.rows[0].count === 0,
      `${personalOwnerMismatch.rows[0].count} Personal organization(s) missing creator ownership`);
  }
} catch (error) {
  console.error('Migration verification could not complete:', error instanceof Error ? error.message : 'Unknown database error');
  process.exitCode = 1;
} finally {
  await pool.end();
}

for (const check of checks) {
  console.log(`${check.passed ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`);
}
const failed = checks.filter((check) => !check.passed);
if (failed.length) {
  console.error(`\n${failed.length} verification check(s) failed. Do not treat the migration as production-ready.`);
  process.exitCode = 1;
} else if (checks.length) {
  console.log(`\nAll ${checks.length} read-only migration checks passed.`);
}
