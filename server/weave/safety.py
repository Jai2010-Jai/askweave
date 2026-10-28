"""Noticing when the data directory is about to disappear.

Weave keeps everything that matters - accounts, projects, enquiries, sales - in one SQLite file under
`data/`. On a container platform without an attached volume (Cloud Run, Heroku, Railway and Fly without one)
the filesystem is thrown away on every redeploy. SQLite does not mind: it creates a fresh empty database and
carries on, so the service comes back up looking perfectly healthy with nobody signed up. The first sign of
trouble is a customer asking where their website went.

Worse, the daily backup would then faithfully copy that empty database over the good ones.

So this module makes the failure loud instead of silent. It can tell an ephemeral filesystem from a real one
by its type, and refuses to start on the combination that means a wipe: a disk that cannot survive a
redeploy, with the database already gone from it.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path

log = logging.getLogger("weave.safety")

# Container filesystems that are thrown away when the container is replaced. "overlay" is what Docker gives
# a container with no volume mounted, and is the one that actually bites people.
EPHEMERAL_FS = {"overlay", "overlayfs", "aufs", "tmpfs", "ramfs"}
STAMP = ".weave-data-id"


def mount_for(path: Path) -> tuple[str, str]:
    """The mount point `path` sits on and its filesystem type, e.g. ("/", "overlay").

    Falls back to ("", "") off Linux or when /proc/mounts can't be read, which is treated as "unknown" and
    never as a problem - guessing wrong here would stop a healthy server from booting.
    """
    try:
        target = path.resolve()
    except OSError:
        return "", ""
    while not target.exists() and target != target.parent:
        target = target.parent      # the directory may not exist yet; ask about the nearest parent
    best = ("", "")
    try:
        with open("/proc/mounts", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 3:
                    continue
                point = parts[1].replace("\\040", " ")
                if (target == Path(point) or Path(point) in target.parents) and len(point) >= len(best[0]):
                    best = (point, parts[2])
    except OSError:
        return "", ""
    return best


def looks_ephemeral(path: Path) -> bool:
    return mount_for(path)[1] in EPHEMERAL_FS


def data_stamp(data_dir: Path) -> dict:
    """Identify this data directory, creating the marker on first sight.

    The id changes when the directory is recreated, which is how a restored or replaced disk can be told
    apart from the original in logs and in `doctor`.
    """
    marker = data_dir / STAMP
    try:
        return json.loads(marker.read_text())
    except (OSError, ValueError):
        pass
    stamp = {"id": uuid.uuid4().hex[:12], "created": time.time()}
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps(stamp))
    except OSError as e:
        log.warning("Could not write %s: %s", marker, e)
    return stamp


def storage_report(settings) -> dict:
    """What we know about where the data lives. Read-only; `doctor` and the startup guard both use it."""
    data_dir = Path(settings.data_dir)
    point, fstype = mount_for(data_dir)
    db = Path(settings.sms_db_path)
    try:
        size = db.stat().st_size
    except OSError:
        size = 0
    return {"data_dir": str(data_dir), "mount": point, "fstype": fstype,
            "ephemeral": fstype in EPHEMERAL_FS, "db_exists": db.exists(), "db_bytes": size,
            "has_backup_copy": bool(getattr(settings, "backup_upload", ""))}


def startup_message(report: dict, *, init_ok: bool, require: bool) -> tuple[bool, str]:
    """(may_start, what to tell the operator). Pure, so the decision can be tested without a filesystem."""
    wiped = report["ephemeral"] and not report["db_exists"]
    if require and not report["db_exists"]:
        return False, (
            f"WEAVE_REQUIRE_EXISTING_DATA is set, but there is no database at {report['data_dir']}.\n"
            "  Either the storage is not mounted where it was, or it has been wiped.\n"
            "  Weave has stopped rather than start empty and let the daily backup copy an empty\n"
            "  database over the good ones. Restore a backup, or unset the variable to start fresh.")
    if wiped and not init_ok:
        return False, (
            f"The data directory {report['data_dir']} is on a {report['fstype']} filesystem, which a\n"
            "  container platform throws away on every redeploy - and the database is already gone.\n"
            "  Starting now would create an empty one and silently lose every account, site and enquiry.\n\n"
            "  Fix it by mounting a persistent volume (a Fly or Railway volume, a Render disk, or a\n"
            "  plain server with a disk) at that path, and set WEAVE_DATA_DIR to it.\n"
            "  If this really is a first deployment with nothing to lose, set WEAVE_INIT_DATA=1 once.")
    if report["ephemeral"]:
        return True, (
            f"WARNING: {report['data_dir']} is on a {report['fstype']} filesystem. Everything - accounts,\n"
            "  sites, enquiries, sales - will be erased on the next redeploy or restart of this container.\n"
            "  Mount a persistent volume there, or set WEAVE_BACKUP_UPLOAD to copy backups off this machine.")
    if not report["has_backup_copy"]:
        return True, ("Note: backups are written next to the database, so they die with it. Set\n"
                      "  WEAVE_BACKUP_UPLOAD to copy each one somewhere else.")
    return True, ""


def guard(settings) -> None:
    """Check the storage before serving. Exits the process rather than start on a wiped disk."""
    report = storage_report(settings)
    may_start, message = startup_message(report, init_ok=bool(getattr(settings, "init_data", False)),
                                         require=bool(getattr(settings, "require_existing_data", False)))
    if not may_start:
        raise SystemExit("\n  Weave did not start.\n\n  " + message + "\n")
    if message:
        print("\n  " + message + "\n")
    data_stamp(Path(settings.data_dir))


def upload_backup(path: Path, template: str, *, timeout: int = 300) -> bool:
    """Copy a finished backup off this machine with the operator's own command.

    A command rather than a built-in cloud client: it works with rclone, aws, rsync or scp, needs no new
    dependency and no credentials of ours. Run without a shell, so a path can never be re-interpreted.
    """
    import shlex
    import subprocess

    if not template:
        return False
    argv = [part.replace("{path}", str(path)) for part in shlex.split(template)]
    if not any("{path}" in part for part in shlex.split(template)):
        argv.append(str(path))      # no placeholder given: the file is the last argument
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False,
                              env={**os.environ, "WEAVE_BACKUP": str(path)})
    except (OSError, subprocess.SubprocessError) as e:
        log.error("Backup upload failed to run (%s): %s", argv[0] if argv else "?", e)
        return False
    if done.returncode != 0:
        log.error("Backup upload exited %s: %s", done.returncode, (done.stderr or done.stdout)[-400:].strip())
        return False
    log.info("Backup %s copied off this machine", path.name)
    return True
