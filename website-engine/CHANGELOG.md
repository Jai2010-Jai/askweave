# Changelog

All notable changes to the Weave project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v2.4.2] - 2026-10-18

### 🔒 Single-Instance Process Lock, Safe 401 Session Archiving & Rapid Self-Healing

#### 1. Electron Single-Instance Lock (`electron/main.js`)
- **Prevented Competing Socket Instances**:
  - Implemented `app.requestSingleInstanceLock()`.
  - When opening the desktop app while a background or tray process is still active, secondary instances immediately terminate with a warning instead of fighting for the same WhatsApp session over status `440 (connectionReplaced)`.

#### 2. Safe Session Archiving on 401 (`src/bot.js`)
- **Non-Destructive 401 Disconnects**:
  - Replaced immediate `fs.rmSync(AUTH_DIR)` upon 401 logout with timestamped folder archiving (`auth_info_baileys.backup-<timestamp>`), ensuring credentials and ratchet state are never permanently destroyed by transient server disconnects.

#### 3. Instant Decryption Self-Healing (`src/bot.js`)
- **Zero-Wait Healing**:
  - Lowered `healCorruptedSession` threshold from 2 consecutive failures down to 1 so desynced or corrupted Signal sessions/sender-keys are purged and regenerated immediately on first detection.

---

## [v2.4.1] - 2026-10-18

### 🛡️ WhatsApp LID Resolution, Multi-Device Owner Authorization & Deduplication Reliability

#### 1. WhatsApp LID (`@lid`) to Phone Number Resolution (`src/bot.js`)
- **Resolved Group Participant LIDs**:
  - In modern WhatsApp group chats, messages are delivered with LID identifiers (`@lid`) rather than standard phone numbers (`@s.whatsapp.net`).
  - Added `resolveSenderPhoneNumber(rawJid, pushName)` to automatically map `@lid` JIDs to verified phone numbers using `contacts.json` and credentials.
  - Updated `getSenderNumber(msg)` to return resolved phone numbers so group project access permissions accurately match configured contact numbers.

#### 2. Bulletproof Owner & Admin Authorization (`src/bot.js`)
- **Direct Auth State Matching**:
  - `isOwner(msg)` now cross-checks sender participant digits directly against both `sock.user.id` / `creds.me.id` (phone number) and `sock.user.lid` / `creds.me.lid` (LID).
  - Even when Baileys sets `msg.key.fromMe = false` for linked-device group sync or multi-device phone messages, the bot correctly recognizes the owner and immediately grants full administrative and project access.
- **Owner Priority in `isSenderAuthorized`**:
  - Owner messages bypass group project access gating, preventing the bot from incorrectly rejecting the owner with permission errors.

#### 3. Deduplication & Retry Safety (`src/bot.js`)
- **Deferred Processed Message ID Recording**:
  - Removed premature `recordProcessedMessageId()` call at the socket ingress gate before message validation and trigger routing.
  - Messages that are un-triggered or in-flight retries are no longer permanently discarded if an initial dispatch is interrupted.

---

## [v2.4.0] - 2026-10-18

### 🩹 WhatsApp Baileys Reconnection, Session Ratchet Preservation & Clock Skew Calibration

#### 1. Signal Session Ratchet Preservation (`src/bot.js`)
- **Eliminated Destructive Startup Session Purging**:
  - Removed arbitrary size-based (`> 15KB`) deletion of `session-*.json` files in `purgeClosedSessions()`.
  - Signal protocol ratchet chains naturally accumulate keys over time and active sessions; deleting active session files broke the Signal ratchet with linked devices and group members, causing WhatsApp to fail to decrypt incoming messages and forcing users to repeatedly unlink and re-link the device.

#### 2. Robust Clock Skew Calibration & Backlog Isolation (`src/bot.js`)
- **Backlog-Aware Skew Calibration**:
  - Previously, when coming online after being idle or offline for an hour, the first incoming backlog message (with a timestamp from 1 hour prior) distorted `serverTimeOffsetSec` to ~3600 seconds, permanently breaking message timestamp validation and causing real-time incoming messages to be dropped.
  - Skew calibration against incoming messages is now strictly restricted to near-realtime messages (`|rawDiff| < 300s`).
  - Network clock synchronization against `https://web.whatsapp.com` is verified against realistic tolerance boundaries.
  - `BOT_START_TIME_SEC` is refreshed on every bot start/restart to ensure reconnection cycles correctly identify fresh incoming messages.

