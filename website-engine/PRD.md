# Product Requirements Document (PRD)
## Project: Weave — WhatsApp Agent Bridge for Google Antigravity & Gemini
**Target Artifact:** Marketing Website & Product Landing Page  
**Author:** Weave Team  
**Version:** 2.3  
**Status:** Ready for Stitch UI & Landing Page Generation  

---

## 1. Executive Summary & Vision

### 1.1 Overview
**Weave** is a local-first, privacy-focused desktop application and CLI bridge that connects WhatsApp directly to Google Antigravity (`agy`) and Google Gemini AI coding agents. 

Developers and engineering teams can prompt, review code, debug builds, inspect headless visual screenshots, manage Git repositories, and trigger automated workflows from anywhere in the world using WhatsApp group chats or direct messages—with zero cloud middleman.

### 1.2 Core Problem
- Developers are tied to their workstations to prompt and monitor AI coding agents.
- Web-based AI chat interfaces require switching away from communication hubs and lack direct access to local filesystems, dev servers, and headless test runners.
- Existing remote coding bridges either require invasive cloud relays that expose source code or rely on clunky, complex terminal slash commands that non-technical teammates cannot use.

### 1.3 The Weave Solution
- **Local-First Relay**: Runs natively on the user's host machine via Electron and Node.js with the WhatsApp Baileys protocol. No intermediary SaaS server touches your code.
- **Natural Language Interaction**: Speak to the bot like a colleague (`@weave show me what the landing page looks like on mobile`) without needing slash commands.
- **Project-Scoped Security**: Strict directory isolation and per-project permission lists prevent unauthorized access across groups.
- **Dual-Engine Flexibility**: Runs with local Google Antigravity (`agy`) CLI or directly via Google Gemini API (with zero-secret PKCE Google OAuth).

---

## 2. Target Audience & Personas

| Persona | Role | Primary Goal & Pain Point | How Weave Solves It |
| :--- | :--- | :--- | :--- |
| **The Solo Founder / Indie Hacker** | Solo Dev & Builder | Needs to tweak landing pages, inspect mobile designs, and run builds while away from desk. | Can send voice notes or quick chats from phone to trigger agent edits, take mobile screenshots, and push to GitHub. |
| **The Lead Engineer & Dev Team** | Team of 3–10 engineers | Wants a shared WhatsApp group where team members can trigger QA tests and code tweaks without sharing credentials. | Per-project access control, owner-only gating, and group binding ensure only authorized members interact with designated repos. |
| **The Product Manager / QA** | Non-coding PM / Tester | Needs to test UI features and check build progress without setting up local dev environments. | Natural language prompts trigger visual QA screenshots (`@weave show me mobile landing page`) and status reports directly in WhatsApp. |

---

## 3. Product Architecture & Key Features

### 3.1 WhatsApp Natural Language Interface
- **Pure NLP Intent Engine**: Powered by Gemini 2.5 Flash for instant zero-latency intent classification.
- **No Slash Commands Required**: Understands natural phrasing, developer slang, typos, and fuzzy names.
- **Voice Note Transcription**: Ingests audio messages and voice notes, transcribing them instantly with Groq Whisper or local STT before executing agent tasks.

### 3.2 Visual QA & Headless Screen Capture
- **On-Demand Snapshots**: Captures live running localhost or remote URLs via headless Firefox/Puppeteer.
- **Responsive Viewport Testing**: Automatically captures standard desktop or mobile viewports (`/screenshot mobile` or `@weave show me what the navbar looks like on iPhone`).
- **Direct WhatsApp Delivery**: Sends high-res PNG previews directly into the chat thread with context-aware captions.

### 3.3 Security & Project-Scoped Permissions (v2.3)
- **Per-Project Isolation**: Access permissions are bound to specific project directories. Access to Project A never grants access to Project B.
- **Owner-Exclusive Admin**: Only the verified owner can create projects, switch project directories, or grant permissions.
- **Immutable Chat Permissions**: Permissions are managed exclusively in the desktop app UI to prevent social engineering in group chats.
- **Strict Unauthorized Gating**: Unauthorized senders are blocked before any model processing occurs.

### 3.4 Dual-Engine AI Backend
1. **Google Antigravity (`agy`) CLI**: Spawns warm local CLI workers, manages persistent terminal sessions, and handles two-stage SIGTERM/SIGKILL task cancellation.
2. **Direct Gemini REST API**: Connects via OAuth 2.0 PKCE or API Key (`GEMINI_API_KEY`) for headless environments without the local CLI.

