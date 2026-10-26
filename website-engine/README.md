# Weave — WhatsApp Agent Bridge for Google Antigravity & Gemini

Bridge your local **Google Antigravity (`agy`) Gemini Coding Agent** directly with WhatsApp. Prompt, review, debug, build websites, inspect screenshots, and schedule meetings from anywhere using WhatsApp group chats or direct messages.

Now also features direct **Google OAuth 2.0 PKCE** and **Direct Gemini API integration** — run tasks with or without the local CLI!

---

## ✨ Features

- 💬 **WhatsApp Natural Language Coding**: Chat with your Gemini agent using text or voice notes.
- 🔑 **Google OAuth 2.0 (PKCE)**: Connect your Google account directly with zero server-side secrets (`npm run auth`) for seamless Calendar, Gmail, and Gemini API access.
- ⚡ **Direct Gemini API Client**: Use Gemini models directly with an API key (`GEMINI_API_KEY`) or OAuth tokens without needing the `agy` CLI installed.
- 🔒 **Project Isolation & Group Binding**: Lock specific WhatsApp groups to dedicated project folders (`/bind <project>`) so team members cannot access other directories.
- 🎙️ **Voice Note Transcription**: Send WhatsApp audio or voice messages — automatically transcribed via Whisper/Groq or local engine.
- 📸 **Visual QA & Screenshots**: Take automated web snapshots with `@weave /screenshot` or phone-sized viewports (`/screenshot mobile`).
- 📎 **Direct File Transfers**: Send local files, downloads, or build artifacts straight to WhatsApp or contacts.
- 📅 **Google Calendar & Email Sync**: Schedule meetings with natural language via OAuth or RFC 5545 `.ics` invitations and draft emails.
- 🍛 **Swiggy Food & Instamart MCP Integration**: Order food from top restaurants or instant groceries from Instamart directly via WhatsApp, review carts with discount coupons, and 1-tap checkout via Swiggy app deep links.
- 🤝 **GitHub Integration**: Manage collaborators and auto-push commits directly via chat commands.

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js** v18.0.0 or higher
- One of the following AI backends:
  - **Google Antigravity (`agy`) CLI** installed and signed in on your system, **OR**
  - **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey), **OR**
  - **Google OAuth Client ID** (for direct Google login)
- (Optional) **Firefox** installed for headless visual QA screenshots
- (Optional) **Groq API Key** for ultra-fast Whisper speech-to-text transcription

### 2. Download & Install

Install globally via npm:

```bash
npm install -g weave-agent
```

Or clone the repository for development:

```bash
git clone https://github.com/darthnihilus01/weave.git
cd weave
npm install
```

### 3. Connect Google Account (Optional)

If using Google OAuth for direct Gemini API, Calendar, and Gmail:

```bash
npm run auth
```

Open the printed URL in your browser, approve permissions, and Weave will securely save your local tokens in `.credentials.json`.

### 4. Launch Desktop App

Run the standalone Electron desktop window:

```bash
npm run desktop
```

To package a standalone executable installer (`.AppImage`, `.deb`, `.dmg`, `.exe`):

```bash
npm run dist
```

*(Alternatively, to run only the background headless CLI bridge without the UI, run `npm start`.)*

On first run, the bridge automatically initializes `.env` from `.env.example`.

A QR code will display directly in your terminal:
1. Open **WhatsApp** on your phone.
2. Tap **Settings** (or three dots) → **Linked Devices** → **Link a Device**.
3. Scan the terminal QR code.

*(Prefer an 8-digit code instead of scanning a QR? Set `PAIRING_PHONE_NUMBER=1234567890` in `.env` and run `npm start`.)*

---

## ⚙️ Configuration (`.env`)