#### 3. Graceful Socket Lifecycle & Pre-Key Management (`src/bot.js`)
- **Safe Pre-Key Server Sync**:
  - Replaced forced overwriting of pre-keys (`uploadPreKeys(30)`) on every connect with `uploadPreKeysToServerIfRequired()`, preventing sender pre-key mismatch for contacts that have cached previous keys.
- **Clean Socket Termination**:
  - Ensured prior Baileys socket instances are completely ended with `sock.end(undefined)` rather than leaving dangling WebSocket handles or event listener leaks.
- **Restored History Sync Flow**:
  - Removed rigid `shouldSyncHistoryMessage: () => false` override to allow Baileys to cleanly drain and flush incoming message queues upon reconnection without stalling the event loop.

---

## [v2.3.0] - 2026-10-18

### 🔐 Project-Scoped Permission Architecture, Desktop UI Manager & Unauthorized Access Gating

#### 1. Per-Project Permission Isolation (`src/config.js`)
- **Permissions Are Strictly Per-Project**:
  - Access is determined strictly by the active project of the chat. Each project maintains its own isolated list of allowed contacts (phone numbers in E.164 international format).
  - Being granted access to one project never confers permission to any other project.
  - By default, only the owner has access to any project.
  - Automatic migration cleans and normalizes legacy group-nested structures to per-project phone lists.
- **Phone Number Normalization**:
  - `normalizePhoneNumber` automatically normalizes phone numbers without country code using India (`+91`) as the default, formatting every saved number to standard international format (`+91XXXXXXXXXX`).

#### 2. Desktop App Permission Manager (`electron/renderer/app.js`, `electron/main.js`, `electron/preload.cjs`, `electron/preload.js`)
- **Dedicated Permission Manager Under Every Project Card**:
  - Added a dedicated permission manager directly under each project card in the Desktop UI.
  - Input field with default `+91` prefix allowing owners to type phone numbers without country codes and click `+ Add` or hit Enter.
  - Displays all authorized phone numbers for that project with dynamic removal buttons (`✕`).
  - Owner badge (`👑 Owner (Full Access)`) is prominently displayed as the default authorized user.

#### 3. View-Only Chat Permissions (`src/bot.js`, `src/autopilot/guidelines.js`)
- **List Allowed Contacts by Phone Number**:
  - Asking *"who has perms?"*, *"show permissions"*, or similar queries replies with the list of allowed contacts for the active project, shown by phone number.
- **Immutable Chat Permissions**:
  - Permissions can never be added, edited, or removed from WhatsApp chat. Any request to grant or revoke permissions in chat is met with: *"Permissions can only be managed from the desktop app."*

#### 4. Owner-Only Project Management (`src/bot.js`)
- **Strict Guard on Project Switching & Creation**:
  - Only the owner can switch a group's active project (`switch_project`, `/bind`, `/project`) or create new projects (`create_project`).
  - Any non-owner attempt is immediately rejected with: *"Only the owner can do that."*

#### 5. Instant Unauthorized User Gating (`src/bot.js`)
- **Strict Gating for Non-Allowed Senders**:
  - If someone who is not on the active project's permission list pings or mentions the agent, the bot replies: *"You don't have permission to use this project."*
  - The message is dropped immediately: no intent classification, routing, audio transcription, or model calls are executed.

#### 6. Clean Slate Master Directory & Permissions Reset (`src/config.js`, `projects.json`)
- **Complete Project & Permission Reset**:
  - Purged all previous test project folders (`anagha`, `ramu1`, `srinivas`) from the master directory (`Weave Master`).
  - Reset `projectAccess`, `groupBindings`, `projects`, and active project associations to an empty clean slate while preserving master directory configuration for a fresh start.

