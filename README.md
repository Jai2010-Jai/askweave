# askweave

Weave builds real Android apps and websites from plain-language messages on WhatsApp, SMS and web chat.
Someone texts an idea, Weave asks what it needs to know, builds it with AI and texts back a link.

This repository holds every part of it:

| Folder | What it is | Stack |
|---|---|---|
| [`server/`](server/) | The Weave server ("genesis"): WhatsApp/SMS/web chat, accounts, the AI brain, languages, build jobs, Android builder, hosting of `username.askweave.xyz` sites | Python 3.12, FastAPI, SQLite, Gradle |
| [`website-engine/`](website-engine/) | The website generator the server drives through `server/genesis/web/bridge.mjs` (design research, home page, extra pages). Copied from [adityapokuri229/weave](https://github.com/adityapokuri229/weave), MIT license | Node 20+ |
| [`site/`](site/) | The askweave.xyz marketing site with the waitlist | Next.js (static export), Supabase, Netlify |
| [`mobile/`](mobile/) | Genesis Studio, the Weave phone app | Android, Kotlin, Jetpack Compose |

## How the parts fit

```text
WhatsApp / SMS (Twilio) ─┐
Web chat ────────────────┼─► server/  ─► Android builder (Gradle) ─► APK download link
askweave.xyz dashboard ──┘     │      └► website-engine/ (Node)  ─► username.askweave.xyz/project
                               └──► AI: GLM-4.7-Flash first, Gemini as the fallback
site/ ─► askweave.xyz landing page and waitlist (Netlify + Supabase)
```

## Running it

**Server** (from `server/`):

```bash
cd server
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in GLM_API_KEY and/or GEMINI_API_KEY, Twilio, PUBLIC_BASE_URL
.venv/bin/python -m genesis serve
```

Android builds need JDK 17 and the Android SDK. Website builds need Node 20+ and the engine's packages:

```bash
cd website-engine && npm install
```

`GENESIS_WEBSITE_ENGINE_DIR=../website-engine` in `server/.env` points the server at it. To reach the server from
phones and Twilio, run a Cloudflare tunnel (or any HTTPS tunnel) to it and set `PUBLIC_BASE_URL`. See
[`server/README.md`](server/README.md) and [`server/docs/SMS.md`](server/docs/SMS.md).

**Site** (from `site/`):

```bash
cd site && npm install
npm run dev     # local
npm run build   # static export into site/out, deployed to Netlify
```

It needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `site/.env.local`; the tables are in
`site/supabase/`.

**Phone app**: `server/scripts/build_phone_app.sh` builds `mobile/` into `server/dist/Genesis.apk`.

## Tests

```bash
cd server && .venv/bin/python -m pytest
```

No keys, user data or build output are in this repository: `.env` files, `server/data/`, `node_modules/` and build
folders are ignored.
