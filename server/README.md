# Weave server

The Python server behind askweave.xyz: WhatsApp/SMS and web chat, Google sign-in accounts, the AI conversation,
Android app builds, website builds, and hosting of `<username>.askweave.xyz` sites. Python package: `weave`;
settings: `WEAVE_*` in `server/.env`.

```text
WhatsApp/SMS (Twilio) ─┐                            ┌─ Android: AI writes Kotlin ─► validator ─► Gradle ─► APK ─► /download/<token>
Web chat (/chat) ──────┼─► conversation (SQLite) ───┤
Dashboard (Google) ────┘                            └─ Website: AI via website-engine ─► validator ─► <username>.askweave.xyz/<project>/
```

## Layout

| Path | What it is |
|---|---|
| `weave/server.py` | FastAPI app: wires everything together, routes `*.askweave.xyz` to hosted sites by Host header |
| `weave/config.py` | Every setting (`.env`), plus `python -m weave doctor` checks |
| `weave/sms/` | Conversation: Twilio/Meta webhooks (`routes.py`), message handling (`service.py`), the AI chat brain (`brain.py`), rule-based fallback (`intent.py`), build queue and outbox (`worker.py`), SQLite store (`store.py`, `accounts_store.py`), web chat (`chat.py`), voice notes (`voice.py`) |
| `weave/site/` | askweave.xyz accounts: Google sign-in, dashboard API, abuse reports |
| `weave/core/` | AI clients (`gemini.py`, `glm.py`), Android build pipeline (`jobs.py`, `builder.py`, `validation.py`, `prompts.py`) |
| `weave/web/` | Website builds (`builder.py` + `bridge.mjs`), validation, hosting, optional Netlify publish |
| `weave/static/` | Pages served by the server: local dashboard, `/chat`, `/start`, `/dashboard`, terms, privacy |
| `android_template/` | The Gradle project generated apps are built in |
| `scripts/run_prod.sh` | Production: server + the named Cloudflare tunnel `weave` |
| `scripts/weave_public.sh` | Development: server + a temporary `trycloudflare.com` URL |
| `data/` | All runtime data (git-ignored): `sms.sqlite3`, builds, sites, hosted sites, backups |

## Setup

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env      # fill in the keys
.venv/bin/python -m weave doctor
```

Needs Python 3.10+, Node 20+ (websites), and JDK 17 + Android SDK 35 (APK builds).

## Running

```bash
scripts/run_prod.sh                  # production at https://app.askweave.xyz (one-time tunnel setup is in the script)
.venv/bin/python -m weave serve      # local only, http://127.0.0.1:8765
```

Other commands: `doctor`, `build "<idea>"`, `sms-simulate --from +1555... "hi"` (replies printed, nothing sent),
`sms-check`, `sms-link-code`, `sms-worker`.

## Tests

```bash
.venv/bin/python -m pytest -q
```

Everything external (AI, Twilio, Google, Gradle, the website engine) is faked; nothing leaves the machine.

## Security notes

- Secrets stay server-side; child processes (Gradle, the website bridge) get a scrubbed environment.
- Generated files are confined to their build folders; Kotlin is checked for forbidden APIs before building.
- Previews and hosted sites are served with a CSP sandbox, so they can't read Weave cookies or call its APIs.
- Builds run as local processes, not containers. Isolate them (VM/container) before running untrusted builds at scale.
- APKs are debug-signed for sideloading.