#### 7. Context-Aware Pre-Task Acknowledgement (`src/autopilot/guidelines.js`, `src/bot.js`)
- **Conversational Mirroring Before Task Execution**:
  - The Gemini router now generates an immediate, context-aware pre-task acknowledgment (`acknowledgementText`) mirroring user style (e.g. *"my bad bro, on it"*, *"bet, tweaking that rn"*, *"say less, on it"*).
  - Sent to chat immediately before Antigravity runs in the background.
  - Preserves the initial hourglass reaction (`⏳`) and final completion reaction (`✅`).

---

## [v2.2.0] - 2026-10-18

### 🧠 Pure Natural Language Architecture, DM Gating & Session Self-Healing

#### 1. Pure Natural Language Permission Management & Group Member Validation (`src/autopilot/`, `src/bot.js`, `src/config.js`)
- **Eliminated Brittle Regex Pattern Matching**:
  - Deprecated legacy regex parsing for access commands. All permission queries and access grants/revocations now flow through the Gemini 2.5 Flash Intent Router as first-class `system_command` lanes (`manage_access` and `view_access`).
  - Native understanding of natural conversational phrasing, possessives, and developer slang (e.g., *"give agent permissions to tinchu"*, *"allow tinchu to use agent"*, *"revoke tinchus perms lol"*, *"revoke access for tinchu"*, *"who has perms"*, *"list access perms"*).
  - Tolerant and friend-aware identifier resolution: automatically cleans slang suffixes (`babys`, `baby`, `lol`, `'s`), normalizes handles, and resolves against registered friends directory.
  - Cascade unbinding & cleanup: when an active project is deleted or unmounted, associated group bindings and permissions clean up automatically.
- **Strict Group Member Validation & Anti-Phantom Guard**:
  - Validates candidates against actual group metadata (`sock.groupMetadata`) before granting permissions, rejecting random or non-existent names instead of creating phantom permissions.
  - Returns a helpful candidate member list when a requested user is not found in the group or friends directory.
- **Participant Phone Number & Access Listing**:
  - In `handleViewAccessCommand` (`who has perms`), members are clearly rendered by their actual phone numbers (`+<country_code><number>`) and contact/push names alongside Granted Access or No Access badges.
- **Fuzzy Intent Matching with Typo Tolerance**:
  - Added Levenshtein distance matching and phone digit matching to gracefully handle slight typos and character changes when referring to group members.

#### 2. Private DM Trigger Gating & Full Auto Mode (`src/bot.js`)
- **Strict Prefix Requirement in Personal Send-to-Self DM**:
  - The personal Send-to-Self chat ("Message Yourself") now strictly requires tagging the agent (`@ap`) by default, preventing unwanted responses to personal notes and draft messages.
  - Added support for toggling Full Auto in personal DM (`@ap fullauto`), allowing hands-free interaction without tagging when explicitly desired.

#### 3. Real-Time Dynamic Dashboard Revocation (`electron/renderer/app.js`, `src/config.js`)
- **Interactive Collaborator Revocation Badges**:
  - Collaborators granted directly from WhatsApp are rendered as interactive badges in the Desktop UI even if they have not yet been added to the friends directory.
  - Clicking any collaborator pill dynamically revokes their access in real-time, instantly pushes updates through `api.onProjectsUpdate`, and re-renders the dashboard UI without requiring a reload.
  - Broadened `revokeProjectAccess` to sweep across project scopes if a project is unmounted or alias is omitted.

#### 4. WhatsApp Baileys Multi-Hour Session Self-Healing (`src/bot.js`)
- **Resilient Offline Session Ratchet Recovery**:
  - Automatic upload of 30 fresh one-time pre-keys (`sock.uploadPreKeys(30)`) on every bot connection, preventing `Bad MAC` and `Key used already or never filled` errors when waking up after hours offline.
  - `healCorruptedSession` automatically detects decryption failure stubs, purges desynced session files, and flushes in-memory Signal ratchet stores for linked devices.
  - Added time window server-drift calibration to prevent dropping backlogged messages due to system clock drift.

#### 5. Deep Process Tree Termination & Instant Stop (`src/agent.js`, `electron/main.js`)
- **Guaranteed Child Process Tree Teardown**:
  - Robust process cancellation (`stopActiveTask`) with two-stage SIGTERM -> SIGKILL escalation on Unix (`pkill -P`) and `taskkill /T /F` on Windows.
  - Immediate retirement and termination of warm Antigravity CLI workers to halt running subcommands or compilers instantly upon `/stop`.

