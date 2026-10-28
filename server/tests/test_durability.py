"""The data directory is one file on one disk. These are the checks that stop it vanishing quietly."""

import shutil
import sqlite3
import time
from pathlib import Path

import pytest
from test_unified import UEnv

from weave import safety
from weave.restore import inspect, restore


def report(**over) -> dict:
    base = {"data_dir": "/data", "mount": "/", "fstype": "ext4", "ephemeral": False,
            "db_exists": True, "db_bytes": 4096, "has_backup_copy": True}
    return {**base, **over}


# ---------- deciding whether it is safe to start ----------
def test_a_wiped_container_disk_stops_the_server():
    """The whole point: an empty database on a disk that cannot keep one means the data is gone."""
    ok, msg = safety.startup_message(report(fstype="overlay", ephemeral=True, db_exists=False),
                                     init_ok=False, require=False)
    assert ok is False
    assert "silently lose every account" in msg and "persistent volume" in msg


def test_a_genuine_first_deployment_can_say_so():
    ok, _ = safety.startup_message(report(fstype="overlay", ephemeral=True, db_exists=False),
                                   init_ok=True, require=False)
    assert ok is True


def test_a_container_with_its_data_still_there_starts_but_is_warned():
    ok, msg = safety.startup_message(report(fstype="overlay", ephemeral=True), init_ok=False, require=False)
    assert ok is True and "erased on the next redeploy" in msg


def test_an_ordinary_disk_is_left_alone():
    ok, msg = safety.startup_message(report(), init_ok=False, require=False)
    assert ok is True and msg == ""


def test_backups_on_the_same_disk_are_mentioned():
    ok, msg = safety.startup_message(report(has_backup_copy=False), init_ok=False, require=False)
    assert ok is True and "die with it" in msg


def test_a_missing_database_can_be_made_fatal_anywhere():
    """On a normal disk a missing database is a first run; WEAVE_REQUIRE_EXISTING_DATA says it never is."""
    ok, msg = safety.startup_message(report(db_exists=False), init_ok=True, require=True)
    assert ok is False and "not mounted" in msg


# ---------- knowing what kind of disk it is ----------
def test_a_container_filesystem_is_recognised():
    assert safety.looks_ephemeral(Path("/tmp")) is True        # tmpfs on Linux CI and dev machines
    assert "overlay" in safety.EPHEMERAL_FS and "tmpfs" in safety.EPHEMERAL_FS


def test_an_unreadable_mount_table_is_not_treated_as_a_problem(monkeypatch):
    """Guessing wrong here would stop a healthy server booting, so unknown must mean fine."""
    monkeypatch.setattr(safety, "open", lambda *a, **k: (_ for _ in ()).throw(OSError), raising=False)
    assert safety.mount_for(Path("/")) == ("", "")
    assert safety.looks_ephemeral(Path("/")) is False


def test_the_guard_exits_rather_than_start_empty(settings, tmp_path, monkeypatch):
    settings.data_dir = tmp_path / "gone"
    monkeypatch.setattr(safety, "looks_ephemeral", lambda p: True)
    monkeypatch.setattr(safety, "mount_for", lambda p: ("/", "overlay"))
    with pytest.raises(SystemExit) as e:
        safety.guard(settings)
    assert "did not start" in str(e.value)


def test_the_data_directory_is_stamped_once(settings, tmp_path):
    settings.data_dir = tmp_path
    first = safety.data_stamp(tmp_path)
    assert first["id"] and safety.data_stamp(tmp_path)["id"] == first["id"]   # stable across restarts
    shutil.rmtree(tmp_path); tmp_path.mkdir()
    assert safety.data_stamp(tmp_path)["id"] != first["id"]                  # a new disk is a new id


# ---------- backups ----------
def test_a_backup_holds_the_data_and_says_what_is_in_it(settings, tmp_path):
    env = UEnv(settings, tmp_path)
    acct = env.store.create_account(username="sam", call_sign="Sam", email="sam@example.com")
    env.store.add_sales(acct["id"], "t.csv", [(20537, "Bun", 1, 100.0, 0.0)], 0, "INR", time.time())
    out = env.sms.housekeeping()
    got = inspect(out["backup"])
    assert got["ok"] and got["counts"]["accounts"] == 1 and got["counts"]["sales_rows"] == 1


