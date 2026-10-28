# Keeping the data alive

Everything Weave knows lives in **one SQLite file**, `data/sms.sqlite3`: accounts, projects, conversations,
site analytics, enquiries, sales. The websites themselves are ordinary files under `data/hosted-users/`.

That is a good arrangement - one file to copy, no database server to run - with exactly one way to lose
everything at once.

## The failure this is built to prevent

Several popular platforms give a container an **ephemeral filesystem**: Cloud Run, Heroku, Railway and Fly
without a volume attached. Every redeploy or restart hands the new container a blank disk.

SQLite does not mind a blank disk. It creates a fresh empty database and carries on. So the service comes
back up, healthy, responding, with nobody signed up and no sites. Nothing errors. The first sign of trouble
is a customer asking where their website went - and by then the nightly backup has copied the empty
database over the good ones.

**Weave now refuses to start in exactly that situation**: a filesystem that cannot survive a redeploy, with
the database already missing from it. It prints what happened and stops, which is recoverable. Coming back
up empty is not.

```
  Weave did not start.

  The data directory /app/data is on a overlay filesystem, which a container platform
  throws away on every redeploy - and the database is already gone.
  Starting now would create an empty one and silently lose every account, site and enquiry.

  Fix it by mounting a persistent volume (a Fly or Railway volume, a Render disk, or a
  plain server with a disk) at that path, and set WEAVE_DATA_DIR to it.
  If this really is a first deployment with nothing to lose, set WEAVE_INIT_DATA=1 once.
```

`python -m weave doctor` reports the same thing before you deploy, under **Data directory**.

## Deploying it properly

**Option 1 - a persistent volume (do this).** Fly volumes, Railway volumes, Render disks, or a plain VM with
an ordinary disk. Mount it and point Weave at it:

```bash
WEAVE_DATA_DIR=/data          # the mount point, not a path inside the image
```

A small VM with a disk (Hetzner, around EUR 4/month) is the simplest thing that works, and SQLite on a real
disk is very fast.

**Option 2 - replicate the file continuously.** [Litestream](https://litestream.io) watches the SQLite file
and streams changes to object storage as they happen. No code changes, roughly a dollar a month, and it
gives point-in-time restore. Worth having **as well as** a volume.

Either way, remember `data/hosted-users/` - the customers' actual websites. The database knows a project
exists; the HTML lives on disk. Restoring one without the other leaves projects that need rebuilding.

## Backups

A backup is written once a day while the server runs, using SQLite's online backup (safe on a live
database), into `data/backups/`, keeping the newest `WEAVE_BACKUP_KEEP` (default 7).

**By default those sit on the same disk as the database, so a lost disk loses both.** Give Weave a command
to copy each one somewhere else:

```bash
WEAVE_BACKUP_UPLOAD="rclone copy {path} b2:weave-backups"
WEAVE_BACKUP_UPLOAD="aws s3 cp {path} s3://weave-backups/"
WEAVE_BACKUP_UPLOAD="scp {path} backups@elsewhere:/srv/weave/"
```

`{path}` is replaced with the backup file; leave it out and the path is appended as the last argument. The
command runs without a shell, so nothing in the path can be re-interpreted. A failure is logged and the
server keeps running.

**A database with no accounts in it is never uploaded.** If a wipe ever gets past the startup guard, the
nightly copy must not finish the job by overwriting good backups off-site.

## Putting a backup back

A backup nobody has restored is a guess, so both steps are commands:

```bash
python -m weave backups          # what you have, and whether each one opens
python -m weave restore data/backups/sms-20261028-000102.sqlite3
```

`backups` opens each file read-only, runs an integrity check and counts what is inside, so a truncated or
half-copied file is visible before you need it:

```
  3 backup(s) in /data/backups:

  ok   sms-20261028-000102.sqlite3  2.4 MB  12 accounts, 31 projects, 4812 site_views, 7 site_leads
  ok   sms-20261027-000101.sqlite3  2.4 MB  12 accounts, 30 projects, 4603 site_views, 7 site_leads
  BAD  sms-20261026-000104.sqlite3  0.0 MB  empty  <- no accounts table
```

`restore` refuses a file that is not a Weave database, refuses to replace a live one without `--force`, and
when it does replace one it **moves the current database aside** rather than deleting it. Stop the server
first. Stale `-wal`/`-shm` files are removed, because leaving them would corrupt the database coming in.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `WEAVE_DATA_DIR` | `server/data` | Where everything lives. Point this at a mounted volume. |
| `WEAVE_BACKUP_UPLOAD` | — | Command to copy each backup off this machine. `{path}` is the file. |
| `WEAVE_BACKUP_KEEP` | `7` | How many local backups to keep. |
| `WEAVE_REQUIRE_EXISTING_DATA` | `off` | Refuse to start whenever the database is missing, on any disk. Belt and braces once you are live. |
| `WEAVE_INIT_DATA` | `off` | Set once on a genuine first deployment to a container disk. |

## A sensible production setup

```bash
WEAVE_DATA_DIR=/data                                    # a mounted volume
WEAVE_REQUIRE_EXISTING_DATA=on                          # after the first successful start
WEAVE_BACKUP_UPLOAD="rclone copy {path} b2:weave-backups"
```

Then actually try it: restore yesterday's backup into a scratch directory and run
`python -m weave backups` against it. An untested backup is not a backup.
