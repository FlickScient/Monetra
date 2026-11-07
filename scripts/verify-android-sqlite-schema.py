#!/usr/bin/env python3
"""Validate the checked-in Android SQLite migration without touching user data."""
from pathlib import Path
import sqlite3

migration = Path(__file__).resolve().parents[1] / "android" / "database" / "001_initial.sql"
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
        "local_schema_migrations",
        "local_workspaces",
        "local_records",
        "sync_outbox",
        "workspace_sync_state",
        "local_session_state",
    }
    missing = sorted(required - tables)
    if missing:
        raise RuntimeError(f"Missing required local tables: {', '.join(missing)}")

    version = connection.execute(
        "SELECT max(version) FROM local_schema_migrations"
    ).fetchone()[0]
    if version != 1:
        raise RuntimeError(f"Expected local schema version 1, got {version!r}")

    connection.execute(
        """INSERT INTO local_workspaces
           (id, owner_id, workspace_type, name, created_at, updated_at)
           VALUES ('workspace-1', 'owner-1', 'personal', 'Personal', 'now', 'now')"""
    )
    connection.execute(
        """INSERT INTO sync_outbox
           (operation_id, workspace_id, operation_type, payload_json)
           VALUES ('operation-1', 'workspace-1', 'transaction.create',
                   '{"walletId":"wallet-1","amountMinor":100}')"""
    )

    # The same operation ID must never be enqueued twice.
    try:
        connection.execute(
            """INSERT INTO sync_outbox
               (operation_id, workspace_id, operation_type, payload_json)
               VALUES ('operation-1', 'workspace-1', 'transfer.create', '{}')"""
        )
        raise RuntimeError("Outbox accepted a duplicate operation ID")
    except sqlite3.IntegrityError:
        pass

    # Foreign-key and JSON constraints must be active.
    try:
        connection.execute(
            """INSERT INTO sync_outbox
               (operation_id, workspace_id, operation_type, payload_json)
               VALUES ('operation-2', 'missing-workspace', 'transaction.create', '{}')"""
        )
        raise RuntimeError("Outbox accepted a missing workspace")
    except sqlite3.IntegrityError:
        pass

    try:
        connection.execute(
            """INSERT INTO local_records
               (workspace_id, entity_type, entity_id, record_json)
               VALUES ('workspace-1', 'transactions', 'transaction-1', '{invalid-json')"""
        )
        raise RuntimeError("Local record cache accepted invalid JSON")
    except sqlite3.IntegrityError:
        pass

    fk_errors = list(connection.execute("PRAGMA foreign_key_check"))
    if fk_errors:
        raise RuntimeError(f"SQLite foreign-key check failed: {fk_errors}")

    print("PASS: Android SQLite migration executes in SQLite.")
    print("PASS: Required cache, outbox, cursor, and session tables exist.")
    print("PASS: Schema version, idempotent outbox key, foreign keys, and JSON checks work.")
finally:
    connection.close()