#### 6. False Reply Prevention on Quoted Messages (`src/bot.js`, `src/autopilot/polls.js`)
- **Strict Origin-Verified Swipe-Reply Gate**:
  - Eliminated the faulty fallback in `isReplyingToBot` that treated any quoted message from the owner/linked device as an agent reply.
  - Quoted messages are now strictly verified against tracked message IDs sent by this agent instance (`sentMessageIds` and pending polls), preventing accidental transcriptions or task triggers when texting or replying to yourself in group chats.

#### 7. Visual Distinction for Agent Responses (`src/bot.js`)
- **Standardized `agent message` Code Block Footer**:
  - Every message sent by the agent (chat replies, progress alerts, permission summaries, attachment captions, and task notifications) leaves one empty line and appends `` `agent message` `` in code block formatting, making it instantly distinguishable from personal messages.

---

## [v2.1.0] - 2026-10-18

### 🛡️ Permissions Hardening, Poll Reliability & UX Polish

#### 1. Group Permissions & Access Control (`src/bot.js`, `electron/renderer/app.js`)
- **Strict Owner-Only Default in Groups**:
  - In group chats, non-owners are strictly blocked by default from executing laptop tasks and commands.
  - Granular access can be granted dynamically by the owner using natural language (`allow <name> from now`) or revoked (`revoke <name> access`).
  - Added permissions inquiry handler (`who has perms?`, `who has permissions?`, `perms`) returning the active project permissions and authorized collaborators.
  - Enhanced Desktop UI to render `👑 Owner (Full Access)` badge and interactive collaborator permission toggles for every bound WhatsApp group.

#### 2. Risky Project Deletion Guard (`src/bot.js`)
- **Personal DM Send-to-Self Isolation**:
  - Project deletions can strictly only be performed by the verified owner in their personal WhatsApp Send-to-Self chat ("Message Yourself").
  - Any deletion attempt in a group is blocked with an advisory prompt pointing the user to their personal chat.
  - Deletions in Send-to-Self require explicit two-step confirmation (`yes` to delete or `cancel` to abort).

#### 3. Poll Reliability & Fallbacks (`src/autopilot/polls.js`, `src/bot.js`, `src/autopilot/router.js`)
- **Null Safety in Vote Resolution**:
  - Fixed `Cannot read properties of null (reading 'message')` when resolving poll votes by wrapping unwrappers in null guards and pushing synthesized message objects to the task queue.
  - Resolved `getPendingPoll is not defined` import error.
  - Refined poll triggering guidelines to only dispatch polls when a genuine choice between 2+ options is needed and cannot be inferred.
  - In router, automatically infer and activate projects if only one candidate project exists or if the project name is explicitly mentioned in the user's prompt.

#### 4. Event Bus & Duplicate Message Protection (`src/bot.js`, `electron/renderer/`)
- **In-Flight Message Deduplication**:
  - Implemented `inFlightMessageIds` lock set and immediate top-level message ID tracking to eliminate race conditions between concurrent Baileys `notify` and `append` upsert events.
  - Made the Live WhatsApp Event Bus terminal selectable and copyable with a dedicated `copy stream` button.
  - Polished desktop layout with smooth scrolling and left-side scrollbar placement.

#### 5. Dynamic Callsign & Admin Triggers (`src/bot.js`)
- **Flexible Dynamic Callsign Support**:
  - Supported `@<callsign> init` / `@<callsign> initialize` and `@agent init` / `@agent initialize`.
  - Added `@<callsign> deinit` / `@<callsign> deinitialize` and `@agent deinit` / `@agent deinitialize` allowing users to return any group back to the silent gate anytime.

---

## [v2.0.0] - 2026-10-18

### ⚡ Fresh Architectural Rebuild & Native Autonomous Operation

#### 1. Native Autonomous Operation & Autopilot Mode Deprecation
- **Removal of Autopilot Mode Toggle**:
  - Deprecated the legacy manual vs. autopilot mode toggle (`@agent autopilot`, `/fullauto`). Weave is now **natively autonomous by design**.
  - Eliminated confusing mode flags; all incoming messages across initialized WhatsApp groups flow directly into the autonomous execution pipeline without requiring manual arming.

