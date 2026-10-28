# Weave (askweave.xyz)

Weave builds real Android apps and websites from plain-language messages on WhatsApp, SMS and web chat.
Someone texts an idea, Weave talks it through like a friend (in their own style: Gen Z, Hinglish, formal, Hindi
script...), builds it with AI, and texts back a link. Websites go live at `https://<username>.askweave.xyz/<project>/`.

| Folder | What it is | Stack | Runs on |
|---|---|---|---|
| [`server/`](server/) | The Weave server: WhatsApp/SMS/web chat, Google sign-in accounts, the AI conversation, Android and website builds, hosting of user sites | Python 3.12, FastAPI, SQLite, Gradle | Our machine, behind a Cloudflare tunnel |
| [`website-engine/`](website-engine/) | The website generator the server runs through `server/weave/web/bridge.mjs` (4 files, from [adityapokuri229/weave](https://github.com/adityapokuri229/weave), MIT) | Node 20+ | Same machine (child process) |
| [`site/`](site/) | The askweave.xyz **marketing page** with the waitlist | Next.js static export, Supabase | **Netlify** (separate from the app) |
| [`mobile/`](mobile/) | Weave Studio, a phone app that talks to the server over Wi-Fi | Android, Kotlin, Jetpack Compose | Sideloaded APK |

## How it all connects

```text
askweave.xyz, www.askweave.xyz ─► Netlify ─► site/ (static marketing page)
                                              └─ waitlist sign-ups ─► Supabase (Auth + `waitlist` table)

app.askweave.xyz ────┐
*.askweave.xyz ──────┼─► Cloudflare DNS ─► Cloudflare tunnel "weave" ─► server/ on 127.0.0.1:8765
Twilio (WhatsApp/SMS)┘                                                   │
                                                                         ├─ AI: one model (Groq gpt-oss-120b by default)
                                                                         ├─ Sign-in: Google OAuth (name + email only)
                                                                         ├─ Android builds: Gradle ─► /download/<token>
                                                                         ├─ Websites: website-engine ─► <username>.askweave.xyz/<project>/
                                                                         ├─ Voice notes: faster-whisper, on this machine
                                                                         └─ Data: server/data/ (SQLite + site files + backups)
```

**Two separate systems:**
- **Marketing site + waitlist** (`site/`): a static Next.js export on **Netlify**. Its only backend is **Supabase**
  (Supabase Auth for the waitlist login and a `waitlist` table with referrals, schema in `site/supabase/`). It does
  not talk to the Weave server.
- **The product** (`server/`): everything users actually use, `app.askweave.xyz` and every user subdomain, served
  by the Weave server through a Cloudflare tunnel. It has its own accounts in SQLite. **No Supabase, no Netlify.**

### Every external service

| Service | Used for | Configured in |
|---|---|---|
| **Cloudflare** | DNS for askweave.xyz, HTTPS certificates, named tunnel `weave` (`app` and `*` CNAMEs), Email Routing for @askweave.xyz | Cloudflare dashboard; tunnel token in `~/.cloudflared/weave.token` |
| **Twilio** | WhatsApp and SMS on one number; webhook `https://app.askweave.xyz/api/webhooks/twilio/sms` (set on the number, the WhatsApp sender and the Messaging Service) | `TWILIO_*` in `server/.env`, Twilio Console |
| **Groq** (default AI) | Every AI call: chat, Android app code, websites. Model `openai/gpt-oss-120b`. Free tier: 1,000 requests/day, 8,000 tokens/min | `WEAVE_AI_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL` |
| Gemini or GLM (optional) | Drop-in replacements for Groq; still one model, never a fallback | `WEAVE_AI_PROVIDER=gemini` or `glm` with its key |
| **Google OAuth** | "Continue with Google", the only way to sign in or sign up; asks for name and email only | `GOOGLE_CLIENT_ID/SECRET`; redirect `https://app.askweave.xyz/auth/google/callback` |
| faster-whisper | Voice-note transcription, locally, no outside service | `WEAVE_VOICE_MODEL` |
| minimal.gallery, Tailwind CDN, Google Fonts | Design inspiration while building; loaded by visitors' browsers on generated sites | none |
| **Netlify** | Only the marketing page (`site/`) | Netlify site `weave-ai-704` |
| **Supabase** | Only the waitlist on the marketing page | `site/.env.local` / Netlify env vars |

## The product, end to end

1. **Sign up.** On `app.askweave.xyz/start` a person taps **Continue with Google**. A new account picks a permanent
   username (their subdomain) and what Weave should call them (pre-filled from Google); a returning account goes
   straight to the dashboard. The dashboard shows a `LINK <code>` to text from WhatsApp, which ties their number
   to the account.
2. **Chat.** Every message that isn't an exact command (`STATUS`, `HELP`, `STOP`, ...) goes to the AI with the full
   picture: the last 20 messages, every project (idea, recent changes, live link, last error), any running build
   and the person's own address. It replies like a friend, mirrors how they write, and picks one action: reply,
   build an app, build a website, change a project, rename it, status, list, send a link, switch, cancel, retry.
   The server carries the action out with its own checks (ownership, quotas, one build at a time). If the AI
   can't answer, the person is told honestly to try again; nothing is guessed by scripts.
3. **Build.**
   - *Website:* the bridge runs the engine (design research, then the page, then optional extra pages), the
     output is validated (complete HTML, CDN-only scripts, no forms posting elsewhere; embedded iframes are
     stripped), and it goes live at `https://<username>.askweave.xyz/<project-slug>/` in an atomic swap.
   - *Android app:* the AI writes a Kotlin + Jetpack Compose app, it's validated, built with Gradle (up to 2
     repair rounds), verified, and sent as a `/download/<token>` link (expires after 72 h).
4. **Change, rename, delete.** "make the header dark brown" builds a new version (the old one stays until the new
   one passes). Renaming a project (in chat or on the dashboard) moves its live address to match the new name.
   Deleted projects go to a 30-day trash.
5. **Visitors.** Weave counts the visits to each live site and tells the owner in plain language: "Bakery
   site, last 7 days: 42 visits from 31 people, up 20%." Ask in chat ("how's my site doing?", or `STATS`),
   or see the charts on the dashboard. The counting is ours, with no third party and no cookies: a visitor
   is a keyed hash whose key never leaves memory and is replaced daily, so no IP address or user agent is
   ever stored and nobody can be followed from one site to another.
6. **Enquiries.** The contact form on a generated site opens a short form on `app.askweave.xyz` (the site's
   own sandbox blocks form posts), and the enquiry reaches the owner on WhatsApp within seconds, with the
   list on their dashboard and under `LEADS` in chat.
7. **Sales.** Upload a CSV of takings on the dashboard and Weave reports revenue, profit, the best seller
   and roughly what next week looks like — in chat (`SALES`) and on the dashboard. The file itself is never
   stored, only the rows read from it, and the AI is shown the totals rather than anybody's records.
8. **Hosting.** The `*.askweave.xyz` record points at the same tunnel as the app; the server tells sites apart by
   the Host header and serves them from `server/data/hosted-users/<username>/<slug>/` inside a CSP sandbox, so a
   site can't read Weave cookies or call its APIs.

## Where the data lives

Everything is in `server/data/` (git-ignored) on the machine running the server:

| Path | Contents |
|---|---|
| `sms.sqlite3` | Users (phone numbers), accounts, sessions, projects, messages, build jobs, download links, reports |
| `builds/<id>/` | Android build folders and APKs |
| `sites/<id>/` | Every website version |
| `hosted-users/<username>/<slug>/` | Live websites |
| `hosted-trash/` | Deleted sites (30 days) |
| `sms.sqlite3` → `site_views`, `site_daily` | Visits to hosted sites (no IP, no user agent, no cookies) |
| `backups/` | Hourly database backups |

The waitlist is the only data elsewhere (Supabase).

## Running it

```bash
cd server
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # fill in the keys (see the table above)
.venv/bin/python -m weave doctor
scripts/run_prod.sh           # server + Cloudflare tunnel (one-time tunnel setup is in the script)
```

Android builds need JDK 17 and Android SDK 35; websites need Node 20+ (no `npm install` for the engine).
Marketing site: `cd site && npm install && npm run build` (exports to `site/out`, deployed by Netlify).
Phone app: `server/scripts/build_phone_app.sh`.

Tests (everything external is faked; nothing leaves the machine):

```bash
cd server && .venv/bin/python -m pytest -q
```

## What changed (October 2026)

**Accounts**
- Sign-in and sign-up are **Google only** ("Continue with Google"); email/password login was removed. Google is
  asked for name and email only, nothing is stored for later.
- **Google Stitch removed** completely (code, routes, dashboard card, stored tokens).

**AI**
- **One model for everything, no fallback.** `WEAVE_AI_PROVIDER` picks Groq (default), Gemini or GLM; there is no
  backup model, no racing between models and no model-health tracking. A busy model is retried in short steps.
- **Groq** added (`openai/gpt-oss-120b`): chat replies in about 1 second instead of 3-40 s on free GLM; a website
  builds in 25-50 s instead of about 4 minutes.
- **Smarter chat:** every non-command message goes to the AI with full project context; scripted shortcuts,
  numbered menus and rule-based guesses were removed. New **rename** action. Link requests always return the
  current link from the database.
- **Adaptive style:** replies mirror the person's language mix, script and tone (Gen Z, Hinglish, Tenglish,
  formal, Devanagari...).