Edit `.env` to configure your environment:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BOT_TRIGGER` | `@weave` | Prefix keyword to trigger the bot in chats |
| `DEFAULT_PROJECT_DIR` | `./demo-site` | Fallback directory for tasks when no project is specified |
| `AGY_BIN` | `agy` | Path to the Antigravity CLI binary |
| `AGY_MODEL` | *(empty)* | Optional model override for Antigravity (e.g. `gemini-3.8-flash-high`) |
| `GEMINI_API_KEY` | *(empty)* | Optional Gemini API key for direct REST API mode |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model for direct Gemini API client |
| `GOOGLE_CLIENT_ID` | *(empty)* | Google Cloud OAuth Client ID for PKCE sign-in |
| `GOOGLE_CLIENT_SECRET` | *(empty)* | Optional OAuth Client Secret (not required for public PKCE clients) |
| `GOOGLE_REDIRECT_PORT` | `8085` | Local loopback port for OAuth redirect callback |
| `ALLOWED_SENDERS` | `*` | Comma-separated phone numbers allowed to trigger tasks (`*` = anyone) |
| `ADMIN_NUMBERS` | *(empty)* | Phone numbers granted owner permissions across devices |
| `ALLOW_FROM_ME` | `true` | Allows triggering the bot from your own linked WhatsApp account |
| `TASK_TIMEOUT_MS` | `600000` | Task execution timeout in milliseconds (default: 10 mins) |
| `PAIRING_PHONE_NUMBER` | *(empty)* | Phone number for pairing code authentication instead of QR |
| `GROQ_API_KEY` | *(empty)* | Optional API key for instant Whisper voice note transcription |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP host for calendar invites and email drafts |
| `SMTP_PORT` | `465` | SMTP port (SSL) |
| `SMTP_USER` | *(empty)* | SMTP login username |
| `SMTP_PASS` | *(empty)* | SMTP app password |
| `OWNER_EMAIL` | *(empty)* | Registered owner email address for calendar invites & drafts |

---

## 🗣️ Natural Language Interface (No Slash Commands Needed!)

Weave features a full **Natural Language Processing (NLP)** engine. You do not need to memorize or type slash commands — just address `@weave` in plain English as if speaking to a teammate:

| Intent | How to Speak to Weave | What Happens |
| :--- | :--- | :--- |
| **Check Projects** | `@weave what projects do we have?` | Lists all discovered & registered projects |
| **Switch Project** | `@weave switch this chat to portfolio-website` | Switches active project folder for this chat |
| **Visual Preview** | `@weave show me what the landing page looks like on mobile` | Captures headless screenshot & sends image |
| **Task Status** | `@weave what are you working on right now?` | Checks status of active agent task & queue |
| **Stop / Abort** | `@weave stop what you're doing` | Immediately halts active running agent task |
| **Git Push** | `@weave push these changes to GitHub with message 'fixed navbar'` | Commits & pushes repo |
| **Collaborators** | `@weave invite @alex to collaborate on this repo` | Adds GitHub repository collaborator |
| **File Retrieval**| `@weave send me package.json` | Finds and sends file directly into WhatsApp |
| **Code & Build** | `@weave add dark mode toggle with persistent localStorage` | Antigravity AI modifies project code |
| **Follow-up** | `@weave make that button rounded and emerald green` | Seamless multi-turn session continuation |
| **Tech Q&A** | `@weave how does JWT refresh token rotation work?` | Instant conversational explanation |
| **Agent Control** | `@weave go to sleep` / `@weave wake up` | Mutes or awakens agent in group |

*(Legacy slash commands like `/status` or `/projects` remain supported for backward compatibility).*

---

## 💡 Example WhatsApp Prompts

- `@weave create a modern hero section with Tailwind CSS and an emerald CTA button`
- `@weave show me what the site looks like on mobile`
- `@weave switch to wisewallets`
- `@weave push our changes to github`
- **Voice Notes**: Send an audio message tagging `@weave` to prompt hands-free!

---

## 🔒 Security & Privacy

- **Session & Token Isolation**: Baileys session keys, OAuth tokens (`.credentials.json`), runtime databases, and `.env` are strictly excluded in `.gitignore` and never committed.
- **Group Sandbox**: Group members in bound groups are strictly isolated to their assigned folder and cannot traverse directories or run commands on other host paths.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