#### 2. Clean Slate State Reset (`src/config.js`)
- **Total State Reset (`resetAllState`)**:
  - Reset stale legacy project lists, lingering conversation IDs, cached message buffers (`.processed-msgs.json`, `.sent-msgs.json`), and orphaned bindings.
  - Preserved the configured `masterDir` path (e.g., `~/Documents/Weave Master`) while cleanly resetting all project folders and group bindings.
  - Streamlined data model in `projects.json` to: `masterDir`, `activeProject`, `projects`, `initializedGroups`, `groupBindings`, `pendingPolls`, `conversations`, and `friends`.

#### 3. Deterministic 4-Lane Gemini 2.5 Flash Router (`src/autopilot/router.js`, `src/autopilot/guidelines.js`)
- **Deterministic Low-Temperature Intent Classification**:
  - Replaced ad-hoc keyword heuristics with a single-pass Gemini 2.5 Flash intent classifier operating at low temperature (`temperature: 0.1`) with structured `application/json` schema output (`responseSchema`).
  - Routes incoming messages strictly into one of four deterministic execution lanes:
    1. `laptop_task`: Coding, building, editing, testing, running commands, and deployments dispatched to the Antigravity CLI worker inside the group's active project folder.
    2. `system_command`: Standard workspace operations (`list_projects`, `create_project`, `switch_project`, `current_project`, `unbind_project`) resolved instantly with fixed casual templates.
    3. `chat`: Direct conversational answers generated using the Gen-Z adaptive personality engine without touching disk or launching background processes.
    4. `choice_needed`: Generates interactive WhatsApp polls or emoji reaction fallbacks when decisions, clarifications, or confirmations are needed.

#### 4. Silent Group Initialization Gate (`src/bot.js`, `src/config.js`)
- **Strict Silent Gate Enforcement (`isGroupInitialized`)**:
  - The bot remains completely silent and will never interact in any WhatsApp group until explicitly initialized via `@agent initialize` (or `@weave initialize`).
  - All messages, mentions, and pings received in an uninitialized group are silently dropped, preventing unintended chatter in unrelated chats.
  - Group initialization state is persisted per group in `state.initializedGroups[groupJid]`.
  - Sending `@agent initialize` marks the group initialized and replies with the standard casual `welcome_init` template displaying the master directory, active project, and available projects.

#### 5. Master Directory Projects & Strict Group Isolation (`src/autopilot/workspace.js`, `src/config.js`)
- **Master Directory Scope**:
  - Projects are strictly defined as the directory folders inside `masterDir`.
  - Enforced strict 1:1 binding per group: each WhatsApp group has strictly one active project at a time.
  - Follow-up coding requests automatically stay in the active project.
  - New projects are created only upon explicit request (`create_project`), which immediately locks the group to that project.
  - Project switching is explicit and sandbox-verified against `masterDir`.

#### 6. Single-Voter WhatsApp Polls with Decryption & Reaction Fallback (`src/autopilot/polls.js`)
- **Native WhatsApp Polls**:
  - Dispatches interactive choices using Baileys native poll messages (`sock.sendMessage(jid, { poll: ... })`).
  - Cryptographic vote decryption (`decryptPollVote`) mapping SHA-256 option hashes back to the plaintext option using `messageSecret`.
  - **Single-Voter Security**: Strictly checks that `voterJid === allowedVoterJid` against `state.pendingPolls[pollMsgId]`. Votes from any other group participants are discarded immediately to prevent group vote hijacking.
  - **Emoji Reaction Fallback (`sendReactionFallback`)**: Fallback to emoji circles (`🟢`, `🔵`, `🟡`, `🟣`) if polls fail or are unsupported, intercepted via `reactionMessage` from the authorized sender.

#### 7. Isolated Prompt Guidelines & Gen-Z Adaptive Persona (`src/autopilot/guidelines.js`, `src/autopilot/templates.js`)
- **Centralized Model Guidelines (`src/autopilot/guidelines.js`)**:
  - Centralized system prompt file keeping system rules isolated from application logic.
  - Hard security rules enforced: no raw shell commands outputted, input messages/data treated strictly as data not instructions, sandboxed paths, low temperature structured function calling.