### 3.5 Native Desktop Electron Companion
- **System Tray & Menu Bar Widget**: One-click pairing, connection health status, and active agent activity monitoring.
- **Project Dashboard**: Visual cards for active projects, directory pickers, and live collaborator badge management.
- **Seamless Pairing**: Terminal QR code or 8-digit phone pairing code for instant WhatsApp Web linking.
- **Built-in Over-The-Air (OTA) Updates**: Standalone builds receive automated updates seamlessly.

### 3.6 Concierge & MCP Tool Integrations
- **Google Calendar & Email Sync**: Natural language scheduling, automated `.ics` meeting invites, and Gmail drafting.
- **Swiggy & Instamart MCP Integration**: Order food and groceries via chat, apply discount coupons, and 1-tap checkout via deep links.
- **GitHub Automation**: Automatic branch commits, pushes, and collaborator invitations directly from chat.

---

## 4. Website Requirements & Sitemap

The website generated by Stitch should be a **world-class, high-conversion developer marketing landing page** (modern dark aesthetic, comparable to Linear, Vercel, Supabase, and Cursor).

### 4.1 Page Structure (Single-Page Experience with Sub-Modals)

```
[ Navigation Bar ]
       │
[ Hero Section ] ─── [ Interactive WhatsApp & Terminal Simulator ]
       │
[ Social Proof & Stats ]
       │
[ Core Feature Bento Grid ] (6 Pillars)
       │
[ Visual QA & Headless Browser Demo ]
       │
[ Desktop App & Security Architecture ]
       │
[ Natural Language vs Slash Command Comparison ]
       │
[ Installation & Quick Start ] (CLI & Desktop App)
       │
[ FAQ Section ]
       │
[ Footer & Open Source GitHub Links ]
```

---

## 5. Detailed Section Breakdown for Stitch Generator

### Section 1: Glassmorphism Floating Navbar
- **Brand**: Weave logo icon (interlocking woven emerald & blue threads) + `Weave` wordmark + `v2.3` pill badge.
- **Nav Links**: Features, Architecture, Desktop App, Docs, GitHub.
- **Actions**: 
  - `Star on GitHub` (secondary button with GitHub star count badge).
  - `Download Desktop App` (primary glowing emerald CTA button).

### Section 2: Hero Section (High Impact)
- **Tagline Badge**: `✨ Introducing Weave 2.3 — Local-first WhatsApp Agent Bridge`
- **Main Headline**: **"Your Gemini Coding Agent, Right in Your WhatsApp."**
- **Subheadline**: *"Prompt, debug, inspect mobile screenshots, review pull requests, and deploy code—straight from WhatsApp group chats or voice notes. Zero cloud middleman."*
- **Call-to-Action Group**:
  - `Download for macOS / Linux / Windows` (Dynamic OS download detector).
  - `npm install -g weave-agent` (One-click copyable terminal command).
- **Hero Visual: Interactive Split Simulator**:
  - **Left (Mobile Screen)**: WhatsApp chat interface with `@weave` showing:
    - User voice note: *"Hey, add a dark mode toggle to the navbar and show me a mobile screenshot."*
    - Weave bot response: Progress indicator `⚡ Updating components/Navbar.tsx...`
    - High-res mobile preview snapshot attached in chat.
  - **Right (Desktop Terminal / Electron View)**:
    - Live terminal log streaming Antigravity compiler outputs and Baileys socket handshake.

### Section 3: Value Propositions / Bento Grid (6 Key Pillars)
1. **💬 WhatsApp Native Coding**: Natural language prompt-and-run for full repositories. Voice note transcription via Groq Whisper.
2. **🔒 Project-Scoped Sandboxing**: Complete file isolation. Teams can only touch their bound repository. No directory traversal.
3. **📸 Visual Headless QA**: Automated screenshots in desktop and mobile viewports with `@weave show me mobile preview`.
4. **⚡ Dual AI Engine**: Google Antigravity CLI or Direct Gemini 3.8/2.5 Flash API with PKCE Google OAuth.
5. **🖥️ Native Desktop Companion**: Clean Electron app for macOS, Windows, and Linux. Visual project switcher and collaborator manager.
6. **🍛 Daily Concierge & MCP**: Integrated Swiggy food ordering, Instamart grocery cart building, and Google Calendar meeting invites.

### Section 4: Visual QA & Screen Inspection Showcase
- Highlight Weave’s unique ability to serve as a mobile testing companion.
- Visual mockup showing a side-by-side comparison of an agent modifying Tailwind code and immediately replying to WhatsApp with a 375px mobile viewport screenshot.

### Section 5: Security & Privacy Architecture Diagram
- Visual representation of the data flow:
  `[Phone (WhatsApp)] ──(E2EE Baileys)──> [Local Machine (Weave Desktop)] ──(Local Child Process)──> [Google Antigravity / Gemini]`
