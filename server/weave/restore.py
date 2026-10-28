"""Putting a backup back.

A backup nobody has restored is a guess, not a backup, so this is a command rather than a page of
instructions: `python -m weave backups` to see what you have and that it opens, `python -m weave restore
<file>` to put one back. Both run against the same SQLite copy the daily job writes.
"""

from __future__ import annotations

import shutil
import sqlite3
import time
from pathlib import Path

# The tables worth counting in a report: enough to tell a real database from an empty or truncated one.
COUNTED = ("accounts", "users", "projects", "site_views", "site_leads", "sales_rows")


def inspect(path: Path) -> dict:
    """Open a backup read-only and count what is in it. Never raises: a broken file is a finding."""
    out: dict = {"path": path, "bytes": 0, "ok": False, "error": "", "counts": {}}
    try:
        out["bytes"] = path.stat().st_size
    except OSError as e:
        out["error"] = str(e)
        return out
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as e:
        out["error"] = str(e)
        return out
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            out["error"] = "integrity check failed"
            return out
        have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in COUNTED:
            if table in have:
                out["counts"][table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        out["ok"] = "accounts" in have
        if not out["ok"]:
            out["error"] = "no accounts table - this does not look like a Weave database"
    except sqlite3.Error as e:
        out["error"] = str(e)
    finally:
        conn.close()
    return out


def list_backups(settings) -> int:
    folder = Path(settings.data_dir) / "backups"
    files = sorted(folder.glob("sms-*.sqlite3"), reverse=True)
    if not files:
        print(f"\n  No backups in {folder}.")
        print("  They are written once a day while the server runs, and only onto this disk unless")
        print("  WEAVE_BACKUP_UPLOAD is set to copy them somewhere else.\n")
        return 1
    print(f"\n  {len(files)} backup(s) in {folder}:\n")
    for path in files:
        got = inspect(path)
        counts = ", ".join(f"{n} {t}" for t, n in got["counts"].items() if n) or "empty"
        print(f"  {'ok ' if got['ok'] else 'BAD'}  {path.name}  {got['bytes'] / 1_000_000:.1f} MB  "
              f"{counts}{'' if got['ok'] else '  <- ' + got['error']}")
    print(f"\n  Restore one with:  python -m weave restore {files[0]}\n")
    return 0


def restore(settings, source: str, *, force: bool = False) -> int:
    """Copy a backup over the live database, keeping the current one aside first."""
    path, target = Path(source), Path(settings.sms_db_path)
    got = inspect(path)
    if not got["ok"]:
        print(f"\n  Not restoring: {got['error'] or 'that file cannot be read'}\n  {path}\n")
        return 1
    counts = ", ".join(f"{n} {t}" for t, n in got["counts"].items() if n) or "nothing"
    if target.exists() and not force:
        print(f"\n  There is already a database at {target}.\n"
              f"  Restoring would replace it. Check what each one holds first:\n\n"
              f"    current:  {', '.join(f'{n} {t}' for t, n in inspect(target)['counts'].items() if n) or 'empty'}\n"
              f"    backup:   {counts}\n\n"
              f"  Then run the same command again with --force.\n")
        return 1

    # Stale -wal and -shm files belong to the database being replaced; leaving them would corrupt the one
    # coming in. The current database is moved aside rather than deleted, in case this was the mistake.
    if target.exists():
        aside = target.with_name(f"{target.name}.replaced-{time.strftime('%Y%m%d-%H%M%S')}")
        target.replace(aside)
        print(f"\n  Current database moved to {aside.name}")
    for suffix in ("-wal", "-shm"):
        Path(str(target) + suffix).unlink(missing_ok=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    print(f"  Restored {path.name} -> {target}\n  It holds {counts}.")
    print("\n  Hosted site files are not in the database. If this machine lost its disk, the sites under")
    print(f"  {Path(settings.data_dir) / 'hosted-users'} need restoring separately, and projects whose")
    print("  files are missing will need rebuilding.\n")
    return 0