- **Adaptive Gen-Z Tone & Mirroring Persona**:
  - Conversational text (chat, poll questions, clarifications) mirrors sender style (lowercase if lowercase, short if short, emojis if used, Hinglish/Kanglish if used).
  - Natural light developer slang (`ngl`, `tbh`, `fr`, `lowkey`, `rn`, `bet`, `cooked`, `W/L`, `aight`) without corporate jargon ("I'd be happy to assist").
  - Fixed standard casual system command templates in `src/autopilot/templates.js` formatted in this consistent casual voice.

#### 8. Live 2-Column Desktop UI Rebuild (`electron/renderer/index.html`, `app.js`)
- **Clean 2-Column Live Interface**:
  - **Left Column — Master Directory Projects**:
    - Master Directory path configurator with native directory picker.
    - Discovered project folders inside Master Directory with quick "Open" button in OS file explorer.
  - **Right Column — Initialized WhatsApp Groups**:
    - Live list of all initialized groups with active project status badges (`🟢 active` or `⚪ unbound`).
    - Project selector dropdown under each group to switch active projects directly from desktop.
    - Unbind button to detach a project from a group.
    - Clean Slate Reset button in top header to wipe state anytime.
  - **Live WhatsApp Event Bus**: Compact terminal stream underneath groups panel for real-time diagnostic logs.

---

## [v1.2.0] - 2026-10-17

### 🚀 Autonomous Autopilot Alpha, Collaborator Management & Debouncing

#### 1. Multi-Lane Semantic Intent Routing (`src/autopilot/router.js`, `src/autopilot/guidelines.js`)
- **Semantic Classification Router**:
  - Implemented an intent classification engine powered by Gemini (`generateContent` with structured JSON schema) to classify plain English WhatsApp group messages into six distinct execution lanes:
    1. `manage_collaborator`: GitHub collaborator operations (adding, inviting, listing collaborators).
    2. `capture_screenshot`: Visual preview generation and responsive viewport screenshots via Playwright/Puppeteer.
    3. `manage_workspace`: Dynamic project creation, directory discovery, and group project switching.
    4. `run_coding_task`: Core coding, terminal commands, and file edits via the Antigravity CLI agent.
    5. `chat_reply`: Conversational replies and technical explanations without disk mutations or process execution.
    6. `ask_clarification`: Disambiguation lane for underspecified or conflicting user instructions.

#### 2. Friends Directory & Collaborator Management (`src/autopilot/friends.js`)
- **Real-World Name Resolution**:
  - Integrated a local directory mapping real-world names (e.g. "Jai") to GitHub usernames (e.g. "jai-dev").
  - Automated collaborator invite resolution with explicit WhatsApp group confirmations (`/confirm` or natural language affirmative replies).
  - Added interactive Friends & Collaborators management panel in the Electron desktop UI.

#### 3. Message Debouncing & Batching (`src/autopilot/debouncer.js`)
- **Full-Auto Message Debouncer**:
  - Added `FullAutoDebouncer` to coalesce rapid bursts of group messages into a single prompt batch (3.5s window), preventing race conditions and duplicated agent worker processes.

#### 4. Ambiguity Clarification State Machine (`src/autopilot/clarification.js`)
- **Clarification Workflow**:
  - Added pending clarification session handling with numbered options and TTL expiration (5 minutes).
  - Users could respond with simple numbers or short messages to select the desired execution lane.

#### 5. Responsive Website Screenshots
- **Headless Visual Previews**:
  - Integrated Playwright/Puppeteer automation for capturing responsive viewport screenshots of local servers and web applications, sent directly back to WhatsApp chat.

---

## [v1.1.0] - 2026-10-17

### 🛡️ Process Isolation, Sandboxing & UX Fixes

#### 1. Subprocess Isolation & Graceful Tree Termination (`src/agent.js`)
- **Process Group Termination (`terminateProcessTree`)**:
  - Replaced naive `child.kill('SIGTERM')` with deep process tree discovery (`getAllDescendantPids` / `pgrep -P` / `pkill -P`).
  - Implemented a two-stage signal escalation pattern: initial `SIGTERM` with grace period, followed by an aggressive `SIGKILL` escalation to eliminate orphaned Node/CLI processes.

