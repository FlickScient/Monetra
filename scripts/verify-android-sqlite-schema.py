#!/usr/bin/env python3
"""Validate both the native migration and the SQL asset bundled into Android."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    ROOT / "android" / "database" / "001_initial.sql",
    ROOT / "public" / "sqlite" / "001_initial.sql",
]

def verify_migration(migration: Path) -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        connection.executescript(migration.read_text(encoding="utf-8"))
        tables = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        required = {
            "local_schema_migrations", "local_workspaces", "local_records",
            "sync_outbox", "workspace_sync_state", "local_session_state",
        }
        missing = sorted(required - tables)
        if missing:
            raise RuntimeError(f"{migration}: missing tables: {', '.join(missing)}")

        version = connection.execute(
            "SELECT max(version) FROM local_schema_migrations"
        ).fetchone()[0]
        if version != 1:
            raise RuntimeError(f"{migration}: expected schema version 1, got {version!r}")

        # Cursor values are decimal text so JS never rounds a 64-bit server cursor.
        cursor_columns = {
            table: {
                row[1]: row[2].upper()
                for row in connection.execute(f"PRAGMA table_info({table})")
            }
            for table in ("local_workspaces", "local_records", "workspace_sync_state")
        }
        if cursor_columns["workspace_sync_state"].get("pull_cursor") != "TEXT":
            raise RuntimeError(f"{migration}: pull_cursor must be TEXT")
        if cursor_columns["local_workspaces"].get("snapshot_cursor") != "TEXT":
            raise RuntimeError(f"{migration}: snapshot_cursor must be TEXT")
        if cursor_columns["local_records"].get("server_cursor") != "TEXT":
            raise RuntimeError(f"{migration}: server_cursor must be TEXT")
        if "local_operation_id" not in cursor_columns["local_records"]:
            raise RuntimeError(f"{migration}: local_operation_id is required for offline reconciliation")

        connection.execute(
            """INSERT INTO local_workspaces
               (id, owner_id, workspace_type, name, created_at, updated_at,
                snapshot_cursor)
               VALUES ('workspace-1', 'owner-1', 'personal', 'Personal',
                       'now', 'now', '9007199254740993123')"""
        )
        connection.execute(
            """INSERT INTO workspace_sync_state (workspace_id, pull_cursor)
               VALUES ('workspace-1', '9007199254740993123')"""
        )
        stored_cursor = connection.execute(
            "SELECT pull_cursor FROM workspace_sync_state WHERE workspace_id = 'workspace-1'"
        ).fetchone()[0]
        if stored_cursor != "9007199254740993123":
            raise RuntimeError(f"{migration}: sync cursor lost precision")

        connection.execute(
            """INSERT INTO sync_outbox
               (operation_id, workspace_id, operation_type, payload_json)
               VALUES ('operation-1', 'workspace-1', 'transaction.create',
                       '{"walletId":"wallet-1","amountMinor":100}')"""
        )
        connection.execute(
            """INSERT INTO local_records
               (workspace_id, entity_type, entity_id, record_json, local_operation_id)
               VALUES ('workspace-1', 'transactions', 'local-transaction-1',
                       '{"id":"local-transaction-1"}', 'operation-1')"""
        )
        try:
            connection.execute(
                """INSERT INTO sync_outbox
                   (operation_id, workspace_id, operation_type, payload_json)
                   VALUES ('operation-1', 'workspace-1', 'transfer.create', '{}')"""
            )
            raise RuntimeError(f"{migration}: duplicate operation ID was accepted")
        except sqlite3.IntegrityError:
            pass

        try:
            connection.execute(
                """INSERT INTO local_records
                   (workspace_id, entity_type, entity_id, record_json, local_operation_id)
                   VALUES ('workspace-1', 'transactions', 'local-transaction-2',
                           '{"id":"local-transaction-2"}', 'operation-1')"""
            )
            raise RuntimeError(f"{migration}: duplicate local operation mapping was accepted")
        except sqlite3.IntegrityError:
            pass

        try:
            connection.execute(
                """INSERT INTO sync_outbox
                   (operation_id, workspace_id, operation_type, payload_json)
                   VALUES ('operation-2', 'missing-workspace', 'transaction.create', '{}')"""
            )
            raise RuntimeError(f"{migration}: missing workspace was accepted")
        except sqlite3.IntegrityError:
            pass

        try:
            connection.execute(
                """INSERT INTO local_records
                   (workspace_id, entity_type, entity_id, record_json)
                   VALUES ('workspace-1', 'transactions', 'transaction-1', '{invalid-json')"""
            )
            raise RuntimeError(f"{migration}: invalid JSON was accepted")
        except sqlite3.IntegrityError:
            pass

        if list(connection.execute("PRAGMA foreign_key_check")):
            raise RuntimeError(f"{migration}: foreign-key check failed")
    finally:
        connection.close()

for path in MIGRATIONS:
    verify_migration(path)
    print(f"PASS: {path.relative_to(ROOT)} executes and preserves cursor precision.")

print("PASS: Both checked-in and bundled Android SQLite schemas are valid.")