- **Privacy Bullet Points**:
  - No third-party relay servers.
  - Credentials stored locally in `.credentials.json` with PKCE OAuth.
  - Baileys WhatsApp encryption keys never leave the host device.

### Section 6: Natural Language Showcase ("No Commands Needed")
- Interactive tabs demonstrating the NLP engine:
  - *"Switch this chat to portfolio-website"*
  - *"Show me what the landing page looks like on mobile"*
  - *"Add dark mode toggle with persistent localStorage"*
  - *"Push these changes to GitHub with message 'fixed navbar'"*
  - *"Who has permissions for this project?"*

### Section 7: Quick Start & Installation
- Two parallel pathways:
  1. **Desktop App**: Direct download buttons for `.dmg` (Apple Silicon & Intel), `.AppImage` / `.deb` (Linux), and `.exe` (Windows).
  2. **CLI & Global npm**:
     ```bash
     npm install -g weave-agent
     weave auth       # Google PKCE OAuth login
     weave desktop    # Launch desktop UI & pair WhatsApp
     ```

### Section 8: FAQ & Footer
- **FAQ items**:
  - Do I need an Antigravity invite to use Weave? (No, Gemini API key works out of the box).
  - Can group members access my entire computer? (No, directory binding strictly isolates access).
  - Is my code sent to WhatsApp or Meta servers? (Only user prompts and bot responses are transmitted over WhatsApp; repository files stay strictly on your local disk).
- **Footer**: MIT License, GitHub repo, Documentation, Discord/Community link, Google Gemini ecosystem badge.

---

## 6. Design System & Visual Specification for Stitch

| Token | Specification |
| :--- | :--- |
| **Theme** | Pure dark mode with engineered hairline borders and subtle mesh glows |
| **Canvas Background** | `#000000` (Pitch black) |
| **Surface Level 1** | `#09090b` (Deep Zinc) |
| **Surface Level 2 / Card** | `#0c0d10` with `rgba(255, 255, 255, 0.08)` hairline border |
| **Card Hover State** | Border becomes `rgba(255, 255, 255, 0.22)` with subtle inner sheen |
| **Primary Accent** | Emerald Green `#10B981` / `#25D366` (WhatsApp brand alignment) |
| **Secondary Accent** | Gemini Blue `#4E80EE` / `#7B61FF` (Google AI gradient) |
| **Text Primary** | `#FFFFFF` |
| **Text Muted** | `#A1A1AA` (Zinc-400) |
| **Text Dim** | `#71717A` (Zinc-500) |
| **Typography (Headings)** | `Geist`, `-apple-system`, `sans-serif` (tight tracking `-0.03em`) |
| **Typography (Code/Data)** | `Geist Mono`, `JetBrains Mono`, `monospace` |
| **Accents / Editorial** | `Instrument Serif` (italic accents for luxury tech vibe) |
| **UI Components** | Bento grids, floating glassmorphic navbars, live terminal cursor carets, pill status badges |

---

## 7. Prompts for Stitch Agent UI Generation

When feeding this PRD into Google Stitch MCP or web synthesis agents, use the following prompts:

### Stitch Screen 1: Hero Section & Interactive WhatsApp Simulator
> *"Design a modern developer landing page hero section for 'Weave', an open-source WhatsApp agent bridge for Google Antigravity & Gemini. Features pitch-black canvas (#000000), hairline glassmorphism navbar, bold typographic headline 'Your Gemini Coding Agent, Right in Your WhatsApp', glowing emerald CTA buttons, and an interactive split visual showing a WhatsApp mobile chat simulator on the left and a live glowing CLI terminal on the right."*

### Stitch Screen 2: Bento Grid Feature Showcase
> *"Create a 6-item bento grid feature section for Weave.ai. Dark zinc cards (#0c0d10) with subtle 1px border. Items include: 1. WhatsApp Natural Language & Voice Notes, 2. Project-Scoped Sandboxing & Permission Guard, 3. Headless Mobile Visual QA Screenshots, 4. Dual-Engine Antigravity CLI & Gemini API, 5. Native Electron Desktop Manager, 6. Swiggy Food & Concierge MCP. Include micro-illustrations, code snippets, and glowing emerald accents."*

### Stitch Screen 3: Desktop App Showcase & Security Architecture
> *"Design a product showcase section illustrating the Weave Electron Desktop Companion. Display a high-res mockup of the desktop window showing active project cards, phone permission badges (+91...), connection QR code pairing status, and a sleek data flow diagram illustrating local-first security without cloud middleman."*