#### 2. Warm Antigravity CLI Worker Pool & Instant Cancellation
- **Persistent Warm Worker Pool**:
  - Added persistent stream-json `WarmWorker` pool with system clock synchronization for reduced startup latency.
  - Extended `stopActiveTask()` to purge warm worker queues, resolve waiters with cancellation errors, and immediately free system memory upon user cancellation.

#### 3. Master Directory Path Sandboxing (`src/autopilot/workspace.js`, `src/config.js`)
- **Path Traversal Defense**:
  - Added strict path validation (`isPathWithinMasterDir`) to prevent path traversal attacks or accidental operations outside authorized project workspaces.

#### 4. Desktop Flexbox Scroll & UX Fixes (`electron/renderer/`)
- **Independent Scrolling & Overflow Resolution**:
  - Added independent scrolling to the Left Pane (`#left-pane`) with `overflow-y-auto max-h-[calc(100vh-210px)] pr-1.5`.
  - Resolved flexbox column overflow clipping bug by setting `min-h-0` on `#view-workspace` and `<main>` so the desktop view scrolls properly with mousewheel.
  - Customized scrollbar styling (`styles.css`) with 6px high-contrast thumb for smooth interaction.
  - Removed confusing "Set Active" project buttons from the workspace card.

#### 5. Over-The-Air (OTA) & Session Fixes (`src/ota.js`, `src/bot.js`)
- **Disable OTA via Environment Variable**:
  - Added `DISABLE_OTA=true` environment variable support to disable automatic OTA updates and prevent overwriting local fork modifications.
- **Session Continuity**:
  - Added project conversation session persistence with `/btw` and `/new` commands, fixing reference errors in `/btw` command handlers.

---

## [v1.0.0] - 2026-10-16

### 📦 Initial Weave Core & Desktop App

#### 1. WhatsApp Baileys Integration (`src/bot.js`)
- **Headless WhatsApp Web Multi-Device Bridge**:
  - Multi-device WhatsApp Web connectivity powered by `@whiskeysockets/baileys`.
  - Real-time QR code generation and streaming in both terminal and Electron desktop UI.
  - Interactive 8-digit WhatsApp pairing code alternative for phone-number based pairing without camera scanning.
  - Automatic reconnection handling, credential persistence in `auth_info_baileys`, and auto-clearing stale credentials on 401 `loggedOut`.

#### 2. Google OAuth 2.0 PKCE & Gemini Client (`src/auth.js`, `src/gemini-client.js`)
- **Secure PKCE Authentication**:
  - Google OAuth 2.0 PKCE flow for direct client-side authentication without embedding client secrets.
  - Native Google PKCE sign-in modal in the desktop application.
  - Integrated Gemini API client supporting model execution (`gemini-2.5-flash`), custom `generationConfig`, token limits, and structured JSON generation.

#### 3. Electron Desktop Application with Stitch UI (`electron/`)
- **Minimalist Monochrome Desktop App**:
  - Cross-platform desktop client for Linux (AppImage), macOS (.dmg/.zip), and Windows (.exe/.zip).
  - Stitch monochrome black & white design system across all application screens.
  - Step-by-step onboarding wizard: JS Runtime check -> WhatsApp QR/Pairing code -> Google PKCE authentication -> Workspace.
  - Real-time diagnostic console and status indicator bar.

#### 4. Antigravity CLI Process Execution (`src/agent.js`, `bin/weave.js`)
- **Coding Agent Bridge**:
  - Core execution engine bridging incoming WhatsApp chat commands to local Antigravity CLI processes.
  - Real-time streaming of stdout/stderr logs back to WhatsApp chat and desktop console.
  - CLI launcher binary (`bin/weave.js`) with custom `@weave` call-sign.

#### 5. Live Over-The-Air (OTA) Updates (`src/ota.js`)
- **Automated Update System**:
  - Built-in Over-The-Air update mechanism checking upstream releases and updating runtime assets seamlessly without full application reinstallation.