def test_an_empty_database_is_never_copied_over_good_backups(settings, tmp_path):
    """If a wipe ever slips past the guard, the nightly copy must not finish the job off-site."""
    env = UEnv(settings, tmp_path)
    marker = tmp_path / "offsite-was-touched"
    settings.backup_upload = f"/bin/touch {marker}"
    assert env.store.one("SELECT COUNT(*) AS n FROM accounts")["n"] == 0
    assert env.sms._copy_backup_off_box(tmp_path / "x.sqlite3") is False
    assert not marker.exists()        # the upload command was never even run


def test_a_backup_is_copied_off_the_machine_when_asked(settings, tmp_path):
    env = UEnv(settings, tmp_path)
    env.store.create_account(username="sam", call_sign="Sam", email="sam@example.com")
    elsewhere = tmp_path / "offsite"
    elsewhere.mkdir()
    settings.backup_upload = f"/bin/cp {{path}} {elsewhere}/"
    out = env.sms.housekeeping()
    assert out["copied"] is True
    assert (elsewhere / out["backup"].name).exists()


def test_a_failing_upload_is_reported_not_raised(settings, tmp_path):
    env = UEnv(settings, tmp_path)
    env.store.create_account(username="sam", call_sign="Sam", email="sam@example.com")
    settings.backup_upload = "/bin/false"
    assert env.sms.housekeeping()["copied"] is False     # the server keeps running
    settings.backup_upload = "/no/such/command"
    assert env.sms.housekeeping()["copied"] is False


# ---------- restoring ----------
def test_a_backup_can_be_put_back(settings, tmp_path, capsys):
    env = UEnv(settings, tmp_path)
    acct = env.store.create_account(username="sam", call_sign="Sam", email="sam@example.com")
    env.store.add_sales(acct["id"], "t.csv", [(20537, "Bun", 1, 100.0, 0.0)], 0, "INR", time.time())
    backup = env.sms.housekeeping()["backup"]
    kept = tmp_path / "offsite.sqlite3"
    shutil.copy2(backup, kept)

    env.store.close() if hasattr(env.store, "close") else None
    settings.sms_db_path.unlink()                         # the disk went
    assert restore(settings, str(kept)) == 0

    conn = sqlite3.connect(settings.sms_db_path)
    assert conn.execute("SELECT username FROM accounts").fetchone()[0] == "sam"
    assert conn.execute("SELECT COUNT(*) FROM sales_rows").fetchone()[0] == 1
    conn.close()


def test_restoring_over_a_live_database_needs_force(settings, tmp_path, capsys):
    env = UEnv(settings, tmp_path)
    env.store.create_account(username="sam", call_sign="Sam", email="sam@example.com")
    backup = env.sms.housekeeping()["backup"]
    assert restore(settings, str(backup)) == 1            # refused, and says what each one holds
    assert "--force" in capsys.readouterr().out
    assert restore(settings, str(backup), force=True) == 0
    kept_aside = list(settings.sms_db_path.parent.glob("sms.sqlite3.replaced-*"))
    assert kept_aside                                     # the old one is moved aside, never deleted


def test_a_file_that_is_not_a_weave_database_is_refused(settings, tmp_path, capsys):
    junk = tmp_path / "holiday.jpg"
    junk.write_bytes(b"not a database")
    assert restore(settings, str(junk)) == 1
    assert inspect(junk)["ok"] is False


def test_a_corrupt_backup_is_refused(settings, tmp_path):
    broken = tmp_path / "broken.sqlite3"
    conn = sqlite3.connect(broken)
    conn.execute("CREATE TABLE accounts (id INTEGER, filler TEXT)")
    conn.executemany("INSERT INTO accounts VALUES (?, ?)", [(i, "x" * 400) for i in range(400)])
    conn.commit(); conn.close()
    data = bytearray(broken.read_bytes())
    data[8192:40_000] = b"\x00" * (40_000 - 8192)         # scribble over the pages holding the rows
    broken.write_bytes(bytes(data))
    got = inspect(broken)
    assert got["ok"] is False and got["error"]


def test_stale_write_ahead_files_do_not_survive_a_restore(settings, tmp_path):
    """A -wal left from the replaced database would corrupt the one coming in."""
    env = UEnv(settings, tmp_path)
    env.store.create_account(username="sam", call_sign="Sam", email="sam@example.com")
    backup = env.sms.housekeeping()["backup"]
    Path(str(settings.sms_db_path) + "-wal").write_bytes(b"stale")
    assert restore(settings, str(backup), force=True) == 0
    assert not Path(str(settings.sms_db_path) + "-wal").exists()