- Fixed: the Gemini client was closed by garbage collection, so Gemini calls always failed.

**Websites and hosting**
- **Renaming moves the live site** (`/old-name/` to `/new-name/`), from chat or the dashboard.
- Embedded iframes/objects are stripped instead of failing the whole site.
- Fixed: a relative `WEAVE_WEBSITE_ENGINE_DIR` broke every website build; paths now resolve from `server/`.

**Infrastructure**
- Production runs on our own Cloudflare account with a named tunnel (`scripts/run_prod.sh`), not a temporary URL.
- Twilio's number, WhatsApp sender and Messaging Service all point at `app.askweave.xyz`.

**Cleanup**
- The Python package and every setting were renamed from Genesis to **Weave** (`weave`, `WEAVE_*`).
- `website-engine/` trimmed from ~180 files to the 4 the server loads; the borrowed Gemini CLI OAuth client was
  removed from it.
- Removed the Antigravity backend, stale docs and scripts; READMEs and `.env.example` rewritten.

## Limits to know

- **Free AI limits:** Groq's free tier allows 1,000 requests/day and 8,000 tokens/minute per model (about 2-3 chat
  messages a minute before it makes Weave wait). A paid tier or a second model for chat raises this.
- **One machine:** the server, the database and every user site live on the machine running `run_prod.sh`. If it
  is off, the bot and all user sites are down. Back up `server/data/` somewhere else.
- **Builds run as local processes,** not containers; isolate them before running untrusted builds at scale.
- APKs are debug-signed for sideloading, not the Play Store.

More detail: [`server/README.md`](server/README.md), [`server/docs/SMS.md`](server/docs/SMS.md),
[`server/docs/WEBSITES.md`](server/docs/WEBSITES.md), [`server/docs/ANALYTICS.md`](server/docs/ANALYTICS.md).
