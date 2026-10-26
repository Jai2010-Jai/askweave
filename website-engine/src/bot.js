import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  generateWAMessageFromContent,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import QRCodeImage from 'qrcode';
import nodemailer from 'nodemailer';
import { EventEmitter } from 'events';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { googleAuth } from './auth.js';
import { googleServices } from './google-services.js';

export const botEvents = new EventEmitter();
import {
  CONFIG,
  ROOT_DIR,
  DATA_DIR,
  loadProjectsState,
  saveProjectsState,
  resolveProjectAndTask,
  PROJECT_PHONETIC_PATTERNS,
  updateTriggerPrefix,
  isGroupInitialized,
  markGroupInitialized,
  getGroupActiveProject,
  setGroupActiveProject,
  resetAllState,
  getAllInitializedGroups,
  getProjectAccess,
  grantProjectAccess,
  revokeProjectAccess,
  setGroupName,
  getGroupName,
  isGroupAllowAll,
  setGroupAllowAll,
  addFriend,
  removeFriend,
  getFriends,
  recordRawMessage,
  getRawMessage,
  getPendingPoll,
  markGroupDeinitialized,
  getConnectedUserEmail,
} from './config.js';
import { TEMPLATES } from './autopilot/templates.js';
import {
  sendChoicePoll,
  sendReactionFallback,
  handlePollVote,
  handleReactionVote,
} from './autopilot/polls.js';
import { transcribeAudioFile } from './transcribe.js';
import { buildGoogleCalendarUrl, createIcsFile, sendCalendarInviteDirectly } from './calendar.js';
import { captureWebScreenshot, getProjectDeploymentUrl } from './qa.js';
import { checkAndApplyOtaUpdate, getOtaStatus } from './ota.js';
import {
  runAntigravityTask,
  getActiveTaskInfo,
  stopActiveTask,
  gitCommitAndPush,
  addGitHubCollaborator,
  removeGitHubCollaborator,
  listGitHubCollaborators,
  prewarmAgentSession,
  prewarmAllBoundProjects,
} from './agent.js';
import { geminiClient } from './gemini-client.js';
import { routeAutopilotIntent } from './autopilot/router.js';
import {
  createProjectUnderMaster,
  switchGroupProject,
  unbindGroupProject,
  getGroupProjectStatus,
  listProjectsForGroup,
  getValidatedMasterDir,
} from './autopilot/workspace.js';
import {
  handleCollaboratorRequest,
  resolvePendingCollaborator,
  executeCollaboratorInvite,
  findFriend,
} from './autopilot/friends.js';
import {
  createPendingClarification,
  resolvePendingClarification,
} from './autopilot/clarification.js';
import { fullAutoDebouncer } from './autopilot/debouncer.js';
import { classifyUserIntent } from './nlp/classifier.js';
import { dispatchIntent } from './nlp/dispatcher.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth_info_baileys');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const PROCESSED_MSGS_FILE = path.join(DATA_DIR, '.processed-msgs.json');
const SENT_MSGS_FILE = path.join(DATA_DIR, '.sent-msgs.json');

function readIdArrayFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function atomicWriteJsonFile(filePath, value) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function safeStatIsFile(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const sentMessageIds = new Set(readIdArrayFile(SENT_MSGS_FILE));
const processedMessageIds = new Set(readIdArrayFile(PROCESSED_MSGS_FILE));
const inFlightMessageIds = new Set();
const activeLiveLocations = new Map();
const taskQueue = [];
let isProcessingQueue = false;
let currentRunningItem = null;

function trimIdSet(set, max = 500) {
  while (set.size > max) {
    const first = set.values().next().value;
    set.delete(first);
  }
}

export function recordSentMessageId(id) {
  if (!id) return;
  sentMessageIds.add(id);
  trimIdSet(sentMessageIds, 500);
  try {
    atomicWriteJsonFile(SENT_MSGS_FILE, Array.from(sentMessageIds).slice(-500));
  } catch {
    // Ignore write errors
  }
}

function recordProcessedMessageId(id) {
  if (!id) return;
  processedMessageIds.add(id);
  trimIdSet(processedMessageIds, 300);
  const arr = Array.from(processedMessageIds).slice(-300);
  try {
    atomicWriteJsonFile(PROCESSED_MSGS_FILE, arr);
  } catch {
    // Ignore write errors
  }
}

// In-memory retry counter cache for Baileys to coordinate key exchanges across message retries
const msgRetryCounterCache = new Map();
const retryCacheStore = {
  get(key) {
    return msgRetryCounterCache.get(key);
  },
  set(key, value) {
    msgRetryCounterCache.set(key, value);
  },
  del(key) {
    msgRetryCounterCache.delete(key);
  },
  flushAll() {
    msgRetryCounterCache.clear();
  },
};

// In-memory Signal key cache for Baileys
const signalCacheMap = new Map();
const signalCacheStore = {
  get(k) { return signalCacheMap.get(k); },
  set(k, v) { signalCacheMap.set(k, v); },
  del(k) { signalCacheMap.delete(k); },
  flushAll() { signalCacheMap.clear(); },
};

/**
 * Session integrity guard:
 * WhatsApp Signal ratchet chains grow over time. We never delete active session files
 * arbitrarily by file size on startup, as that corrupts the Signal ratchet state
 * and prevents decrypting incoming messages.
 */
function purgeClosedSessions() {
  return 0;
}

const recentBadMacPurges = new Map();

/**
 * Handles corrupted session / Bad MAC.
 * Resolves both phone number and LID so linked device sessions are healed,
 * purges corrupted files, and flushes in-memory cache so stale ratchets are evicted.
 */
function healCorruptedSession(jid, participant = null) {
  try {
    const targetKey = participant || jid || 'unknown';
    const count = (recentBadMacPurges.get(targetKey) || 0) + 1;
    recentBadMacPurges.set(targetKey, count);
    setTimeout(() => {
      recentBadMacPurges.delete(targetKey);
    }, 60000);

    if (activeSock) {
      activeSock.uploadPreKeysToServerIfRequired(true).catch(() => {});
    }

    // Delete session and sender-key files immediately on decryption failure so WhatsApp re-initiates a fresh ratchet
    if (count < 1) {
      return;
    }

    if (!fs.existsSync(AUTH_DIR)) return;
    const allFiles = fs.readdirSync(AUTH_DIR);

    // Read creds.json to know both our phone number and LID
    let myPn = '';
    let myLid = '';
    try {
      if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
        const c = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8'));
        myPn = (c?.me?.id || '').split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
        myLid = (c?.me?.lid || '').split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
      }
    } catch {}

    const rawJidDigits = (jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const rawPartDigits = (participant || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const targetDigits = [rawJidDigits, rawPartDigits].filter(Boolean);

    // If target matches either our own phone number or our LID, include BOTH so all device sessions heal
    if ((myPn && targetDigits.includes(myPn)) || (myLid && targetDigits.includes(myLid))) {
      if (myPn && !targetDigits.includes(myPn)) targetDigits.push(myPn);
      if (myLid && !targetDigits.includes(myLid)) targetDigits.push(myLid);
    }

    let purgedCount = 0;
    for (const file of allFiles) {
      if (file === 'creds.json' || file.startsWith('pre-key-') || file.startsWith('app-state-sync-')) {
        continue;
      }

      const shouldPurgeSession = file.startsWith('session-') && targetDigits.some((d) => file.includes(d));
      const shouldPurgeSenderKey = file.startsWith('sender-key-') && (
        (jid && file.includes(jid.replace(/:/g, '-'))) ||
        targetDigits.some((d) => file.includes(d))
      );

      if (shouldPurgeSession || shouldPurgeSenderKey) {
        try {
          fs.unlinkSync(path.join(AUTH_DIR, file));
          purgedCount++;
        } catch {}
      }
    }

    // Crucial: flush the in-memory cache so stale sessions are never re-saved or served
    if (signalCacheStore) {
      signalCacheStore.flushAll();
    }

    if (purgedCount > 0) {
      console.log(`🛡️ [Self-Heal] Purged ${purgedCount} desynced session/sender-key files & flushed signal cache for ${jid}.`);
    }
  } catch (err) {
    console.warn(`⚠️ Error in healCorruptedSession:`, err?.message || err);
  }
}

function loadContactsMap() {
  if (!fs.existsSync(CONTACTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveContactsList(contacts) {
  if (!contacts) return;
  const list = Array.isArray(contacts) ? contacts : Object.values(contacts);
  const map = loadContactsMap();
  let updated = false;
  for (const c of list) {
    const id = c?.id || c?.jid;
    const lid = c?.lid;
    const name = c?.name || c?.notify || c?.verifiedName || c?.subject;
    if (id && name && map[id] !== name) {
      map[id] = name;
      updated = true;
    }
    if (lid && name && map[lid] !== name) {
      map[lid] = name;
      updated = true;
    }
  }
  if (updated) {
    try {
      atomicWriteJsonFile(CONTACTS_FILE, map);
    } catch {
      // Ignore write errors
    }
  }
}

/**
 * Unwraps ephemeral/disappearing wrappers from a Baileys message.
 */
function unwrapMessage(msg) {
  if (!msg) return null;
  let m = msg.message;
  if (!m) return null;
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
  return m;
}

/**
 * Extracts a documentMessage either directly attached to the message OR from a quoted/replied-to message.
 */
function extractDocumentMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.documentMessage) return m.documentMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.documentMessage) return quoted.documentMessage;
  if (quoted.documentWithCaptionMessage?.message?.documentMessage) {
    return quoted.documentWithCaptionMessage.message.documentMessage;
  }
  if (quoted.ephemeralMessage?.message?.documentMessage) {
    return quoted.ephemeralMessage.message.documentMessage;
  }
  return null;
}

/**
 * Extracts an imageMessage either directly attached to the message OR from a quoted/replied-to message.
 */
function extractImageMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.imageMessage) return m.imageMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.imageMessage) return quoted.imageMessage;
  if (quoted.ephemeralMessage?.message?.imageMessage) {
    return quoted.ephemeralMessage.message.imageMessage;
  }
  if (quoted.viewOnceMessage?.message?.imageMessage) {
    return quoted.viewOnceMessage.message.imageMessage;
  }
  if (quoted.viewOnceMessageV2?.message?.imageMessage) {
    return quoted.viewOnceMessageV2.message.imageMessage;
  }
  return null;
}

/**
 * Extracts a videoMessage either directly attached to the message OR from a quoted/replied-to message.
 */
function extractVideoMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.videoMessage) return m.videoMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.videoMessage) return quoted.videoMessage;
  if (quoted.ephemeralMessage?.message?.videoMessage) {
    return quoted.ephemeralMessage.message.videoMessage;
  }
  return null;
}

/**
 * Extracts an audioMessage (voice note or audio file) either directly attached
 * to the message OR from a quoted/replied-to message.
 */
function extractAudioMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.audioMessage) return m.audioMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage ||
    m.audioMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.audioMessage) return quoted.audioMessage;
  if (quoted.ephemeralMessage?.message?.audioMessage) {
    return quoted.ephemeralMessage.message.audioMessage;
  }
  if (quoted.viewOnceMessage?.message?.audioMessage) {
    return quoted.viewOnceMessage.message.audioMessage;
  }
  if (quoted.viewOnceMessageV2?.message?.audioMessage) {
    return quoted.viewOnceMessageV2.message.audioMessage;
  }
  return null;
}

function sanitizeUploadFileName(name, fallback) {
  const sanitized = String(name || fallback || `file-${Date.now()}`).replace(
    /[^a-zA-Z0-9._ -]/g,
    '_'
  );
  // Prevent directory traversal / dot-only names ("..", ".", "...").
  if (!sanitized || sanitized === '.' || sanitized === '..' || /^\.+$/.test(sanitized)) {
    return fallback || `file-${Date.now()}`;
  }
  return sanitized.slice(0, 200) || fallback || `file-${Date.now()}`;
}

/**
 * Ensures `.whatsapp-uploads/` is listed in `<projectDir>/.git/info/exclude`
 * so temporary WhatsApp attachments never pollute `git status` or commits.
 */
function ensureGitExcludeUploads(projectDir) {
  try {
    const excludeFile = path.join(projectDir, '.git', 'info', 'exclude');
    if (fs.existsSync(excludeFile)) {
      const content = fs.readFileSync(excludeFile, 'utf8');
      if (!content.includes('.whatsapp-uploads')) {
        fs.appendFileSync(excludeFile, '\n.whatsapp-uploads/\n', 'utf8');
      }
    }
  } catch {
    // Ignore if not a git repo
  }
}

/**
 * Downloads an attached or quoted WhatsApp document, image, or video into `<projectDir>/.whatsapp-uploads/`.
 * Returns `{ filePath, fileName, type: 'document' | 'image' | 'video' }` or `null`.
 */
async function downloadWhatsAppAttachment(msg, projectDir) {
  if (!msg) return null;
  const docMsg = extractDocumentMessage(msg);
  if (docMsg) {
    try {
      const stream = await downloadContentFromMessage(docMsg, 'document');
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const uploadDir = path.join(projectDir, '.whatsapp-uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      ensureGitExcludeUploads(projectDir);

      const origName = sanitizeUploadFileName(docMsg.fileName, `document-${Date.now()}`);
      const filePath = path.join(uploadDir, origName);
      fs.writeFileSync(filePath, buffer);
      return { filePath, fileName: origName, type: 'document' };
    } catch (err) {
      console.error('⚠️ Failed to download WhatsApp document:', err?.message || err);
    }
  }

  const imageMsg = extractImageMessage(msg);
  if (imageMsg) {
    try {
      const stream = await downloadContentFromMessage(imageMsg, 'image');
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const mime = imageMsg.mimetype || 'image/jpeg';
      let ext = '.jpg';
      if (mime.includes('png')) ext = '.png';
      else if (mime.includes('webp')) ext = '.webp';
      else if (mime.includes('gif')) ext = '.gif';

      const uploadDir = path.join(projectDir, '.whatsapp-uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      ensureGitExcludeUploads(projectDir);

      const fileName = `whatsapp-image-${Date.now()}${ext}`;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, buffer);
      return { filePath, fileName, type: 'image' };
    } catch (err) {
      console.error('⚠️ Failed to download WhatsApp image:', err?.message || err);
      return null;
    }
  }

  const videoMsg = extractVideoMessage(msg);
  if (videoMsg) {
    try {
    const stream = await downloadContentFromMessage(videoMsg, 'video');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const mime = videoMsg.mimetype || 'video/mp4';
    let ext = '.mp4';
    if (mime.includes('quicktime') || mime.includes('mov')) ext = '.mov';
    else if (mime.includes('webm')) ext = '.webm';

    const uploadDir = path.join(projectDir, '.whatsapp-uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    ensureGitExcludeUploads(projectDir);

      const fileName = `whatsapp-video-${Date.now()}${ext}`;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, buffer);
      return { filePath, fileName, type: 'video' };
    } catch (err) {
      console.error('⚠️ Failed to download WhatsApp video:', err?.message || err);
      return null;
    }
  }

  const audioMsg = extractAudioMessage(msg);
  if (!audioMsg) return null;

  try {
    const stream = await downloadContentFromMessage(audioMsg, 'audio');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const mime = audioMsg.mimetype || 'audio/ogg';
    let ext = '.ogg';
    if (mime.includes('mp4') || mime.includes('m4a')) ext = '.m4a';
    else if (mime.includes('mpeg') || mime.includes('mp3')) ext = '.mp3';
    else if (mime.includes('wav')) ext = '.wav';

    const uploadDir = path.join(projectDir, '.whatsapp-uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    ensureGitExcludeUploads(projectDir);

    const fileName = `whatsapp-audio-${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { filePath, fileName, type: 'audio' };
  } catch (err) {
    console.error('⚠️ Failed to download WhatsApp audio:', err?.message || err);
    return null;
  }
}

/**
 * Unwraps ephemeral/disappearing wrappers and extracts text from a Baileys message.
 */
function extractMessageText(msg) {
  const m = unwrapMessage(msg);
  if (!m) return '';

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

/**
 * In-memory rolling buffer of recent messages per chat (up to 30 messages per JID).
 * Provides rich multi-turn context (meeting agendas, agreed timings, discussion topics).
 */
const chatMessageHistory = new Map();

function recordChatMessage(jid, { sender, text, timestamp, quotedText }) {
  if (!jid || !text) return;
  if (!chatMessageHistory.has(jid)) {
    chatMessageHistory.set(jid, []);
  }
  const history = chatMessageHistory.get(jid);
  const trimmedText = text.trim();
  const isDuplicate = history.length > 0 && history[history.length - 1].text === trimmedText;
  if (isDuplicate) return;

  history.push({
    sender: sender || 'User',
    text: trimmedText,
    timestamp: timestamp || Date.now(),
    quotedText: quotedText ? quotedText.slice(0, 100) : null,
  });
  if (history.length > 30) {
    history.shift();
  }
}

function getRecentChatContext(jid) {
  const history = chatMessageHistory.get(jid) || [];
  if (history.length === 0) return '';
  return history
    .map((m) => {
      const timeStr = new Date(m.timestamp).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const quoteStr = m.quotedText ? ` (replying to: "${m.quotedText}")` : '';
      return `[${timeStr}] ${m.sender}${quoteStr}: ${m.text}`;
    })
    .join('\n');
}

/**
 * Extracts the text of the message being replied to (quoted), including nested quotes.
 * If the quoted message itself replied to an agenda or announcement, both are unrolled.
 */
function extractQuotedText(msg) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;
  if (!contextInfo?.quotedMessage) return '';

  const quoteChain = [];

  function unwrapRecursive(quotedObj, depth = 0) {
    if (!quotedObj || depth > 4) return;
    const q =
      quotedObj.ephemeralMessage?.message ||
      quotedObj.viewOnceMessage?.message ||
      quotedObj.viewOnceMessageV2?.message ||
      quotedObj.documentWithCaptionMessage?.message ||
      quotedObj;

    const text = (
      q.conversation ||
      q.extendedTextMessage?.text ||
      q.imageMessage?.caption ||
      q.videoMessage?.caption ||
      q.documentMessage?.caption ||
      ''
    ).trim();

    if (text && !quoteChain.includes(text)) {
      quoteChain.push(text);
    }

    const nestedCtx =
      q.extendedTextMessage?.contextInfo ||
      q.imageMessage?.contextInfo ||
      q.videoMessage?.contextInfo ||
      q.documentMessage?.contextInfo;

    if (nestedCtx?.quotedMessage) {
      unwrapRecursive(nestedCtx.quotedMessage, depth + 1);
    }
  }

  unwrapRecursive(contextInfo.quotedMessage, 0);

  if (quoteChain.length === 0) return '';
  if (quoteChain.length === 1) return quoteChain[0];
  return quoteChain[0] + '\n\n[In reply to referenced meeting/agenda]:\n' + quoteChain.slice(1).join('\n\n');
}

/**
 * Smart date/time parser for CALENDAR_EVENT start times.
 * Handles ISO timestamps, time strings ("7:00 PM", "7 PM", "19:00"), and relative ("today at 7 PM").
 */
function parseCalendarDateTime(rawStr) {
  if (!rawStr) return new Date(Date.now() + 60 * 60 * 1000);
  const trimmed = String(rawStr).trim();

  // 1. Try standard new Date(trimmed)
  let d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d;
  }

  // 2. Handle "today at 7 PM", "tomorrow at 3 PM", etc.
  const lower = trimmed.toLowerCase();
  const baseDate = new Date();
  if (lower.includes('tomorrow')) {
    baseDate.setDate(baseDate.getDate() + 1);
  }

  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridian = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

    if (meridian === 'pm' && hours < 12) hours += 12;
    if (meridian === 'am' && hours === 12) hours = 0;
    if (!meridian && hours >= 1 && hours <= 7) {
      hours += 12;
    }

    baseDate.setHours(hours, minutes, 0, 0);
    return baseDate;
  }

  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Extracts the quoted message stanza ID (the message ID being swipe-replied to), if any.
 */
function getQuotedStanzaId(msg) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.audioMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;
  return contextInfo?.stanzaId || null;
}

/**
 * Returns true if the text is a short stop/cancel command (e.g. "stop", "/stop", "cancel").
 */
function isStopWord(str) {
  const clean = (str || '').trim().toLowerCase().replace(/^[/@!]+/, '').trim();
  return ['stop', 'stop it', 'abort', 'halt', 'kill'].includes(clean);
}

/**
 * Checks if the user is swipe-replying to a message sent by THIS Weave bot instance.
 * Checks tracked sentMessageIds, pending polls, and bot's own WhatsApp participant ID.
 */
function isReplyingToBot(msg, sock = null) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.audioMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;

  if (!contextInfo) return false;
  const stanzaId = contextInfo.stanzaId;

  // 1. Matched directly against tracked sentMessageIds (messages originated by this agent instance)
  if (stanzaId && sentMessageIds.has(stanzaId)) return true;

  // 2. Matched against pending polls created by this agent instance
  if (stanzaId && getPendingPoll(stanzaId)) return true;

  return false;
}

function matchesCommand(lowerText, cmd) {
  return lowerText === cmd || lowerText.startsWith(cmd + ' ') || lowerText.startsWith(cmd + '\n');
}

/**
 * Checks if the message is in a "Send to Self" (Message Yourself) chat thread.
 * In WhatsApp, texting yourself has remoteJid matching your own phone number or LID.
 */
function isSendToSelf(msg, sock) {
  if (!msg || !msg.key) return false;
  const jid = msg.key.remoteJid || '';
  if (!jid || jid.endsWith('@g.us')) return false;

  const botNumber = (sock?.user?.id || '').split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
  const botLid = (sock?.user?.lid || '').split(':')[0].split('@')[0];
  const remoteDigits = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const remoteBase = jid.split('@')[0].split(':')[0];

  // 1. Matches bot's own phone number or LID
  if (botNumber && remoteDigits === botNumber) return true;
  if (botLid && remoteBase === botLid) return true;

  // 2. If message is fromMe to own number in adminNumbers
  if (msg.key.fromMe && CONFIG.adminNumbers.length > 0) {
    if (CONFIG.adminNumbers.some((admin) => remoteDigits.endsWith(admin) || admin.endsWith(remoteDigits))) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if the message either:
 * 1) Starts with the unique text trigger (e.g. "@weave <task>"), OR
 * 2) Swipe-replies to a message sent by this Weave bot, OR
 * 3) Natively @mentions the bot's WhatsApp account in a group chat (when TRIGGER_ON_MENTION=true)
 * Returns the extracted task body if triggered, or null if not triggered.
 */
function extractTriggeredBody(sock, msg, text) {
  const trimmedText = (text || '').trim();
  const lowerText = trimmedText.toLowerCase();
  const trigger = CONFIG.triggerPrefix;
  const jid = msg.key?.remoteJid;

  const state = loadProjectsState();
  const isGroup = Boolean(jid && jid.endsWith('@g.us'));
  // Full auto is strictly scoped per group, never global or in 1-on-1 chats
  const isFullAuto = Boolean(isGroup && state.fullAutoGroups?.[jid]);
  const hasPendingClarification = Boolean(state.pendingClarifications?.[jid]);
  const hasPendingCollaborator = Boolean(state.pendingCollaborators?.[jid]);

  // 0. Pending resolution or Full Auto group: automatically trigger on message text
  if (hasPendingClarification || hasPendingCollaborator || isFullAuto) {
    if (isStopWord(lowerText)) return '/stop';
    return trimmedText;
  }

  // 1. Swipe-replying "stop" to a task message belonging to this Weave instance
  if (isStopWord(lowerText)) {
    const quotedId = getQuotedStanzaId(msg);
    const quotedText = extractQuotedText(msg).toLowerCase();
    const matchesRunning =
      quotedId && currentRunningItem?.msg?.key?.id === quotedId;
    const matchesQueued =
      quotedId && taskQueue.some((item) => item.msg?.key?.id === quotedId);
    const matchesTriggerText =
      quotedText === trigger ||
      quotedText.startsWith(trigger + ' ') ||
      quotedText.startsWith(trigger + '\n') ||
      quotedText.startsWith('@agent') ||
      quotedText.startsWith('@ap');
    if (matchesRunning || matchesQueued || matchesTriggerText) {
      return '/stop';
    }
  }

  // 2. Explicit triggers: configured triggerPrefix (@weave), @agent, agent, @ap, ap, @weave, weave
  const prefixes = [
    trigger.toLowerCase(),
    '@agent',
    'agent',
    '@ap',
    'ap',
    '@weave',
    'weave',
  ];
  for (const prefix of prefixes) {
    if (
      lowerText === prefix ||
      lowerText.startsWith(prefix + ' ') ||
      lowerText.startsWith(prefix + '\n') ||
      lowerText.startsWith(prefix + ':')
    ) {
      const rest = trimmedText.slice(prefix.length).replace(/^[:\s]+/, '').trim();
      if (isStopWord(rest)) return '/stop';
      return rest || 'status';
    }
  }

  // 2b. Personal Send-to-Self DM ("Message Yourself" personal chat with the bot)
  // Requires explicit prefix (@ap or trigger) UNLESS full auto is explicitly turned ON for this DM!
  const isSelf = isSendToSelf(msg, sock);
  if (isSelf && state.fullAutoGroups?.[jid]) {
    if (isStopWord(lowerText)) return '/stop';
    return trimmedText || '[voice note]';
  }

  // 2. Owner pending confirmation replies or /callsign command
  if (isOwner(msg)) {
    if (matchesCommand(lowerText, '/callsign') || matchesCommand(lowerText, '/trigger')) {
      return trimmedText;
    }

    // If there is a pending email draft in this Weave instance for this chat, allow direct confirm/cancel
    if (
      ['confirm', 'send', 'send it', 'yes', 'yes send', 'yes, send', 'send now', 'confirm send', 'cancel', 'discard'].includes(lowerText)
    ) {
      const state = loadProjectsState();
      if (state.pendingEmailDrafts?.[msg.key.remoteJid]) {
        return lowerText === 'cancel' || lowerText === 'discard' ? '/cancel' : '/confirm';
      }
    }
  }

  // 3. Swipe-replying directly to a message sent by THIS Weave instance (unless addressing another @bot)
  if (!lowerText.startsWith('@') && isReplyingToBot(msg, sock)) {
    if (isStopWord(lowerText)) return '/stop';
    return trimmedText || '[voice note]';
  }

  // 4. Native WhatsApp @mention in a chat (only when TRIGGER_ON_MENTION=true)
  if (CONFIG.triggerOnMention && sock.user) {
    const m = unwrapMessage(msg);
    let contextInfo =
      m?.extendedTextMessage?.contextInfo ||
      m?.imageMessage?.contextInfo ||
      m?.videoMessage?.contextInfo ||
      m?.audioMessage?.contextInfo ||
      m?.documentMessage?.contextInfo;
    if (!contextInfo && m) {
      for (const val of Object.values(m)) {
        if (val && typeof val === 'object' && val.contextInfo?.mentionedJid) {
          contextInfo = val.contextInfo;
          break;
        }
      }
    }
    const mentionedJids = contextInfo?.mentionedJid || [];

    const botNumber = (sock.user.id || '').split(':')[0].split('@')[0];
    const botLid = (sock.user.lid || '').split(':')[0].split('@')[0];

    const isBotMentioned = mentionedJids.some((jid) => {
      const base = jid.split(':')[0].split('@')[0];
      return (botNumber && base === botNumber) || (botLid && base === botLid);
    });

    if (isBotMentioned) {
      let cleaned = text;
      if (botNumber) {
        cleaned = cleaned.replace(new RegExp(`@${botNumber}\\b`, 'g'), '');
      }
      if (botLid) {
        cleaned = cleaned.replace(new RegExp(`@${botLid}\\b`, 'g'), '');
      }
      return cleaned.trim();
    }
  }

  // Voice notes & audio messages MUST be explicitly tagged with the call-sign (e.g. @weave).
  // Untagged voice notes are strictly ignored.
  return null;
}

/**
 * Reads and returns the owner's phone number and LID from auth_info_baileys/creds.json or active sock.
 */
function getOwnerIdentifiers() {
  const ids = {
    phone: '',
    lid: '',
    adminNumbers: Array.isArray(CONFIG.adminNumbers) ? [...CONFIG.adminNumbers] : [],
  };

  // 1. From active sock user if online
  if (activeSock?.user) {
    if (activeSock.user.id) {
      ids.phone = activeSock.user.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    }
    if (activeSock.user.lid) {
      ids.lid = activeSock.user.lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    }
  }

  // 2. From creds.json on disk
  if (!ids.phone || !ids.lid) {
    try {
      const credsPath = path.join(AUTH_DIR, 'creds.json');
      if (fs.existsSync(credsPath)) {
        const c = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (!ids.phone && c?.me?.id) {
          ids.phone = c.me.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        }
        if (!ids.lid && c?.me?.lid) {
          ids.lid = c.me.lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        }
      }
    } catch {}
  }

  return ids;
}

/**
 * Resolves a WhatsApp sender JID (whether @s.whatsapp.net or @lid) to their real phone number digits.
 */
function resolveSenderPhoneNumber(rawJid, pushName = '') {
  if (!rawJid) return '';
  const cleanJid = String(rawJid).trim();
  const digits = cleanJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

  // 1. If it's already a regular phone number JID (@s.whatsapp.net)
  if (cleanJid.endsWith('@s.whatsapp.net')) {
    return digits;
  }

  // 2. Check if the JID matches the owner's LID
  const owner = getOwnerIdentifiers();
  if (owner.lid && (digits === owner.lid || cleanJid.includes(owner.lid))) {
    return owner.phone || digits;
  }

  // 3. If it's a @lid JID, look up the contact mapping
  const contacts = loadContactsMap();
  const directName = contacts[cleanJid] || contacts[`${digits}@lid`];
  const targetName = (directName || pushName || '').trim();

  if (targetName) {
    const cleanTarget = targetName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [jid, name] of Object.entries(contacts)) {
      if (jid.endsWith('@s.whatsapp.net') && name) {
        const cleanContact = String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (
          cleanContact === cleanTarget ||
          (cleanTarget.length >= 4 && (cleanContact.startsWith(cleanTarget) || cleanTarget.startsWith(cleanContact)))
        ) {
          const phone = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
          if (phone) return phone;
        }
      }
    }
  }

  return digits;
}

/**
 * Extracts numeric sender phone/ID from a message.
 */
function getSenderNumber(msg) {
  if (!msg || !msg.key) return '';
  const rawJid = msg.key.participant || msg.key.remoteJid || '';
  return resolveSenderPhoneNumber(rawJid, msg.pushName || '');
}

/**
 * Checks if the message was sent by YOU (the Owner/Admin).
 * - If you scanned the QR code with your own WhatsApp, `msg.key.fromMe` is true for your messages.
 * - Matches the linked device's own phone number or LID from credentials.
 * - Matches any phone number listed in ADMIN_NUMBERS in .env.
 */
function isOwner(msg) {
  if (!msg || !msg.key) return true; // Safe default for internal/queued tasks triggered by owner vote
  if (msg.key.fromMe) return true;

  const rawJid = msg.key.participant || msg.key.remoteJid || '';
  const senderDigits = rawJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const owner = getOwnerIdentifiers();

  // 1. Direct match with owner's LID or own phone number from auth state
  if (owner.lid && senderDigits === owner.lid) return true;
  if (owner.phone && senderDigits === owner.phone) return true;

  // 2. Resolved phone number match with owner's phone
  const resolvedPhone = resolveSenderPhoneNumber(rawJid, msg.pushName || '');
  if (owner.phone && resolvedPhone === owner.phone) return true;

  // 3. Match against configured admin numbers in .env
  if (owner.adminNumbers.length > 0) {
    if (!resolvedPhone && !senderDigits) return false;
    return owner.adminNumbers.some((admin) => {
      const adminDigits = admin.replace(/[^0-9]/g, '');
      if (!adminDigits) return false;
      return (
        (resolvedPhone && (resolvedPhone.endsWith(adminDigits) || adminDigits.endsWith(resolvedPhone))) ||
        (senderDigits && (senderDigits.endsWith(adminDigits) || adminDigits.endsWith(senderDigits)))
      );
    });
  }

  return false;
}

/**
 * Checks if sender is allowed to trigger tasks in a bound group.
 * Respects owner, allowedSenders, and granular projectAccess per group.
 */
function isSenderAuthorized(msg, targetProjectAlias = null) {
  if (!msg || !msg.key) return true;
  // fromMe = the linked device itself (respects ALLOW_FROM_ME).
  // Admin / Owner messages are ALWAYS authorized.
  if (msg.key.fromMe) return CONFIG.allowFromMe;
  if (isOwner(msg)) return true;

  const senderNum = getSenderNumber(msg);
  const rawJid = msg.key.participant || msg.key.remoteJid || '';
  const rawSenderDigits = rawJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const jid = msg.key.remoteJid || '';
  const isGroup = Boolean(jid && jid.endsWith('@g.us'));

  // In group chats:
  // 1. If "Give Permission to All" is toggled ON for this group, any group member is authorized!
  if (isGroup && isGroupAllowAll(jid)) {
    return true;
  }

  // 2. Otherwise access is strictly based on the group's currently active project.
  // Each project has its own list of allowed contacts (phone numbers in E.164 format).
  // By default, only the owner has permission.
  if (isGroup) {
    const state = loadProjectsState();
    const activeAlias = targetProjectAlias || state.groupBindings?.[jid] || null;
    if (!activeAlias) {
      return false;
    }
    const allowedList = getProjectAccess(activeAlias);
    if (!allowedList || allowedList.length === 0) {
      return false;
    }
    if (!senderNum && !rawSenderDigits) return false;

    return allowedList.some((allowed) => {
      const allowedDigits = String(allowed).replace(/\D/g, '');
      if (!allowedDigits) return false;
      return (
        (senderNum && (senderNum === allowedDigits || senderNum.endsWith(allowedDigits) || allowedDigits.endsWith(senderNum))) ||
        (rawSenderDigits && (rawSenderDigits === allowedDigits || rawSenderDigits.endsWith(allowedDigits) || allowedDigits.endsWith(rawSenderDigits)))
      );
    });
  }

  // In 1-on-1 chats:
  if (CONFIG.allowedSenders.includes('*') || CONFIG.allowedSenders.length === 0) {
    return true;
  }
  if (!senderNum && !rawSenderDigits) return false;
  return CONFIG.allowedSenders.some(
    (allowed) =>
      (senderNum && (senderNum.endsWith(allowed) || allowed.endsWith(senderNum))) ||
      (rawSenderDigits && (rawSenderDigits.endsWith(allowed) || allowed.endsWith(rawSenderDigits)))
  );
}

/**
 * Appends the standardized agent badge footer to messages.
 */
function formatAgentMessage(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  // If text already ends with `agent message`, don't duplicate
  if (trimmed.endsWith('`agent message`')) return trimmed;
  return `${trimmed}\n\n\`agent message\``;
}

/**
 * Helper to send a WhatsApp reply and track its message ID so we never self-loop.
 */
async function sendReply(sock, jid, text, quotedMsg) {
  const formattedText = formatAgentMessage(text);
  const options = { text: formattedText };
  const sendOpts = quotedMsg && typeof quotedMsg === 'object' && quotedMsg.key ? { quoted: quotedMsg } : undefined;
  const sent = await sock.sendMessage(jid, options, sendOpts);
  if (sent?.key?.id) {
    recordSentMessageId(sent.key.id);
    if (sent.message) recordRawMessage(sent.key.id, sent.message);
  }
  return sent;
}

/**
 * Returns MIME type based on file extension.
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/opus',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.apk': 'application/vnd.android.package-archive',
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.py': 'text/x-python',
    '.html': 'text/html',
    '.css': 'text/css',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Resolves or searches for a local file on the PC.
 */
function findLocalFile(query, projectDir) {
  let cleaned = (query || '').trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return null;

  const homeDir = os.homedir();
  if (cleaned.startsWith('~/')) {
    cleaned = path.join(homeDir, cleaned.slice(2));
  }

  // 1. Direct path check
  const directCandidates = [
    path.isAbsolute(cleaned) ? cleaned : null,
    projectDir ? path.resolve(projectDir, cleaned) : null,
    path.resolve(homeDir, cleaned),
    path.resolve(homeDir, 'Downloads', cleaned),
    path.resolve(homeDir, 'Documents', cleaned),
    path.resolve(homeDir, 'Desktop', cleaned),
    path.resolve(homeDir, 'Pictures', cleaned),
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    if (safeStatIsFile(candidate)) {
      return candidate;
    }
  }

  // 2. Recursive filename search across common user directories (up to depth 4).
  // NOTE: the home root itself is deliberately NOT scanned — a synchronous
  // recursive walk over all of $HOME blocks the event loop for minutes and
  // can OOM on large trees. Downloads/Documents/Desktop/Pictures + project
  // cover the documented use-cases.
  const baseName = path.basename(cleaned);
  if (!baseName || baseName === '.' || baseName === '..' || baseName === '/') {
    return null;
  }
  const targetLower = baseName.toLowerCase();
  const searchRoots = [
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Pictures'),
    projectDir,
  ].filter((d) => d && fs.existsSync(d));

  const skipDirs = new Set([
    'node_modules',
    '.git',
    '.cache',
    '.local',
    '.npm',
    '.gemini',
    '.vscode',
    '.config',
    'auth_info_baileys',
  ]);

  let partialMatch = null;
  let visitedFiles = 0;
  const MAX_VISITED_FILES = 5000;

  function searchDir(dir, depth) {
    if (depth > 4 || visitedFiles > MAX_VISITED_FILES) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        visitedFiles += 1;
        if (visitedFiles > MAX_VISITED_FILES) return null;
        const nameLower = entry.name.toLowerCase();
        const fullPath = path.join(dir, entry.name);
        if (nameLower === targetLower) {
          return fullPath;
        }
        if (!partialMatch && targetLower && nameLower.includes(targetLower)) {
          partialMatch = fullPath;
        }
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !skipDirs.has(entry.name)) {
        const found = searchDir(path.join(dir, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  for (const root of searchRoots) {
    const exact = searchDir(root, 1);
    if (exact) return exact;
  }

  return partialMatch;
}

/**
 * Sends a local file over WhatsApp as a document (preserving filename & original quality).
 */
async function sendWhatsAppFile(sock, targetJid, filePath, caption, quotedMsg) {
  if (!safeStatIsFile(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(
      `File "${path.basename(filePath)}" is ${(stat.size / 1048576).toFixed(1)}MB, over the 150MB WhatsApp limit.`
    );
  }
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const mimetype = getMimeType(filePath);

  // Normalize recipient JID: WhatsApp does not deliver media to @lid for self-notes.
  // Resolve owner's @lid to their real @s.whatsapp.net phone JID.
  let resolvedJid = targetJid;
  const myLid = (sock?.user?.lid || '').split(':')[0].split('@')[0];
  const myPhone = (sock?.user?.id || '').split(':')[0].split('@')[0];
  if (resolvedJid.endsWith('@lid')) {
    const targetLid = resolvedJid.split('@')[0];
    if (myPhone && (targetLid === myLid || quotedMsg?.key?.fromMe)) {
      resolvedJid = `${myPhone}@s.whatsapp.net`;
    }
  }

  console.log(`[sendWhatsAppFile] Sending "${fileName}" (${mimetype}) to ${resolvedJid} (original: ${targetJid})`);
  const shouldQuote = quotedMsg && resolvedJid === targetJid;
  const rawCaption = caption || (mimetype.startsWith('image/') ? `📸 ${fileName}` : `📎 ${fileName}`);
  const formattedCaption = formatAgentMessage(rawCaption);

  let sent;
  try {
    if (mimetype.startsWith('image/')) {
      sent = await sock.sendMessage(
        resolvedJid,
        {
          image: buffer,
          caption: formattedCaption,
        },
        shouldQuote ? { quoted: quotedMsg } : undefined
      );
    } else {
      sent = await sock.sendMessage(
        resolvedJid,
        {
          document: buffer,
          mimetype,
          fileName,
          caption: formattedCaption,
        },
        shouldQuote ? { quoted: quotedMsg } : undefined
      );
    }
  } catch (mediaErr) {
    console.warn(`[sendWhatsAppFile] Media send error (${mediaErr.message}), falling back to document...`);
    sent = await sock.sendMessage(
      resolvedJid,
      {
        document: buffer,
        mimetype: 'image/png',
        fileName,
        caption: caption || `📸 ${fileName}`,
      },
      shouldQuote ? { quoted: quotedMsg } : undefined
    );
  }

  if (sent?.key?.id) recordSentMessageId(sent.key.id);
  return sent;
}

/**
 * Returns active SMTP credentials from projects.json or .env
 */
function getSmtpConfig() {
  const state = loadProjectsState();
  const saved = state.smtp || {};
  const connectedEmail = getConnectedUserEmail() || '';
  return {
    host: saved.host || CONFIG.smtpHost || 'smtp.gmail.com',
    port: Number(saved.port || CONFIG.smtpPort || 465),
    user: saved.user || CONFIG.smtpUser || connectedEmail,
    pass: saved.pass || CONFIG.smtpPass || '',
  };
}

/**
 * Sends an email with optional attachments via Google OAuth (Gmail API) or SMTP fallback.
 */
async function sendEmailWithAttachments({ to, subject, body, attachmentPaths = [] }) {
  // 1. If Google account is connected, prefer direct Gmail API (seamless, no app password required)
  if (googleAuth.isAuthenticated()) {
    try {
      return await googleServices.sendEmail({
        to,
        subject,
        body,
        attachmentPaths,
        from: googleAuth.getUserEmail() || getConnectedUserEmail() || undefined,
      });
    } catch (apiErr) {
      const smtp = getSmtpConfig();
      if (smtp.pass) {
        console.warn(`[bot] Gmail API send failed (${apiErr.message}), falling back to SMTP password.`);
      } else {
        throw apiErr;
      }
    }
  }

  // 2. SMTP fallback
  const smtp = getSmtpConfig();
  if (!smtp.user || !smtp.pass) {
    const err = new Error('SMTP_NOT_CONFIGURED');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  const attachments = attachmentPaths
    .filter((p) => p && safeStatIsFile(p))
    .map((p) => ({
      filename: path.basename(p),
      path: p,
    }));

  const emailSignature = 'Sent by Weave';
  let formattedBody = (body || '').trim();
  if (!formattedBody.endsWith(emailSignature)) {
    formattedBody = formattedBody ? `${formattedBody}\n\n${emailSignature}` : emailSignature;
  }

  const info = await transporter.sendMail({
    from: smtp.user,
    to,
    subject,
    text: formattedBody,
    attachments,
  });

  return { messageId: info.messageId, attachmentsCount: attachments.length, from: smtp.user, provider: 'smtp' };
}

/**
 * Extracts a location pin from a message or its quoted message, if present.
 */
function extractLocationFromMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  const directLoc = m.locationMessage || m.liveLocationMessage;
  if (directLoc && typeof directLoc.degreesLatitude === 'number') {
    return {
      lat: directLoc.degreesLatitude,
      lon: directLoc.degreesLongitude,
      label: directLoc.name || directLoc.address || directLoc.caption || 'Shared WhatsApp Pin',
    };
  }

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  const q =
    quoted.ephemeralMessage?.message ||
    quoted.viewOnceMessage?.message ||
    quoted.viewOnceMessageV2?.message ||
    quoted;

  const quotedLoc = q.locationMessage || q.liveLocationMessage;
  if (quotedLoc && typeof quotedLoc.degreesLatitude === 'number') {
    return {
      lat: quotedLoc.degreesLatitude,
      lon: quotedLoc.degreesLongitude,
      label: quotedLoc.name || quotedLoc.address || quotedLoc.caption || 'Quoted WhatsApp Pin',
    };
  }
  return null;
}

/**
 * Resolves coordinates from:
 * 1) Attached/quoted WhatsApp location pin
 * 2) Explicit "lat, lon" or place name (via OpenStreetMap Nominatim)
 * 3) Saved default location in projects.json (/setlocation)
 * 4) Automatic PC IP Geolocation (https://ipwho.is/)
 */
async function resolveLocationCoordinates(customQuery = '', msg = null) {
  // 1. Check if the user attached or quoted a location pin in WhatsApp
  if (msg) {
    const pin = extractLocationFromMessage(msg);
    if (pin) return pin;
  }

  const q = (customQuery || '').trim();
  if (q && !['AUTO', 'DEFAULT', 'CURRENT', 'HERE', 'NONE'].includes(q.toUpperCase())) {
    // 2a. Explicit lat, lon coordinates (e.g. "12.9716, 77.5946")
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      return { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
    }

    // 2b. Geocode place name / address via OpenStreetMap Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'WhatsAppAntigravityAgent/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          label: data[0].display_name.split(',').slice(0, 3).join(',').trim(),
        };
      }
    } catch {
      // Fall through to saved or IP location
    }
  }

  // 3. Saved default location in projects.json (set via /setlocation)
  const state = loadProjectsState();
  if (
    state.savedLocation &&
    typeof state.savedLocation.lat === 'number' &&
    typeof state.savedLocation.lon === 'number'
  ) {
    return state.savedLocation;
  }

  // 4. Automatic PC IP Geolocation fallback
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      const label = [data.city, data.region, data.country].filter(Boolean).join(', ');
      return {
        lat: data.latitude,
        lon: data.longitude,
        label: label || 'Current PC Location',
      };
    }
  } catch {
    // Ignore IP lookup error
  }

  throw new Error(
    'Could not determine location automatically. Set your location once using `/setlocation <place or lat,lon>` or swipe-reply `/setlocation` to a location pin!'
  );
}

/**
 * Relays a native WhatsApp liveLocationMessage packet.
 */
async function sendLiveLocationPacket(sock, targetJid, { lat, lon, caption, seq, remainingSec }) {
  const content = generateWAMessageFromContent(
    targetJid,
    {
      liveLocationMessage: {
        degreesLatitude: lat,
        degreesLongitude: lon,
        accuracyInMeters: 15,
        caption,
        sequenceNumber: seq,
        timeOffset: remainingSec,
      },
    },
    { userJid: sock.user?.id }
  );
  await sock.relayMessage(targetJid, content.message, {
    messageId: content.key.id,
  });
  if (content?.key?.id) recordSentMessageId(content.key.id);
  return content;
}

/**
 * Stops an active live location session for a target JID (or all active sessions if targetJid is null).
 */
function stopLiveLocationShare(targetJid = null) {
  if (targetJid) {
    const existing = activeLiveLocations.get(targetJid);
    if (existing) {
      clearInterval(existing.intervalId);
      clearTimeout(existing.timeoutId);
      activeLiveLocations.delete(targetJid);
      return [existing];
    }
    return [];
  }

  const stopped = [];
  for (const [jidKey, session] of activeLiveLocations.entries()) {
    clearInterval(session.intervalId);
    clearTimeout(session.timeoutId);
    stopped.push(session);
    activeLiveLocations.delete(jidKey);
  }
  return stopped;
}

/**
 * Starts sharing live location with `targetJid` for `durationHours` (default 8 hours).
 * Sends an interactive map pin + native liveLocationMessage stream and updates periodically.
 */
async function startLiveLocationShare(
  sock,
  targetJid,
  durationHours = 8,
  customPlaceOrCoords = '',
  msg = null
) {
  const hours = Math.max(0.25, Math.min(24, Number(durationHours) || 8));
  const totalSeconds = Math.round(hours * 3600);
  const loc = await resolveLocationCoordinates(customPlaceOrCoords, msg);

  // Stop any previous live location session for this recipient
  stopLiveLocationShare(targetJid);

  const endTimeMs = Date.now() + totalSeconds * 1000;
  const endTimeFormatted = new Date(endTimeMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // 1. Send interactive map location pin so it renders a rich map card on all devices
  const pinSent = await sock.sendMessage(targetJid, {
    location: {
      degreesLatitude: loc.lat,
      degreesLongitude: loc.lon,
      name: `📍 Live Location (${hours}h — until ${endTimeFormatted})`,
      address: loc.label,
    },
  });
  if (pinSent?.key?.id) recordSentMessageId(pinSent.key.id);

  // 2. Send native liveLocationMessage packet
  let seq = 1;
  try {
    await sendLiveLocationPacket(sock, targetJid, {
      lat: loc.lat,
      lon: loc.lon,
      caption: `📍 Live Location (${hours}h — active until ${endTimeFormatted})\n${loc.label}`,
      seq,
      remainingSec: totalSeconds,
    });
  } catch {
    // Ignore if device prefers standard location pin
  }

  // 3. Keep background live location session active for the full duration (e.g. 8 hours),
  // pushing live coordinate updates every 5 minutes. Reuse the originally resolved
  // location — re-resolving via IP geolocation here would make the pin jump around
  // and hammer the geolocation API on every tick.
  const intervalId = setInterval(async () => {
    const remainingSec = Math.max(0, Math.round((endTimeMs - Date.now()) / 1000));
    if (remainingSec <= 0) {
      stopLiveLocationShare(targetJid);
      return;
    }
    seq += 1;
    try {
      await sendLiveLocationPacket(sock, targetJid, {
        lat: loc.lat,
        lon: loc.lon,
        caption: `📍 Live Location (active until ${endTimeFormatted}) — ${loc.label}`,
        seq,
        remainingSec,
      });
    } catch {
      // Ignore transient network errors during background update
    }
  }, 5 * 60 * 1000);

  const timeoutId = setTimeout(() => {
    stopLiveLocationShare(targetJid);
  }, totalSeconds * 1000);

  const contacts = loadContactsMap();
  const targetName = contacts[targetJid] || targetJid;

  activeLiveLocations.set(targetJid, {
    targetJid,
    targetName,
    lat: loc.lat,
    lon: loc.lon,
    label: loc.label,
    hours,
    endTimeFormatted,
    intervalId,
    timeoutId,
  });

  return {
    loc,
    hours,
    endTimeFormatted,
    targetName,
  };
}

/**
 * Extracts all mentioned JIDs in a message (excluding the bot itself if needed).
 */
function getMentionedJids(msg) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;
  return contextInfo?.mentionedJid || [];
}

/**
 * Resolves a contact target (@mention, JID, phone number, or contact name) to a valid WhatsApp JID.
 */
function resolveContactTarget(msg, targetInput, { exactOnly = false } = {}) {
  const raw = (targetInput || '').trim();
  if (!raw) return null;
  const mentioned = getMentionedJids(msg);

  // 1. If the user @mentioned a contact in this WhatsApp message
  if (mentioned.length > 0 && raw.startsWith('@')) {
    const stripped = raw.replace(/^@/, '');
    const exactMatch = mentioned.find((jid) => jid.startsWith(stripped));
    return exactMatch || mentioned[0];
  }

  // 2. If it's already a full WhatsApp JID
  if (raw.includes('@s.whatsapp.net') || raw.includes('@lid') || raw.includes('@g.us')) {
    return raw;
  }

  // 3. If it's a phone number (e.g. 919876543210 or +919876543210)
  const digitsOnly = raw.replace(/[^0-9]/g, '');
  if (digitsOnly.length >= 10 && digitsOnly.length <= 15 && /^[@+\d\s-]+$/.test(raw)) {
    const contacts = loadContactsMap();
    for (const jid of Object.keys(contacts)) {
      if (jid.includes(digitsOnly) && jid.endsWith('@s.whatsapp.net')) return jid;
    }
    return `${digitsOnly}@s.whatsapp.net`;
  }

  // 4. Search saved contact names (case-insensitive, preferring @s.whatsapp.net over @lid)
  const contacts = loadContactsMap();
  const entries = Object.entries(contacts).sort(([jidA], [jidB]) => {
    const aPhone = jidA.endsWith('@s.whatsapp.net') ? 0 : 1;
    const bPhone = jidB.endsWith('@s.whatsapp.net') ? 0 : 1;
    return aPhone - bPhone;
  });

  const lowerTarget = raw.toLowerCase().replace(/^@/, '');
  for (const [jid, name] of entries) {
    if (name.toLowerCase().trim() === lowerTarget) return jid;
  }
  if (!exactOnly) {
    for (const [jid, name] of entries) {
      if (name.toLowerCase().includes(lowerTarget)) return jid;
    }
  }

  return null;
}

/**
 * Helper to react to a message with an emoji.
 */
async function reactToMessage(sock, msg, emoji) {
  if (!msg || !msg.key || !msg.key.remoteJid) return;
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch {
    // Ignore reaction errors
  }
}

/**
 * Extracts `[TAG: ...]` directives from agent output, tolerating `]` characters
 * inside the payload (e.g. "hello [world]"). The old non-greedy regexes
 * (`[\s\S]+?\]`) truncated at the first inner `]`.
 *
 * A directive ends at the first `]` that is followed by end-of-string,
 * a newline, or the start of another `[TAG:` directive.
 */
function extractBracketDirectives(response, tag) {
  const results = [];
  const open = `[${tag}:`;
  let searchFrom = 0;
  while (true) {
    const start = response.indexOf(open, searchFrom);
    if (start === -1) break;
    const payloadStart = start + open.length;
    // Find all candidate closing brackets and pick the right terminator.
    let end = -1;
    let cursor = payloadStart;
    while (true) {
      const close = response.indexOf(']', cursor);
      if (close === -1) break;
      const after = response.slice(close + 1);
      if (after === '' || after.startsWith('\n') || /^\s*\[/.test(after)) {
        end = close;
        break;
      }
      // Heuristic: a `]` followed by end-of-line-ish boundary also terminates.
      // Otherwise treat it as payload content (e.g. "[world]") and keep scanning.
      const nextOpen = response.indexOf('[', close + 1);
      if (nextOpen === -1) {
        end = response.lastIndexOf(']');
        break;
      }
      cursor = close + 1;
    }
    if (end === -1) break;
    const fullMatch = response.slice(start, end + 1);
    const payload = response.slice(payloadStart, end);
    results.push({ fullMatch, payload });
    searchFrom = end + 1;
  }
  return results;
}

function splitFirstPipe(s) {
  const i = s.indexOf('|');
  if (i === -1) return [s.trim(), ''];
  return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
}

/**
 * Processes queued coding tasks sequentially so two agents don't edit the same repo simultaneously.
 */
async function processQueue(sock) {
  if (isProcessingQueue || taskQueue.length === 0) return;
  isProcessingQueue = true;

  try {
    while (taskQueue.length > 0) {
      const item = taskQueue.shift();
      currentRunningItem = item;
      try {
        await processQueueItem(sock, item);
      } catch (err) {
        if (!err.cancelled) {
          try {
            await sendReply(
              sock,
              item.jid,
              `❌ ${err.message}`,
              item.msg
            );
          } catch {
            // Ignore reply errors so the queue keeps draining
          }
        }
      } finally {
        currentRunningItem = null;
      }
    }
  } finally {
    currentRunningItem = null;
    isProcessingQueue = false;
  }
}

async function processQueueItem(sock, item) {
  if (item.cancelled) {
    const cancelErr = new Error('Task was cancelled by user.');
    cancelErr.cancelled = true;
    throw cancelErr;
  }
  const { jid, msg, projectAlias, projectDir, taskPrompt, continueSession } = item;
  const isGroup = jid.endsWith('@g.us');
  const owner = isOwner(msg);
  const mentionedJids = getMentionedJids(msg);

  await reactToMessage(sock, msg, '⏳');
  const attachmentInfo = await downloadWhatsAppAttachment(msg, projectDir);
  const imagePath = attachmentInfo?.type === 'image' ? attachmentInfo.filePath : null;

  if (item.cancelled) {
    const cancelErr = new Error('Task was cancelled by user.');
    cancelErr.cancelled = true;
    throw cancelErr;
  }

  try {
    const preState = loadProjectsState();
    const existingDraft = preState.pendingEmailDrafts?.[jid] || null;

    const recentChatContext = getRecentChatContext(jid);

    const result = await runAntigravityTask({
      projectAlias,
      projectDir,
      taskPrompt,
      continueSession,
      imagePath,
      attachmentInfo,
      pendingEmailDraft: existingDraft,
      ownerAllowedToMessage: owner,
      mentionedJids,
      recentChatContext,
    });

    let cleanedResponse = result.response;
    const dmNotifications = [];
    const stripDirectives = [];
    let hasOwnerEmailAction = false;
    let hasCalendarAction = false;

    // Only execute owner directives if triggered by the Owner!
    if (owner) {
      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'SEND_WHATSAPP')) {
        const [targetRaw, dmText] = splitFirstPipe(payload);
        stripDirectives.push(fullMatch);
        if (!targetRaw || !dmText) continue;
        const targetJid = resolveContactTarget(msg, targetRaw);
        if (targetJid) {
          try {
            const formattedDm = formatAgentMessage(dmText);
            const sentDm = await sock.sendMessage(targetJid, { text: formattedDm });
            if (sentDm?.key?.id) recordSentMessageId(sentDm.key.id);
            const contacts = loadContactsMap();
            const displayTarget = contacts[targetJid] || targetRaw;
            dmNotifications.push(
              `📨 Sent to *${displayTarget}*: "${dmText}"`
            );
          } catch (dmErr) {
            dmNotifications.push(
              `⚠️ Failed to message ${targetRaw}: ${dmErr.message}`
            );
          }
        } else {
          dmNotifications.push(
            `⚠️ Could not find contact "${targetRaw}".`
          );
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'SEND_FILE')) {
        const [targetRaw, rawPath] = splitFirstPipe(payload);
        stripDirectives.push(fullMatch);
        if (!targetRaw || !rawPath) continue;
        const resolvedFile = findLocalFile(rawPath, projectDir);

        if (!resolvedFile) {
          dmNotifications.push(`⚠️ File not found: \`${rawPath}\``);
          continue;
        }

        const isHere = ['HERE', 'SELF', 'ME', 'CHAT'].includes(targetRaw.toUpperCase());
        const targetJid = isHere ? jid : resolveContactTarget(msg, targetRaw);

        if (targetJid) {
          try {
            await sendWhatsAppFile(
              sock,
              targetJid,
              resolvedFile,
              `📎 \`${path.basename(resolvedFile)}\``,
              isHere ? msg : undefined
            );
            if (!isHere) {
              const contacts = loadContactsMap();
              const displayTarget = contacts[targetJid] || targetRaw;
              dmNotifications.push(
                `📎 Sent \`${path.basename(resolvedFile)}\` to *${displayTarget}*.`
              );
            }
          } catch (fileErr) {
            dmNotifications.push(
              `⚠️ Failed to send \`${path.basename(resolvedFile)}\`: ${fileErr.message}`
            );
          }
        } else {
          dmNotifications.push(
            `⚠️ Could not find contact "${targetRaw}".`
          );
        }
      }

      for (const tag of ['DRAFT_EMAIL', 'SEND_EMAIL']) {
        for (const { fullMatch, payload } of extractBracketDirectives(result.response, tag)) {
          stripDirectives.push(fullMatch);
          // Split payload into to | subject | attachments | body (body may contain | and ])
          const firstPipe = payload.indexOf('|');
          const secondPipe = firstPipe === -1 ? -1 : payload.indexOf('|', firstPipe + 1);
          const thirdPipe = secondPipe === -1 ? -1 : payload.indexOf('|', secondPipe + 1);
          if (firstPipe === -1 || secondPipe === -1 || thirdPipe === -1) continue;
          let toEmail = payload.slice(0, firstPipe).trim();
          if (['me', 'myself', 'owner', 'self', 'to me', 'to myself'].includes(toEmail.toLowerCase())) {
            toEmail = getConnectedUserEmail() || CONFIG.ownerEmail || '';
          }
          const subject = payload.slice(firstPipe + 1, secondPipe).trim();
          const rawAttachments = payload.slice(secondPipe + 1, thirdPipe).trim();
          let emailBody = payload.slice(thirdPipe + 1).trim();
          const emailSignature = 'Sent by Weave';
          if (!emailBody.endsWith(emailSignature)) {
            emailBody = emailBody ? `${emailBody}\n\n${emailSignature}` : emailSignature;
          }
          if (!toEmail || !subject) continue;

          const resolvedAttachments = [];
          if (rawAttachments && rawAttachments.toUpperCase() !== 'NONE') {
            for (const part of rawAttachments.split(',')) {
              const found = findLocalFile(part.trim(), projectDir);
              if (found && !resolvedAttachments.includes(found)) {
                resolvedAttachments.push(found);
              }
            }
          }
          // If the user attached a file in WhatsApp, make sure it's included!
          if (
            attachmentInfo?.filePath &&
            safeStatIsFile(attachmentInfo.filePath) &&
            !resolvedAttachments.includes(attachmentInfo.filePath)
          ) {
            resolvedAttachments.push(attachmentInfo.filePath);
          }
          // If revising an existing draft and no new attachments were specified, keep the existing draft's attachments
          if (
            resolvedAttachments.length === 0 &&
            existingDraft?.attachments?.length > 0 &&
            rawAttachments.toUpperCase() !== 'CLEAR'
          ) {
            for (const prevPath of existingDraft.attachments) {
              if (safeStatIsFile(prevPath) && !resolvedAttachments.includes(prevPath)) {
                resolvedAttachments.push(prevPath);
              }
            }
          }

          const isOwnerEmail =
            Boolean(CONFIG.ownerEmail) &&
            toEmail.toLowerCase() === CONFIG.ownerEmail.toLowerCase();
          const shouldSendImmediately = tag === 'SEND_EMAIL' || isOwnerEmail;

          if (shouldSendImmediately) {
            try {
              await sendEmailWithAttachments({
                to: toEmail,
                subject,
                body: emailBody,
                attachmentPaths: resolvedAttachments,
              });

              if (isOwnerEmail) {
                hasOwnerEmailAction = true;
                // For owner emails: do NOT leak personal email or full body into group chats!
              } else {
                const attachNames =
                  resolvedAttachments.length > 0
                    ? resolvedAttachments.map((p) => `\`${path.basename(p)}\``).join(', ')
                    : '_None_';

                dmNotifications.push(
                  [
                    `📧 *Email Sent to \`${toEmail}\`*`,
                    `• *Subject:* ${subject}`,
                    `• *Attachments:* ${attachNames}`,
                    ``,
                    emailBody,
                  ].join('\n')
                );
              }
            } catch (mailErr) {
              console.error(`⚠️ Failed to send email to ${toEmail}:`, mailErr.message);
              if (!isGroup) {
                dmNotifications.push(
                  `❌ *Failed to send email to \`${toEmail}\`:*\n${mailErr.message}`
                );
              }
            }
          } else {
            // Save draft to state.pendingEmailDrafts[jid] so the user can review & confirm before sending
            // Reload fresh state to avoid clobbering concurrent updates.
            const latestState = loadProjectsState();
            latestState.pendingEmailDrafts = latestState.pendingEmailDrafts || {};
            latestState.pendingEmailDrafts[jid] = {
              to: toEmail,
              subject,
              body: emailBody,
              attachments: resolvedAttachments,
              updatedAt: new Date().toISOString(),
            };
            saveProjectsState(latestState);

            const attachNames =
              resolvedAttachments.length > 0
                ? resolvedAttachments.map((p) => `\`${path.basename(p)}\``).join(', ')
                : '_None_';

            dmNotifications.push(
              [
                `📝 *Email Draft*`,
                `• *To:* \`${toEmail}\``,
                `• *Subject:* ${subject}`,
                `• *Attachments:* ${attachNames}`,
                ``,
                emailBody,
                ``,
                `_Reply *confirm* to send, swipe-reply to edit, or *cancel* to discard._`,
              ].join('\n')
            );
          }
        }
      }

      // Handle CALENDAR_EVENT directive
      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'CALENDAR_EVENT')) {
        stripDirectives.push(fullMatch);
        hasCalendarAction = true;
        const parts = payload.split('|').map((s) => s.trim());
        const title = parts[0] || 'Calendar Event';
        const startRaw = parts[1] || '';
        const endOrDuration = parts[2] || '1h';
        const description = parts[3] || '';
        const location = parts[4] || '';

        let startDate = parseCalendarDateTime(startRaw);

        let endDate;
        if (endOrDuration.endsWith('h') || endOrDuration.endsWith('hr') || endOrDuration.endsWith('hours')) {
          const hours = parseFloat(endOrDuration) || 1;
          endDate = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
        } else if (endOrDuration.endsWith('m') || endOrDuration.endsWith('min') || endOrDuration.endsWith('mins')) {
          const mins = parseFloat(endOrDuration) || 30;
          endDate = new Date(startDate.getTime() + mins * 60 * 1000);
        } else {
          const parsedEnd = endOrDuration ? new Date(endOrDuration) : null;
          endDate = parsedEnd && !isNaN(parsedEnd.getTime()) ? parsedEnd : new Date(startDate.getTime() + 60 * 60 * 1000);
        }

        const gcalUrl = buildGoogleCalendarUrl({
          title,
          start: startDate,
          end: endDate,
          description,
          location,
        });

        let inviteSynced = false;
        // 1. Direct Google Calendar API sync (seamless, zero confirmation required)
        if (googleAuth.isAuthenticated()) {
          try {
            await googleServices.createEvent({
              summary: title,
              description,
              startIso: startDate.toISOString(),
              endIso: endDate.toISOString(),
              attendees: CONFIG.ownerEmail ? [CONFIG.ownerEmail] : [],
            });
            inviteSynced = true;
          } catch (gcalErr) {
            console.warn('⚠️ Google Calendar API event creation failed:', gcalErr.message);
          }
        }

        // 2. SMTP calendar invitation fallback
        if (!inviteSynced) {
          try {
            const stateForSmtp = loadProjectsState();
            const smtpConfig = stateForSmtp.smtp || {
              host: CONFIG.smtpHost,
              port: CONFIG.smtpPort,
              user: CONFIG.smtpUser || getConnectedUserEmail(),
              pass: CONFIG.smtpPass,
            };

            if (smtpConfig.user && smtpConfig.pass && CONFIG.ownerEmail) {
              await sendCalendarInviteDirectly({
                to: CONFIG.ownerEmail,
                title,
                start: startDate,
                end: endDate,
                description,
                location,
                smtpConfig,
              });
              inviteSynced = true;
            }
          } catch (syncErr) {
            console.warn('⚠️ Direct Google Calendar invite sync failed:', syncErr.message);
          }
        }

        // Never dump .ics file attachment into WhatsApp group chats!
        // In 1-on-1 DMs, only send .ics file if direct invite sync failed as a fallback.
        if (!isGroup && !inviteSynced) {
          try {
            const icsPath = createIcsFile({
              title,
              start: startDate,
              end: endDate,
              description,
              location,
              organizerEmail: CONFIG.ownerEmail || '',
              attendeeEmail: CONFIG.ownerEmail || '',
              method: 'REQUEST',
            });

            await sendWhatsAppFile(
              sock,
              jid,
              icsPath,
              `📅 \`${path.basename(icsPath)}\``,
              msg
            );
          } catch (icsErr) {
            console.warn('⚠️ Could not send .ics attachment:', icsErr.message);
          }
        }

        // In groups, NEVER leak calendar cards or owner email into the chat!
        // In private DMs, only provide fallback link if direct sync failed
        if (!isGroup && !inviteSynced) {
          dmNotifications.push(`🔗 [Add to Google Calendar](${gcalUrl})`);
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'SHARE_LIVE_LOCATION')) {
        stripDirectives.push(fullMatch);
        const segments = payload.split('|').map((s) => s.trim());
        const targetRaw = (segments[0] || 'HERE').trim() || 'HERE';
        const hoursRaw = parseFloat((segments[1] || '8').trim()) || 8;
        const placeRaw = (segments[2] || 'AUTO').trim() || 'AUTO';

        const isHere = ['HERE', 'SELF', 'ME', 'CHAT'].includes(targetRaw.toUpperCase());
        const targetJid = isHere ? jid : resolveContactTarget(msg, targetRaw);

        if (!targetJid) {
          dmNotifications.push(
            `⚠️ Could not find contact "${targetRaw}".`
          );
          continue;
        }

        try {
          const locInfo = await startLiveLocationShare(
            sock,
            targetJid,
            hoursRaw,
            placeRaw,
            msg
          );
          const displayTarget = isHere ? 'this chat' : locInfo.targetName;
          dmNotifications.push(
            `📍 Sharing live location with *${displayTarget}* for ${locInfo.hours}h (until ${locInfo.endTimeFormatted}).`
          );
        } catch (locErr) {
          dmNotifications.push(
            `⚠️ Failed to share live location: ${locErr.message}`
          );
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'ADD_COLLABORATOR')) {
        stripDirectives.push(fullMatch);
        const segments = payload.split('|').map((s) => s.trim());
        const targetUser = (segments[0] || '').trim();
        const repoRaw = (segments[1] || 'CURRENT').trim();
        const permRaw = (segments[2] || 'push').trim();
        const isCurrent = !repoRaw || ['CURRENT', 'HERE', 'DEFAULT', 'AUTO'].includes(repoRaw.toUpperCase());
        let repoInput = isCurrent ? '' : repoRaw;
        if (repoInput && preState.projects?.[repoInput.toLowerCase()]) {
          repoInput = '';
        }
        const targetProjDir =
          repoRaw && preState.projects?.[repoRaw.toLowerCase()]
            ? preState.projects[repoRaw.toLowerCase()]
            : projectDir;

        try {
          const res = await addGitHubCollaborator({
            username: targetUser,
            permission: permRaw,
            projectDir: targetProjDir,
            repoInput,
          });
          if (res.status === 'already_collaborator') {
            dmNotifications.push(
              `✅ *@${res.username}* is already a collaborator on \`${res.owner}/${res.repo}\` (${res.permission}).`
            );
          } else {
            dmNotifications.push(
              `🤝 Invited *@${res.username}* to \`${res.owner}/${res.repo}\` (${res.permission}) — https://github.com/${res.owner}/${res.repo}/invitations`
            );
          }
        } catch (collabErr) {
          dmNotifications.push(`⚠️ Failed to add collaborator: ${collabErr.message}`);
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'REMOVE_COLLABORATOR')) {
        stripDirectives.push(fullMatch);
        const segments = payload.split('|').map((s) => s.trim());
        const targetUser = (segments[0] || '').trim();
        const repoRaw = (segments[1] || 'CURRENT').trim();
        const isCurrent = !repoRaw || ['CURRENT', 'HERE', 'DEFAULT', 'AUTO'].includes(repoRaw.toUpperCase());
        const repoInput = isCurrent ? '' : repoRaw;
        const targetProjDir =
          repoRaw && preState.projects?.[repoRaw.toLowerCase()]
            ? preState.projects[repoRaw.toLowerCase()]
            : projectDir;

        try {
          const res = await removeGitHubCollaborator({
            username: targetUser,
            projectDir: targetProjDir,
            repoInput,
          });
          dmNotifications.push(
            res.status === 'invitation_cancelled'
              ? `🗑️ Cancelled pending invitation for *@${res.username}* on \`${res.owner}/${res.repo}\`.`
              : `🗑️ Removed *@${res.username}* from \`${res.owner}/${res.repo}\`.`
          );
        } catch (collabErr) {
          dmNotifications.push(`⚠️ Failed to remove collaborator: ${collabErr.message}`);
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'LIST_COLLABORATORS')) {
        stripDirectives.push(fullMatch);
        const repoRaw = (payload || 'CURRENT').trim();
        const isCurrent = !repoRaw || ['CURRENT', 'HERE', 'DEFAULT', 'AUTO'].includes(repoRaw.toUpperCase());
        const repoInput = isCurrent ? '' : repoRaw;
        const targetProjDir =
          repoRaw && preState.projects?.[repoRaw.toLowerCase()]
            ? preState.projects[repoRaw.toLowerCase()]
            : projectDir;

        try {
          const info = await listGitHubCollaborators({
            projectDir: targetProjDir,
            repoInput,
          });
          const collabLines = info.collaborators.map(
            (c) => `• *@${c.username}* (${c.roleName})`
          );
          const invLines = info.pendingInvitations.map(
            (inv) => `• *@${inv.username}* _(pending ${inv.permission} invite)_`
          );
          dmNotifications.push(
            [
              `👥 *Collaborators on \`${info.owner}/${info.repo}\`:*`,
              collabLines.length > 0 ? collabLines.join('\n') : '_None_',
              invLines.length > 0 ? `\n⏳ *Pending Invitations:*\n${invLines.join('\n')}` : null,
            ]
              .filter(Boolean)
              .join('\n')
          );
        } catch (collabErr) {
          dmNotifications.push(`⚠️ Failed to list collaborators: ${collabErr.message}`);
        }
      }

      for (const d of stripDirectives) {
        cleanedResponse = cleanedResponse.split(d).join('');
      }
      cleanedResponse = cleanedResponse.trim();
    }

    const hadPersonalAction = hasOwnerEmailAction || hasCalendarAction;

    function isPersonalEcho(text) {
      const lower = text.toLowerCase().trim();
      if (/^(hi|hello|hey|dear)\s+[a-z0-9_-]+/i.test(lower)) return true;
      if (lower.includes('here is your google meet link') || lower.includes('here is the google meet link')) return true;
      if (lower.includes('i have sent') || lower.includes("i've sent") || lower.includes('i have drafted')) return true;
      if (lower.includes('added to your calendar') || lower.includes('scheduled on your calendar')) return true;
      if (lower.includes('calendar event') || lower.includes('email sent')) return true;
      return false;
    }

    // In group chats: If this was a personal action for the owner (email/calendar), keep it completely silent & clean.
    // Do NOT post personal greetings, meet links, or status cards to the group unless there were actual code changes.
    if (isGroup && hadPersonalAction && (!result.gitSummary || isPersonalEcho(cleanedResponse))) {
      cleanedResponse = '';
    }

    // In 1-on-1 DMs: If purely personal actions and response is a greeting/link echo, simplify to a clean one-liner.
    if (!isGroup && hadPersonalAction && !result.gitSummary && (!cleanedResponse || isPersonalEcho(cleanedResponse))) {
      if (hasOwnerEmailAction && hasCalendarAction) {
        cleanedResponse = '✅ Added to your Google Calendar and sent to your email.';
      } else if (hasCalendarAction) {
        cleanedResponse = '✅ Added to your Google Calendar.';
      } else if (hasOwnerEmailAction) {
        cleanedResponse = '✅ Sent to your email.';
      }
    }

    const replyParts = [
      cleanedResponse,
      ...dmNotifications,
    ];

    if (result.gitSummary) {
      const currentState = loadProjectsState();
      const autoPushEnabled = currentState.autoPush?.[projectAlias];

      if (autoPushEnabled) {
        try {
          const pushInfo = gitCommitAndPush(
            projectDir,
            `Auto-update via WhatsApp: ${taskPrompt.slice(0, 60)}`
          );
          replyParts.push(
            `🚀 Pushed to \`${pushInfo.branch}\` (\`${pushInfo.commitHash}\`).`
          );
        } catch (pushErr) {
          replyParts.push(
            `⚠️ Auto-push failed: ${pushErr.message}`
          );
        }
      }
    }

    await reactToMessage(sock, msg, '✅');
    const finalReply = replyParts.filter(Boolean).join('\n\n').trim();
    if (finalReply) {
      await sendReply(sock, jid, finalReply, msg);
    }
  } catch (err) {
    if (err.cancelled) {
      return;
    }
    await reactToMessage(sock, msg, '❌');
    await sendReply(
      sock,
      jid,
      `❌ ${err.message}`,
      msg
    );
  }
}

/**
 * Handles built-in slash commands.
 * Group members can ONLY run /help, /push, /status, /stop on their bound group.
 * ONLY the Owner can run /bind, /unbind, /projects, /addproject, /autopush, /msg, /dm, /send, /mailsetup, /confirm, /cancel, /livelocation, /setlocation, /stoplocation.
 */
async function handleSlashCommand(sock, jid, msg, commandBody) {
  const parts = commandBody.trim().split(/\s+/);
  let cmd = parts[0].toLowerCase();
  let arg1 = parts[1];
  let arg2 = parts.slice(2).join(' ');

  if ((cmd === '/turn' || cmd === 'turn') && arg1?.toLowerCase() === 'off') {
    cmd = '/turnoff';
    arg1 = parts[2];
    arg2 = parts.slice(3).join(' ');
  }

  if (!cmd.startsWith('/')) {
    cmd = `/${cmd}`;
  }

  const isGroup = jid.endsWith('@g.us');
  const owner = isOwner(msg);
  const state = loadProjectsState();
  const boundProject = isGroup ? state.groupBindings?.[jid] : state.activeProject;

  // Mutate the freshest state on disk (not the snapshot above) so a
  // concurrently-finishing agent task can't have its save clobbered.
  function persistFresh(mutator) {
    const fresh = loadProjectsState();
    mutator(fresh);
    saveProjectsState(fresh);
    // Keep the local snapshot consistent for any code below in this call.
    Object.assign(state, fresh);
    return fresh;
  }

  if (cmd === '/callsign' || cmd === 'callsign' || cmd === '/trigger' || cmd === 'trigger') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can change the call-sign.`, msg);
      return true;
    }
    if (!arg1) {
      await sendReply(
        sock,
        jid,
        `🏷️ *Current Weave Call-Sign:* \`${CONFIG.triggerPrefix}\`\n\nTo change it, send:\n*${CONFIG.triggerPrefix} /callsign @newname*\n*(Note: \`@agent\` is reserved so it won't conflict with your other agent)*`,
        msg
      );
      return true;
    }
    const res = updateTriggerPrefix(arg1);
    if (!res.success) {
      await sendReply(sock, jid, `⚠️ ${res.error}`, msg);
      return true;
    }
    await reactToMessage(sock, msg, '✅');
    await sendReply(
      sock,
      jid,
      `✅ *Weave Call-Sign updated to:* \`${res.triggerPrefix}\`\n\nUse *${res.triggerPrefix} <task>* to prompt this agent.`,
      msg
    );
    return true;
  }

  if (cmd === '/update' || cmd === 'update' || cmd === '/ota' || cmd === 'ota') {
    await reactToMessage(sock, msg, '⏳');
    try {
      const res = await checkAndApplyOtaUpdate({ force: arg1 === 'force' });
      await reactToMessage(sock, msg, '✅');
      if (res.updated) {
        await sendReply(
          sock,
          jid,
          `⚡ *Weave Live Update Applied*\n• *Version:* \`v${res.version}\` (\`${res.commitHash}\`)\n• *Files updated:* ${res.filesUpdated}\n• *Status:* Live in-place (no reinstall needed)`,
          msg
        );
      } else {
        const status = getOtaStatus();
        await sendReply(
          sock,
          jid,
          `✅ *Weave is up to date* (\`v${status.version}\` · \`${status.commitHash}\`)`,
          msg
        );
      }
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(sock, jid, `❌ Live update check failed: ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/help' || cmd === 'help') {
    const trig = CONFIG.triggerPrefix;
    const projLabel = boundProject ? `\`${boundProject}\`` : '_None (unbound)_';
    const helpMessage = [
      `👋 *Hi, I'm Weave!* Your natural language WhatsApp coding agent.`,
      `📍 *Current Project:* ${projLabel}`,
      '',
      `No commands needed! Just speak to me like a teammate using *${trig}* followed by plain English:`,
      '',
      `💻 *Code & Features:*`,
      `• *"${trig} add a dark mode toggle to the navbar"*`,
      `• *"${trig} fix the crash when clicking checkout"*`,
      `• *"${trig} make that button rounded and emerald green"*`,
      '',
      `📁 *Projects & Workspaces:*`,
      `• *"${trig} what projects do we have?"*`,
      `• *"${trig} switch this chat to portfolio-website"*`,
      `• *"${trig} start a new project called payment-gateway"*`,
      '',
      `📸 *Visual UI Previews:*`,
      `• *"${trig} show me what the landing page looks like on mobile"*`,
      `• *"${trig} screenshot localhost:3000"*`,
      '',
      `🚀 *Git & GitHub:*`,
      `• *"${trig} push our changes to github with message 'fixed navbar'"*`,
      `• *"${trig} invite @alex to collaborate on this repo"*`,
      '',
      `📎 *Files & Sharing:*`,
      `• *"${trig} send me package.json"*`,
      '',
      `🛑 *Control & Questions:*`,
      `• *"${trig} what are you working on right now?"*`,
      `• *"${trig} stop what you're doing"*`,
      `• *"${trig} how does JWT refresh token rotation work?"*`,
    ].join('\n');

    await sendReply(sock, jid, helpMessage, msg);
    return true;
  }

  if (cmd === '/shutdown' || cmd === 'shutdown' || cmd === '/shtudown' || cmd === 'shtudown') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can shut down the agent.`,
        msg
      );
      return true;
    }

    state.disabledGroups = state.disabledGroups || {};
    state.disabledGroups[jid] = true;
    persistFresh((fresh) => {
      fresh.disabledGroups = fresh.disabledGroups || {};
      fresh.disabledGroups[jid] = true;
    });

    // Cancel any running task or queued tasks for this group
    const active = getActiveTaskInfo();
    if (active && boundProject && active.projectAlias === boundProject) {
      stopActiveTask();
    }
    for (let i = taskQueue.length - 1; i >= 0; i--) {
      if (taskQueue[i].jid === jid) {
        taskQueue.splice(i, 1);
      }
    }

    await reactToMessage(sock, msg, '🛑');
    await sendReply(
      sock,
      jid,
      `🛑 Agent shut down in this chat. Send */wakeup* to turn it back on.`,
      msg
    );
    return true;
  }

  if (
    cmd === '/wakeup' ||
    cmd === 'wakeup' ||
    cmd === '/resume' ||
    cmd === 'resume' ||
    cmd === '/start' ||
    cmd === 'start'
  ) {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can wake up the agent.`,
        msg
      );
      return true;
    }

    if (state.disabledGroups?.[jid]) {
      persistFresh((fresh) => {
        if (fresh.disabledGroups?.[jid]) delete fresh.disabledGroups[jid];
      });
    }

    await reactToMessage(sock, msg, '🟢');
    await sendReply(
      sock,
      jid,
      `🟢 Agent online${boundProject ? ` (\`${boundProject}\`)` : ''}.`,
      msg
    );
    return true;
  }

  if (cmd === '/setlocation') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can configure location settings.`, msg);
      return true;
    }

    const rest = commandBody.trim().replace(/^\/setlocation\s*/i, '').trim();
    const quotedPin = extractLocationFromMessage(msg);

    if (!rest && !quotedPin) {
      const saved = state.savedLocation;
      await sendReply(
        sock,
        jid,
        saved
          ? `📍 Saved location: *${saved.label}* (\`${saved.lat.toFixed(5)}, ${saved.lon.toFixed(5)}\`).\nUsage: */setlocation <place or lat,lon>* or */setlocation auto*`
          : `📍 Saved location: _Auto (IP)_.\nUsage: */setlocation <place or lat,lon>* or swipe-reply to a location pin.`,
        msg
      );
      return true;
    }

    if (rest.toLowerCase() === 'auto' || rest.toLowerCase() === 'reset') {
      persistFresh((fresh) => {
        delete fresh.savedLocation;
      });
      await sendReply(
        sock,
        jid,
        `✅ Cleared saved location. Live location will now use automatic PC geolocation.`,
        msg
      );
      return true;
    }

    try {
      const loc = await resolveLocationCoordinates(rest, msg);
      persistFresh((fresh) => {
        fresh.savedLocation = loc;
      });
      await reactToMessage(sock, msg, '📍');
      await sendReply(
        sock,
        jid,
        `📍 Saved default location: *${loc.label}* (\`${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}\`).`,
        msg
      );
    } catch (err) {
      await sendReply(sock, jid, `❌ ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/stoplocation') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can stop live location shares.`, msg);
      return true;
    }
    const stopped = stopLiveLocationShare();
    if (stopped.length === 0) {
      await sendReply(sock, jid, `ℹ️ No active live location sessions are currently running.`, msg);
    } else {
      const names = stopped.map((s) => `*${s.targetName}*`).join(', ');
      await reactToMessage(sock, msg, '🛑');
      await sendReply(
        sock,
        jid,
        `🛑 Stopped sharing live location with ${names}.`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/livelocation') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can share live location.`, msg);
      return true;
    }

    const rest = commandBody.trim().replace(/^\/livelocation\s*/i, '').trim();
    if (!rest) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage: */livelocation <Contact or here> [hours]*`,
        msg
      );
      return true;
    }

    let targetStr = rest;
    let hours = 8;

    // Parse optional trailing hours (e.g. "/livelocation Mum 8" or "/livelocation The Big P : 8")
    const quoteMatch = rest.match(/^["']([^"']+)["'](?:\s+(\d+(?:\.\d+)?)h?)?$/i);
    const sepMatch = !quoteMatch && rest.match(/^([^:|]+?)\s*[:|]\s*(\d+(?:\.\d+)?)h?$/i);
    const trailingNumMatch =
      !quoteMatch && !sepMatch && rest.match(/^([\s\S]+?)\s+(\d+(?:\.\d+)?)h?$/i);

    if (quoteMatch) {
      targetStr = quoteMatch[1].trim();
      if (quoteMatch[2]) hours = parseFloat(quoteMatch[2]);
    } else if (sepMatch) {
      targetStr = sepMatch[1].trim();
      hours = parseFloat(sepMatch[2]);
    } else if (trailingNumMatch) {
      targetStr = trailingNumMatch[1].trim();
      hours = parseFloat(trailingNumMatch[2]);
    }

    const isHere = ['HERE', 'SELF', 'ME', 'CHAT'].includes(targetStr.toUpperCase());
    const targetJid = isHere ? jid : resolveContactTarget(msg, targetStr);

    if (!targetJid) {
      await sendReply(
        sock,
        jid,
        `❌ Could not find contact *"${targetStr}"*.\nTry */livelocation "${targetStr}" 8* or use their phone number.`,
        msg
      );
      return true;
    }

    await reactToMessage(sock, msg, '📍');
    try {
      const locInfo = await startLiveLocationShare(sock, targetJid, hours, '', msg);
      const displayTarget = isHere ? 'this chat' : locInfo.targetName;
      await sendReply(
        sock,
        jid,
        `📍 Sharing live location with *${displayTarget}* for ${locInfo.hours}h (until ${locInfo.endTimeFormatted}).`,
        msg
      );
    } catch (err) {
      await sendReply(sock, jid, `❌ Failed to share live location: ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/confirm' || cmd === '/sendemail') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can confirm and send emails.`, msg);
      return true;
    }

    const draft = state.pendingEmailDrafts?.[jid];
    if (!draft) {
      await sendReply(
        sock,
        jid,
        `ℹ️ No pending email draft in this chat.`,
        msg
      );
      return true;
    }

    await reactToMessage(sock, msg, '⏳');
    try {
      await sendEmailWithAttachments({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        attachmentPaths: draft.attachments || [],
      });

      delete state.pendingEmailDrafts[jid];
      persistFresh((fresh) => {
        if (fresh.pendingEmailDrafts?.[jid]) delete fresh.pendingEmailDrafts[jid];
      });

      await reactToMessage(sock, msg, '📧');
      await sendReply(
        sock,
        jid,
        `📧 Sent email to \`${draft.to}\` ("${draft.subject}").`,
        msg
      );
    } catch (mailErr) {
      if (mailErr.code === 'GMAIL_SCOPE_INSUFFICIENT') {
        const userEmail = googleAuth.getUserEmail() || getConnectedUserEmail() || 'your Google account';
        await sendReply(
          sock,
          jid,
          [
            `⚠️ *Gmail Permission Needed for ${userEmail}*`,
            ``,
            `Weave is connected to *${userEmail}*, but Google requires a one-time permission to send emails directly via your Gmail account without app passwords.`,
            ``,
            `👉 *To enable:* Run */googleauth* or open the Weave desktop app and click *Connect Google Account* to grant Gmail permission, then reply *confirm*.`,
            ``,
            `_Alternatively, you can configure an app password anytime with \`/mailsetup ${userEmail} <app-password>\`._`,
          ].join('\n'),
          msg
        );
      } else if (mailErr.code === 'SMTP_NOT_CONFIGURED') {
        const userEmail = getConnectedUserEmail() || 'your.email@gmail.com';
        await sendReply(
          sock,
          jid,
          [
            `⚠️ *Email Sending Not Configured*`,
            ``,
            `To send emails automatically without app passwords, connect your Google account via */googleauth* or in the Weave desktop app.`,
            ``,
            `_Or set up an app password directly with:_`,
            `\`/mailsetup ${userEmail} <app-password>\``,
          ].join('\n'),
          msg
        );
      } else {
        await sendReply(
          sock,
          jid,
          `❌ *Failed to send email to \`${draft.to}\`:*\n${mailErr.message}`,
          msg
        );
      }
    }
    return true;
  }

  if (cmd === '/cancel' || cmd === '/discard') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can discard email drafts.`, msg);
      return true;
    }
    const draft = state.pendingEmailDrafts?.[jid];
    if (!draft) {
      await sendReply(sock, jid, `ℹ️ No pending email draft to cancel.`, msg);
      return true;
    }
    delete state.pendingEmailDrafts[jid];
    persistFresh((fresh) => {
      if (fresh.pendingEmailDrafts?.[jid]) delete fresh.pendingEmailDrafts[jid];
    });
    await reactToMessage(sock, msg, '🗑️');
    await sendReply(
      sock,
      jid,
      `🗑️ *Email draft to \`${draft.to}\` ("${draft.subject}") has been discarded.*`,
      msg
    );
    return true;
  }

  if (cmd === '/mailsetup') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can configure email settings.`, msg);
      return true;
    }
    const currentSmtp = getSmtpConfig();
    const connectedUser = getConnectedUserEmail();

    // If the user only passed 1 argument and we have a connected Google account, assume arg1 is the app password!
    let emailUser = arg1 ? arg1.trim() : '';
    let appPass = arg2 ? arg2.replace(/\s+/g, '').trim() : '';

    if (arg1 && !arg2 && connectedUser && !arg1.includes('@')) {
      emailUser = connectedUser;
      appPass = arg1.replace(/\s+/g, '').trim();
    }

    if (!emailUser || !appPass) {
      const exampleEmail = currentSmtp.user || connectedUser || 'your.email@gmail.com';
      await sendReply(
        sock,
        jid,
        [
          `📧 *Email Provider Configuration*`,
          `• Google OAuth: ${googleAuth.isAuthenticated() ? `Connected (\`${connectedUser}\`)` : '_Not connected_'}`,
          `• SMTP: ${currentSmtp.user ? `\`${currentSmtp.user}\`` : '_Not configured_'}`,
          ``,
          `*Usage:* \`/mailsetup ${exampleEmail} <app-password>\``,
          connectedUser ? `_Or since your Google account is connected: \`/mailsetup <app-password>\`_` : '',
        ].filter(Boolean).join('\n'),
        msg
      );
      return true;
    }

    const savedSmtp = {
      host: CONFIG.smtpHost || 'smtp.gmail.com',
      port: CONFIG.smtpPort || 465,
      user: emailUser,
      pass: appPass,
    };
    persistFresh((fresh) => {
      fresh.smtp = savedSmtp;
    });

    await sendReply(
      sock,
      jid,
      `✅ SMTP configured for \`${emailUser}\`.`,
      msg
    );
    return true;
  }

  if (cmd === '/googleauth' || cmd === '/connectgoogle') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can connect Google accounts.`, msg);
      return true;
    }
    await reactToMessage(sock, msg, '⏳');
    try {
      googleAuth.startLoginFlow(
        async (authUrl) => {
          // Open in desktop browser via xdg-open / open / start
          try {
            const opener = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open');
            exec(`${opener} "${authUrl}"`, () => {});
          } catch {}

          await reactToMessage(sock, msg, '🔑');
          await sendReply(
            sock,
            jid,
            [
              `🔑 *Connect Google Account*`,
              ``,
              `Click the link below to authorize Gmail & Calendar access:`,
              authUrl,
              ``,
              `_Opening browser on host PC... Once approved, your Google account and Gmail will be connected automatically!_`,
            ].join('\n'),
            msg
          );
        }
      ).then(async (tokens) => {
        await sendReply(
          sock,
          jid,
          `✅ *Google Account Connected!*\nSigned in as *${tokens.email}*. Gmail API and Calendar are now active.`,
          msg
        );
      }).catch((err) => {
        console.warn('[bot] Google auth flow error:', err.message);
      });
    } catch (err) {
      await sendReply(sock, jid, `❌ Failed to start Google authorization flow: ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/send') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can access and send local files from the PC.`,
        msg
      );
      return true;
    }

    const rest = commandBody.trim().replace(/^\/send\s*/i, '').trim();
    if (!rest) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage:\n• */send <filename or path>* (sends the file to this chat)\n• */send <Contact Name> : <filename or path>* (sends the file to a contact)`,
        msg
      );
      return true;
    }

    const projectDir = boundProject ? state.projects?.[boundProject] : os.homedir();
    let targetJid = jid;
    let targetLabel = 'this chat';
    let fileQuery = rest;

    // 1. Quoted contact name followed by file: /send "The Big P" resume.pdf
    const quoteMatch = rest.match(/^["']([^"']+)["']\s+([\s\S]+)$/);
    // 2. Colon or pipe separator: /send The Big P : resume.pdf
    const sepMatch = !quoteMatch && rest.match(/^([^:|]+?)\s*[:|]\s*([\s\S]+)$/);

    // Avoid running the expensive recursive file search more than needed:
    // if the whole input is a file, send it here; otherwise try contact + file.
    let foundFile = findLocalFile(rest, projectDir);
    if (foundFile) {
      fileQuery = rest;
    } else if (quoteMatch || sepMatch) {
      const m = quoteMatch || sepMatch;
      const candidateTarget = m[1].trim();
      const candidateFile = m[2].trim();
      const resolvedContact = resolveContactTarget(msg, candidateTarget);
      if (resolvedContact) {
        targetJid = resolvedContact;
        const contacts = loadContactsMap();
        targetLabel = contacts[resolvedContact] || candidateTarget;
        fileQuery = candidateFile;
        foundFile = findLocalFile(fileQuery, projectDir);
      }
    }
    if (!foundFile) {
      await sendReply(
        sock,
        jid,
        `❌ File not found: \`${fileQuery}\``,
        msg
      );
      return true;
    }

    try {
      await reactToMessage(sock, msg, '📎');
      await sendWhatsAppFile(
        sock,
        targetJid,
        foundFile,
        `📎 \`${path.basename(foundFile)}\``,
        targetJid === jid ? msg : undefined
      );
      if (targetJid !== jid) {
        await sendReply(
          sock,
          jid,
          `📎 Sent \`${path.basename(foundFile)}\` to *${targetLabel}*.`,
          msg
        );
      }
    } catch (err) {
      await sendReply(
        sock,
        jid,
        `❌ Failed to send file \`${foundFile}\`: ${err.message}`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/msg' || cmd === '/dm') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can send messages to contacts.`,
        msg
      );
      return true;
    }

    const rest = commandBody.trim().replace(/^\/(msg|dm)\s*/i, '').trim();
    if (!rest) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage: */msg <Contact or Number> : <message>*`,
        msg
      );
      return true;
    }

    let targetStr = '';
    let messageText = '';

    // 1. Quoted contact name: /msg "The Big P" hi
    const quoteMatch = rest.match(/^["']([^"']+)["']\s+([\s\S]+)$/);
    // 2. Colon or pipe separator: /msg The Big P : hi
    const sepMatch = !quoteMatch && rest.match(/^([^:|]+?)\s*[:|]\s*([\s\S]+)$/);

    if (quoteMatch) {
      targetStr = quoteMatch[1].trim();
      messageText = quoteMatch[2].trim();
    } else if (sepMatch) {
      targetStr = sepMatch[1].trim();
      messageText = sepMatch[2].trim();
    } else {
      // 3. Unquoted multi-word matching: test longest prefix down to 1 word against known contacts
      const words = rest.split(/\s+/);
      if (words.length < 2) {
        await sendReply(
          sock,
          jid,
          `⚠️ Please include both a contact and a message (e.g. */msg "The Big P" hi* or */msg The Big P : hi*).`,
          msg
        );
        return true;
      }

      let matchedJid = null;
      // Pass 1: Exact contact name match (longest prefix first)
      for (let i = words.length - 1; i >= 1; i--) {
        const candidateName = words.slice(0, i).join(' ');
        const resolved = resolveContactTarget(msg, candidateName, { exactOnly: true });
        if (resolved) {
          targetStr = candidateName;
          messageText = words.slice(i).join(' ');
          matchedJid = resolved;
          break;
        }
      }
      // Pass 2: Partial contact name match (longest prefix first)
      if (!matchedJid) {
        for (let i = words.length - 1; i >= 1; i--) {
          const candidateName = words.slice(0, i).join(' ');
          const resolved = resolveContactTarget(msg, candidateName, { exactOnly: false });
          if (resolved) {
            targetStr = candidateName;
            messageText = words.slice(i).join(' ');
            matchedJid = resolved;
            break;
          }
        }
      }

      if (!matchedJid) {
        await sendReply(
          sock,
          jid,
          `❌ Could not match contact in "${rest}". Try */msg Name : message*.`,
          msg
        );
        return true;
      }
    }

    if (!messageText) {
      await sendReply(
        sock,
        jid,
        `⚠️ Please include a message to send (e.g. */msg "${targetStr}" hi*).`,
        msg
      );
      return true;
    }

    const targetJid = resolveContactTarget(msg, targetStr);
    if (!targetJid) {
      await sendReply(
        sock,
        jid,
        `❌ Contact "${targetStr}" not found. Tag them or use their phone number.`,
        msg
      );
      return true;
    }

    try {
      const formattedMessage = formatAgentMessage(messageText);
      const sentDm = await sock.sendMessage(targetJid, { text: formattedMessage });
      if (sentDm?.key?.id) recordSentMessageId(sentDm.key.id);
      const contacts = loadContactsMap();
      const displayTarget = contacts[targetJid] || targetStr;
      await reactToMessage(sock, msg, '📨');
      await sendReply(
        sock,
        jid,
        `📨 Sent to *${displayTarget}*: "${messageText}"`,
        msg
      );
    } catch (err) {
      await sendReply(
        sock,
        jid,
        `❌ Failed to message \`${targetStr}\`: ${err.message}`,
        msg
      );
    }
    return true;
  }

  // --- GITHUB COLLABORATOR MANAGEMENT (/collab, /removecollab, /collabs) ---
  if (
    [
      '/collab',
      '/addcollab',
      '/collaborator',
      '/addcollaborator',
      '/invite',
      '/removecollab',
      '/uncollab',
      '/removeinvite',
      '/collabs',
      '/collaborators',
    ].includes(cmd)
  ) {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can manage GitHub collaborators.`,
        msg
      );
      return true;
    }

    const resolveTargetRepoAndDir = (repoArg) => {
      if (repoArg) {
        const aliasKey = repoArg.toLowerCase();
        if (state.projects?.[repoArg]) {
          return { projectDir: state.projects[repoArg], repoInput: '' };
        }
        if (state.projects?.[aliasKey]) {
          return { projectDir: state.projects[aliasKey], repoInput: '' };
        }
        return {
          projectDir: boundProject ? state.projects?.[boundProject] : '',
          repoInput: repoArg,
        };
      }
      return {
        projectDir: boundProject ? state.projects?.[boundProject] : '',
        repoInput: '',
      };
    };

    if (cmd === '/collabs' || cmd === '/collaborators') {
      const { projectDir: targetProjDir, repoInput } = resolveTargetRepoAndDir(arg1);
      await reactToMessage(sock, msg, '⏳');
      try {
        const info = await listGitHubCollaborators({
          projectDir: targetProjDir,
          repoInput,
        });
        const collabLines = info.collaborators.map(
          (c) => `• *@${c.username}* (${c.roleName})`
        );
        const invLines = info.pendingInvitations.map(
          (inv) => `• *@${inv.username}* _(pending ${inv.permission} invite)_`
        );
        await reactToMessage(sock, msg, '✅');
        await sendReply(
          sock,
          jid,
          [
            `👥 *Collaborators on \`${info.owner}/${info.repo}\`:*`,
            collabLines.length > 0 ? collabLines.join('\n') : '_None_',
            invLines.length > 0
              ? `\n⏳ *Pending Invitations:*\n${invLines.join('\n')}`
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
          msg
        );
      } catch (err) {
        await reactToMessage(sock, msg, '❌');
        await sendReply(sock, jid, `❌ ${err.message}`, msg);
      }
      return true;
    }

    if (['/removecollab', '/uncollab', '/removeinvite'].includes(cmd)) {
      if (!arg1) {
        await sendReply(
          sock,
          jid,
          `⚠️ Usage: */removecollab <github-username> [repo-or-project]*`,
          msg
        );
        return true;
      }
      const { projectDir: targetProjDir, repoInput } = resolveTargetRepoAndDir(
        parts[2] || ''
      );
      await reactToMessage(sock, msg, '⏳');
      try {
        const res = await removeGitHubCollaborator({
          username: arg1,
          projectDir: targetProjDir,
          repoInput,
        });
        await reactToMessage(sock, msg, '🗑️');
        await sendReply(
          sock,
          jid,
          res.status === 'invitation_cancelled'
            ? `🗑️ Cancelled pending invitation for *@${res.username}* on \`${res.owner}/${res.repo}\`.`
            : `🗑️ Removed *@${res.username}* from \`${res.owner}/${res.repo}\`.`,
          msg
        );
      } catch (err) {
        await reactToMessage(sock, msg, '❌');
        await sendReply(sock, jid, `❌ ${err.message}`, msg);
      }
      return true;
    }

    // Otherwise: /collab, /addcollab, /collaborator, /addcollaborator, /invite
    if (!arg1) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage: */collab <github-username> [repo-or-project] [read|write|admin]*`,
        msg
      );
      return true;
    }

    const permKeywords = new Set([
      'read',
      'pull',
      'view',
      'triage',
      'write',
      'push',
      'maintain',
      'maintainer',
      'admin',
      'owner',
    ]);
    let repoArg = '';
    let permArg = 'push';
    let notifyEmail = '';

    for (const token of parts.slice(2)) {
      const cleanedToken = token.replace(/^[,;()]+|[,;()]+$/g, '');
      if (!cleanedToken) continue;
      if (cleanedToken.includes('@') && cleanedToken.includes('.')) {
        notifyEmail = cleanedToken;
      } else if (permKeywords.has(cleanedToken.toLowerCase())) {
        permArg = cleanedToken.toLowerCase();
      } else if (!repoArg) {
        repoArg = cleanedToken;
      }
    }

    const { projectDir: targetProjDir, repoInput } = resolveTargetRepoAndDir(repoArg);
    await reactToMessage(sock, msg, '⏳');
    try {
      const res = await addGitHubCollaborator({
        username: arg1,
        permission: permArg,
        projectDir: targetProjDir,
        repoInput,
      });
      const invLink = `https://github.com/${res.owner}/${res.repo}/invitations`;
      let emailNotice = '';
      if (notifyEmail) {
        try {
          const smtp = getSmtpConfig();
          if (smtp.user && smtp.pass) {
            await sendEmailWithAttachments({
              to: notifyEmail,
              subject: `GitHub Collaborator Invitation: ${res.owner}/${res.repo}`,
              body: `Hi @${res.username},\n\nYou have been invited as a collaborator (${res.permission} access) on the GitHub repository ${res.owner}/${res.repo}.\n\nAccept your invitation here:\n${invLink}\n\nRepository URL:\nhttps://github.com/${res.owner}/${res.repo}`,
              attachmentPaths: [],
            });
            emailNotice = `\n📧 Sent invite link to \`${notifyEmail}\`.`;
          }
        } catch {
          // Ignore optional email notification errors
        }
      }
      await reactToMessage(sock, msg, '🤝');
      await sendReply(
        sock,
        jid,
        res.status === 'already_collaborator'
          ? `✅ *@${res.username}* is already a collaborator on \`${res.owner}/${res.repo}\` (${res.permission}).${emailNotice}`
          : `🤝 Invited *@${res.username}* to \`${res.owner}/${res.repo}\` (${res.permission}) — ${invLink}${emailNotice}`,
        msg
      );
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(sock, jid, `❌ ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/screenshot' || cmd === '/ss' || cmd === '/qa') {
    let rawTarget = parts.slice(1).join(' ').trim();
    const isMobile = rawTarget.toLowerCase().includes('mobile') || parts.includes('--mobile');
    rawTarget = rawTarget.replace(/--mobile|\bmobile\b/gi, '').trim();

    const currentState = loadProjectsState();
    const activeProj = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
    const projDir = (activeProj && currentState.projects?.[activeProj]) || CONFIG.defaultProjectDir;

    let cleanedTarget = rawTarget;
    if (!cleanedTarget) {
      cleanedTarget = (await getProjectDeploymentUrl(projDir, activeProj)) || 'http://localhost:3000';
    }

    await reactToMessage(sock, msg, '📸');
    try {
      const { filePath, url, width, height } = await captureWebScreenshot(cleanedTarget, {
        mobile: isMobile,
      });
      const projectLabel = activeProj ? `\n📁 *Project:* \`${activeProj}\`` : '';
      await sendWhatsAppFile(
        sock,
        jid,
        filePath,
        `📸 *Visual QA Screenshot*${projectLabel}\n🌐 *URL:* ${url}\n📐 *Resolution:* ${width}x${height}${isMobile ? ' (Mobile)' : ''}`,
        msg
      );
      await reactToMessage(sock, msg, '✅');
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(
        sock,
        jid,
        `❌ *Screenshot Failed:*\n${err.message}`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/push') {
    if (!boundProject || !state.projects[boundProject]) {
      await sendReply(sock, jid, `⚠️ No project bound to this chat.`, msg);
      return true;
    }
    const commitMsg =
      parts.slice(1).join(' ').trim() || 'Update via WhatsApp Agent';
    await reactToMessage(sock, msg, '⏳');
    try {
      const info = gitCommitAndPush(state.projects[boundProject], commitMsg);
      await reactToMessage(sock, msg, '🚀');
      await sendReply(
        sock,
        jid,
        `🚀 Pushed \`${boundProject}\` to \`${info.branch}\` (\`${info.commitHash}\`).`,
        msg
      );
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(
        sock,
        jid,
        `❌ *Git Push Failed on \`${boundProject}\`:*\n${err.message}`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/autopush') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can toggle auto-push.`,
        msg
      );
      return true;
    }
    if (!boundProject || !state.projects[boundProject]) {
      await sendReply(sock, jid, `⚠️ No project bound to this chat. Bind one first with */bind <project>*.`, msg);
      return true;
    }
    const enable = arg1?.toLowerCase() !== 'off';
    persistFresh((fresh) => {
      fresh.autoPush = fresh.autoPush || {};
      fresh.autoPush[boundProject] = enable;
    });
    await sendReply(
      sock,
      jid,
      `🚀 Auto-push to GitHub for *${boundProject}* is now *${enable ? 'ON' : 'OFF'}*.`,
      msg
    );
    return true;
  }

  // --- PROJECT MANAGEMENT COMMANDS (/bind, /unbind, /turnoff, /projects, /project, /addproject) ---
  if (
    ['/bind', '/unbind', '/turnoff', '/projects', '/project', '/addproject'].includes(cmd)
  ) {
    if (cmd === '/addproject') {
      if (!owner) {
        await sendReply(
          sock,
          jid,
          `🔒 Only the bot owner can add new project folders.`,
          msg
        );
        return true;
      }
    } else if (cmd !== '/projects') {
      if (!owner) {
        await sendReply(
          sock,
          jid,
          `Only the owner can do that.`,
          msg
        );
        return true;
      }
    }

    if (cmd === '/projects') {
      const projectEntries = Object.entries(state.projects || {});
      if (projectEntries.length === 0) {
        await sendReply(sock, jid, `📂 *Projects:*\nNo projects registered yet.`, msg);
        return true;
      }

      if (isGroup) {
        const boundAlias = state.groupBindings?.[jid] || null;
        const hasBound = Boolean(boundAlias && state.projects[boundAlias]);

        const lines = projectEntries.map(([alias, dir]) => {
          const isCurrentGroupActive =
            hasBound && alias.toLowerCase() === boundAlias.toLowerCase();
          if (isCurrentGroupActive) {
            return `• 🟢 *${alias}* [ON / ACTIVE] → \`${dir}\``;
          } else {
            return `• ⚪ *${alias}* [OFF] → \`${dir}\``;
          }
        });

        let reply = `📂 *Projects for this Group:*\n`;
        if (hasBound) {
          reply += `🟢 *Active project:* \`${boundAlias}\` (strictly 1 active)\n\n`;
        } else {
          reply += `⚪ *Active project:* _None currently active_ (all available)\n\n`;
        }
        reply += lines.join('\n');
        reply += `\n\n💡 *Group Project Controls:*\n`;
        reply += `• Turn ON / Switch: *${CONFIG.triggerPrefix} /project <alias>* (or */bind <alias>*)\n`;
        reply += `• Turn OFF: *${CONFIG.triggerPrefix} /unbind* (or */turnoff*)`;

        await sendReply(sock, jid, reply, msg);
        return true;
      } else {
        const active = state.activeProject;
        const lines = projectEntries.map(([alias, dir]) => {
          const isActive = alias.toLowerCase() === (active || '').toLowerCase();
          return isActive
            ? `• 🟢 *${alias}* [ACTIVE] → \`${dir}\``
            : `• ⚪ *${alias}* → \`${dir}\``;
        });

        let reply = `📂 *Available Projects:*\n`;
        reply += `🟢 *Global Active:* \`${active}\`\n\n`;
        reply += lines.join('\n');
        reply += `\n\n💡 Switch active project: *${CONFIG.triggerPrefix} /project <alias>*`;

        await sendReply(sock, jid, reply, msg);
        return true;
      }
    }

    if (cmd === '/bind' || cmd === '/project') {
      if (!arg1) {
        await sendReply(
          sock,
          jid,
          `⚠️ Usage: *${CONFIG.triggerPrefix} ${cmd} <project-alias>*\nExample: *${CONFIG.triggerPrefix} ${cmd} demo*`,
          msg
        );
        return true;
      }
      const key = arg1.toLowerCase();
      const matchedAlias = Object.keys(state.projects || {}).find(
        (k) => k.toLowerCase() === key
      );

      if (!matchedAlias) {
        await sendReply(
          sock,
          jid,
          `❌ Project \`${arg1}\` not found.\nSend *${CONFIG.triggerPrefix} /projects* to see available projects, or *${CONFIG.triggerPrefix} /addproject ${arg1} ~/path/to/folder*.`,
          msg
        );
        return true;
      }

      if (isGroup) {
        const oldProject = state.groupBindings?.[jid] || null;

        state.groupBindings = state.groupBindings || {};
        state.groupBindings[jid] = matchedAlias;
        if (state.disabledGroups?.[jid]) {
          delete state.disabledGroups[jid];
        }

        persistFresh((fresh) => {
          fresh.groupBindings = fresh.groupBindings || {};
          fresh.groupBindings[jid] = matchedAlias;
          if (fresh.disabledGroups?.[jid]) delete fresh.disabledGroups[jid];
        });

        if (oldProject && oldProject.toLowerCase() !== matchedAlias.toLowerCase()) {
          await sendReply(
            sock,
            jid,
            `🔄 Switched active project in this group from \`${oldProject}\` to \`${matchedAlias}\`.`,
            msg
          );
        } else if (oldProject && oldProject.toLowerCase() === matchedAlias.toLowerCase()) {
          await sendReply(
            sock,
            jid,
            `ℹ️ Project \`${matchedAlias}\` is already active in this group.`,
            msg
          );
        } else {
          await sendReply(
            sock,
            jid,
            `🔒 Bound this group to \`${matchedAlias}\` (turned ON).`,
            msg
          );
        }
        return true;
      } else {
        const oldActive = state.activeProject;
        persistFresh((fresh) => {
          fresh.activeProject = matchedAlias;
        });
        if (oldActive && oldActive.toLowerCase() !== matchedAlias.toLowerCase()) {
          await sendReply(
            sock,
            jid,
            `🔄 Switched active project from \`${oldActive}\` to \`${matchedAlias}\`.`,
            msg
          );
        } else {
          await sendReply(
            sock,
            jid,
            `✅ Active project is \`${matchedAlias}\`.`,
            msg
          );
        }
        return true;
      }
    }

    if (cmd === '/unbind' || cmd === '/turnoff') {
      if (isGroup || state.groupBindings?.[jid]) {
        if (state.groupBindings?.[jid]) {
          const prev = state.groupBindings[jid];
          state.groupBindings = state.groupBindings || {};
          delete state.groupBindings[jid];
          persistFresh((fresh) => {
            if (fresh.groupBindings?.[jid]) delete fresh.groupBindings[jid];
          });
          await sendReply(
            sock,
            jid,
            `🔓 Turned OFF active project for this group (was \`${prev}\`).`,
            msg
          );
        } else {
          await sendReply(
            sock,
            jid,
            `ℹ️ No active project is currently turned ON in this group.`,
            msg
          );
        }
      } else {
        await sendReply(
          sock,
          jid,
          `ℹ️ Project unbinding only applies to groups. Global active project: \`${state.activeProject}\`.`,
          msg
        );
      }
      return true;
    }

    if (cmd === '/addproject') {
      if (!arg1 || !arg2) {
        await sendReply(
          sock,
          jid,
          `⚠️ Usage: *${CONFIG.triggerPrefix} /addproject <alias> <path>*`,
          msg
        );
        return true;
      }
      const resolvedPath = arg2.startsWith('~')
        ? path.join(os.homedir(), arg2.slice(1))
        : path.resolve(ROOT_DIR, arg2);

      let isDir = false;
      try {
        isDir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) {
        await sendReply(
          sock,
          jid,
          `❌ Directory does not exist: \`${resolvedPath}\``,
          msg
        );
        return true;
      }

      const alias = arg1.toLowerCase();
      persistFresh((fresh) => {
        fresh.projects = fresh.projects || {};
        fresh.projects[alias] = resolvedPath;
      });

      await sendReply(
        sock,
        jid,
        `✅ Registered *${alias}* → \`${resolvedPath}\`.`,
        msg
      );
      return true;
    }
  }

  if (cmd === '/status') {
    const active = getActiveTaskInfo();
    if (!active) {
      await sendReply(
        sock,
        jid,
        `🟢 Idle (Queued: ${taskQueue.length})`,
        msg
      );
    } else {
      await sendReply(
        sock,
        jid,
        `🟡 Busy on \`${active.projectAlias}\`: "${active.taskPrompt}" (Queued: ${taskQueue.length})`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/stop') {
    const quotedId = getQuotedStanzaId(msg);

    // 1. If the user swipe-replied "stop" to a specific queued task message, remove that queued task!
    if (quotedId) {
      const qIdx = taskQueue.findIndex((item) => item.msg?.key?.id === quotedId);
      if (qIdx !== -1) {
        const [removed] = taskQueue.splice(qIdx, 1);
        await reactToMessage(sock, msg, '🛑');
        await reactToMessage(sock, removed.msg, '🛑');
        await sendReply(sock, jid, `🛑 Cancelled queued task.`, msg);
        return true;
      }
    }

    const active = getActiveTaskInfo();
    const runningItem = currentRunningItem;

    // Only allow stopping if owner OR if the running task belongs to this group's bound project
    if (active && !owner && isGroup && active.projectAlias !== boundProject) {
      await sendReply(
        sock,
        jid,
        `🔒 Cannot stop a task running for another group.`,
        msg
      );
      return true;
    }

    if (runningItem && !owner && isGroup && runningItem.jid !== jid && runningItem.projectAlias !== boundProject) {
      await sendReply(
        sock,
        jid,
        `🔒 Cannot stop a task running for another group.`,
        msg
      );
      return true;
    }

    let stoppedSomething = false;

    if (runningItem) {
      runningItem.cancelled = true;
      stoppedSomething = true;
    }

    const stopped = stopActiveTask();
    if (stopped) {
      stoppedSomething = true;
    }

    if (stoppedSomething) {
      await reactToMessage(sock, msg, '🛑');
      if (runningItem?.msg) {
        await reactToMessage(sock, runningItem.msg, '🛑');
      }
      await sendReply(
        sock,
        jid,
        `🛑 Stopped task.`,
        msg
      );
      return true;
    }

    // If no active task was running, check if there are any queued tasks for this chat to cancel
    const queuedIdx = taskQueue.findIndex(
      (item) => item.jid === jid || (owner && !isGroup)
    );
    if (queuedIdx !== -1) {
      const [removed] = taskQueue.splice(queuedIdx, 1);
      await reactToMessage(sock, msg, '🛑');
      if (removed.msg) {
        await reactToMessage(sock, removed.msg, '🛑');
      }
      await sendReply(sock, jid, `🛑 Cancelled queued task.`, msg);
      return true;
    }

    await sendReply(sock, jid, `ℹ️ No task is currently running.`, msg);
    return true;
  }

  // --- /btw: Quick direct LLM query without polluting AGY workspace / conversation ---
  if (cmd === '/btw' || cmd === 'btw') {
    const query = parts.slice(1).join(' ').trim();
    if (!query) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage: *${CONFIG.triggerPrefix} /btw <question>*\nAnswers via Gemini directly without sending commands to your Antigravity session.`,
        msg
      );
      return true;
    }

    await reactToMessage(sock, msg, '💬');
    try {
      const currentState = loadProjectsState();
      const activeProj = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
      const projDir = (activeProj && currentState.projects?.[activeProj]) || CONFIG.defaultProjectDir;
      const recentChatContext = getRecentChatContext(jid);

      const systemPrompt = [
        `You are Weave's conversational assistant, responding to a user query without performing filesystem edits or terminal execution.`,
        activeProj ? `Active Project: ${activeProj} (${projDir})` : null,
        recentChatContext ? `Recent Chat Context:\n${recentChatContext}` : null,
        `Provide a concise, helpful answer formatted for WhatsApp (*bold*, _italic_, \`code\`).`,
      ].filter(Boolean).join('\n\n');

      const { text } = await geminiClient.generateContent(query, systemPrompt);
      const cleanAnswer = (text || 'No response generated.').replace(/\[([^\]]+)\]\(file:\/\/[^)]+\)/g, '`$1`').trim();

      await sendReply(
        sock,
        jid,
        `💬 *[Direct Gemini]*\n\n${cleanAnswer}`,
        msg
      );
      await reactToMessage(sock, msg, '✅');
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(
        sock,
        jid,
        `❌ Gemini Error: ${err.message}`,
        msg
      );
    }
    return true;
  }

  // --- /new: Clear persistent conversation ID for current project ---
  if (cmd === '/new') {
    const currentState = loadProjectsState();
    const activeProj = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
    if (activeProj && currentState.conversations?.[activeProj]) {
      persistFresh((fresh) => {
        if (fresh.conversations?.[activeProj]) {
          delete fresh.conversations[activeProj];
        }
      });
      await reactToMessage(sock, msg, '🧹');
      await sendReply(
        sock,
        jid,
        `🧹 Cleared Antigravity session memory for *${activeProj}*. Next prompt will start fresh!`,
        msg
      );
    } else {
      await sendReply(
        sock,
        jid,
        `ℹ️ No previous conversation stored for *${activeProj || 'active project'}*.`,
        msg
      );
    }
    return true;
  }

  return false;
}

let activeSock = null;
let reconnectTimer = null;
let isStartingBot = false;
let BOT_START_TIME_SEC = Math.floor(Date.now() / 1000);
let serverTimeOffsetSec = 0;
let hasCalibratedClock = false;

async function syncNetworkClock() {
  try {
    const res = await fetch('https://web.whatsapp.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    const dateHeader = res.headers.get('date');
    if (dateHeader) {
      const networkTimeSec = Math.floor(new Date(dateHeader).getTime() / 1000);
      const diff = Math.floor(Date.now() / 1000) - networkTimeSec;
      if (Math.abs(diff) < 300) {
        serverTimeOffsetSec = diff;
        hasCalibratedClock = true;
        if (Math.abs(serverTimeOffsetSec) > 5) {
          console.log(
            `⏱️ Clock sync: Detected ${serverTimeOffsetSec}s skew between PC and WhatsApp server. Calibrated.`
          );
        }
      }
    }
  } catch {
    // Dynamic fallback on message arrival will calibrate if within reasonable bounds
  }
}

/**
 * Starts the Baileys WhatsApp client and listens for group/direct messages.
 */
export async function startWhatsAppBot() {
  if (isStartingBot) return;
  isStartingBot = true;

  BOT_START_TIME_SEC = Math.floor(Date.now() / 1000);
  syncNetworkClock().catch(() => {});
  purgeClosedSessions();

  if (activeSock) {
    try { activeSock.ev.removeAllListeners(); } catch {}
    try {
      if (typeof activeSock.end === 'function') {
        activeSock.end(undefined);
      } else {
        activeSock.ws?.close();
      }
    } catch {}
    activeSock = null;
  }

  let sock;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const baileysLogger = pino({ level: 'warn' });

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      msgRetryCounterCache: retryCacheStore,
      logger: baileysLogger,
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      defaultQueryTimeoutMs: 60000,
      getMessage: async (key) => {
        if (!key?.id) return undefined;
        return getRawMessage(key.id) || undefined;
      },
    });
    activeSock = sock;

    if (CONFIG.pairingPhoneNumber && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(CONFIG.pairingPhoneNumber);
          console.log(`\n========================================`);
          console.log(`🔑 WHATSAPP PAIRING CODE: ${code}`);
          console.log(`========================================\n`);
        } catch (err) {
          console.error('Failed to request pairing code:', err.message);
        }
      }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('contacts.upsert', (contacts) => saveContactsList(contacts));
    sock.ev.on('contacts.update', (contacts) => saveContactsList(contacts));
    sock.ev.on('chats.upsert', (chats) => saveContactsList(chats));
    sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
      if (contacts) saveContactsList(contacts);
      if (chats) saveContactsList(chats);
    });

    let acceptMessagesAfter = Date.now() + 3000;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n📱 Scan this QR code with WhatsApp (Linked Devices -> Link a Device):\n');
        qrcode.generate(qr, { small: true });
        const qrPath = path.join(DATA_DIR, 'whatsapp-qr.png');
        QRCodeImage.toFile(qrPath, qr, { width: 400, margin: 2 }).catch(() => {});
        QRCodeImage.toDataURL(qr, { width: 300, margin: 2 })
          .then((dataUrl) => {
            botEvents.emit('qr', { qr, dataUrl, qrPath });
          })
          .catch(() => {
            botEvents.emit('qr', { qr, qrPath });
          });
        botEvents.emit('connection', { status: 'qr_ready', qr });
        console.log(`🖼️ QR Code image generated at: ${qrPath}`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        botEvents.emit('connection', { status: 'disconnected', statusCode, shouldReconnect });
        console.log(
          `⚠️ Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`
        );

        if (activeSock === sock) {
          try { sock.ev.removeAllListeners(); } catch {}
          try {
            if (typeof sock.end === 'function') {
              sock.end(undefined);
            } else {
              sock.ws?.close();
            }
          } catch {}
          activeSock = null;
        }

        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (shouldReconnect) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startWhatsAppBot();
          }, 3500);
        } else {
          console.log(
            `🔄 Session logged out (401). Backing up '${AUTH_DIR}' and generating a fresh QR code...`
          );
          try {
            if (fs.existsSync(AUTH_DIR)) {
              const backupDir = `${AUTH_DIR}.backup-${Date.now()}`;
              fs.renameSync(AUTH_DIR, backupDir);
              console.log(`📦 Archived logged out session to ${backupDir}`);
            }
          } catch {}
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startWhatsAppBot();
          }, 1500);
        }
      } else if (connection === 'open') {
        botEvents.emit('connection', { status: 'connected', user: sock.user });
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        acceptMessagesAfter = Date.now() + 3000;
        const projState = loadProjectsState();
        const boundCount = Object.keys(projState.groupBindings || {}).length;
        console.log('\n========================================');
        console.log('✅ WhatsApp Antigravity Agent is ONLINE!');
        console.log(`📣 Trigger Prefix : ${CONFIG.triggerPrefix}`);
        console.log(`🔒 Bound Groups   : ${boundCount} group(s)`);
        console.log('========================================\n');
        console.log(
          `💡 Go to any project group and send "${CONFIG.triggerPrefix} /bind <project-name>" to lock that group to its project!\n`
        );

        // Fetch group names for bound & initialized groups
        setTimeout(async () => {
          try {
            const allBound = Object.keys(projState.groupBindings || {});
            const allInit = Object.keys(projState.initializedGroups || {});
            const groupJids = Array.from(new Set([...allBound, ...allInit]));
            for (const gjid of groupJids) {
              try {
                const meta = await sock.groupMetadata(gjid);
                if (meta?.subject) {
                  setGroupName(gjid, meta.subject);
                  console.log(`🏷️ Discovered group name for ${gjid}: "${meta.subject}"`);
                }
                if (Array.isArray(meta?.participants)) {
                  const discovered = [];
                  for (const p of meta.participants) {
                    if (p.jid && p.lid) {
                      discovered.push({ id: p.jid, lid: p.lid });
                    }
                  }
                  if (discovered.length > 0) saveContactsList(discovered);
                }
              } catch {}
            }
          } catch {}
        }, 2000);

        // Ensure server has sufficient pre-keys without blowing away existing ratchet state
        try {
          await sock.uploadPreKeysToServerIfRequired();
          console.log('🔑 Verified & uploaded pre-keys if required');
        } catch (err) {
          console.warn('⚠️ Pre-key verification note:', err?.message || err);
        }
        prewarmAllBoundProjects();
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(`📡 [RAW UPSERT] received ${messages?.length || 0} message(s), type=${type}`);
      if (type !== 'notify' && type !== 'append') return;

      const nowSec = Math.floor(Date.now() / 1000);

      for (const msg of messages) {
        try {
          // If Baileys could not decrypt this message (CIPHERTEXT / Bad MAC), automatically trigger session healing
          if (!msg.message && (msg.messageStubType || msg.messageStubParameters)) {
            const errParam = (msg.messageStubParameters || []).join(' ');
            const author = msg.key?.participant || msg.key?.remoteJid;
            console.warn(`⚠️ [Decryption Failure Intercepted] stubType=${msg.messageStubType} err="${errParam}" from ${author}`);
            if (author) {
              healCorruptedSession(msg.key?.remoteJid, author);
            }
          }

          await handleIncomingMessage(sock, msg, type, nowSec, acceptMessagesAfter);
        } catch (err) {
          console.error('⚠️ Error handling WhatsApp message:', err?.message || err);
        }
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const item of updates) {
        try {
          const pollVote = await handlePollVote(sock, item);
          if (pollVote?.resolved) {
            await handleVoteResolution(sock, pollVote);
          }
        } catch (err) {
          console.error('⚠️ Error handling message update:', err?.message || err);
        }
      }
    });
  } finally {
    isStartingBot = false;
  }
}

async function handleVoteResolution(sock, voteRes) {
  const { chosenOption, pending, voterJid, groupJid } = voteRes;
  console.log(`🗳️ Handling vote resolution: option="${chosenOption}" context="${pending.context}" group="${groupJid}"`);

  if (pending.context === 'switch_project') {
    const isVoterOwner = isOwner({ key: { participant: voterJid, remoteJid: groupJid, fromMe: false } });
    if (!isVoterOwner) {
      await sendReply(sock, groupJid, "Only the owner can do that.");
      return;
    }
    try {
      const res = switchGroupProject(chosenOption, groupJid);
      await sendReply(sock, groupJid, TEMPLATES.switch_project({ projectName: res.alias }));
    } catch (err) {
      await sendReply(sock, groupJid, `⚠️ Couldn't switch project: ${err.message}`);
    }
    return;
  }

  if (pending.context === 'website_vibe_choice') {
    const cleanVibe = chosenOption.replace(/^[0-9️⃣\s]+/, '').trim();
    await sendReply(sock, groupJid, `Got it: "${cleanVibe}" aesthetic locked in! Tuning the design tokens 🎨`);
    const state = loadProjectsState();
    state.portfolioSessions = state.portfolioSessions || {};
    if (!state.portfolioSessions[groupJid]) {
      state.portfolioSessions[groupJid] = {};
    }
    state.portfolioSessions[groupJid].preferredVibe = cleanVibe;
    saveProjectsState(state);
    return;
  }

  // Choice resolution: check if the choice or context is activating/switching a project
  const state = loadProjectsState();
  let activeAlias = getGroupActiveProject(groupJid) || state.activeProject;
  
  // If no project is bound to this group or the context/option is a known project, activate it!
  const isProjectChoice =
    pending.context === 'activate_project_for_task' ||
    pending.context === 'switch_project' ||
    (pending.context && pending.context.toLowerCase().includes('project')) ||
    (!activeAlias && (state.projects?.[chosenOption] || fs.existsSync(path.join(state.masterDir || '', chosenOption))));

  if (isProjectChoice) {
    try {
      const res = switchGroupProject(chosenOption, groupJid);
      activeAlias = res.alias;
      console.log(`🚀 Switched/activated group ${groupJid} to project "${activeAlias}" via vote resolution.`);
      await sendReply(sock, groupJid, `activated "${activeAlias}". on it 🫡`);
      
      const updatedState = loadProjectsState();
      const projectDir = updatedState.projects[activeAlias] || res.path;
      const syntheticMsg = {
        key: {
          remoteJid: groupJid,
          fromMe: false,
          id: `vote_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        },
        message: {
          conversation: pending.originalTask || `Work on ${activeAlias}`,
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      };
      taskQueue.push({
        jid: groupJid,
        msg: syntheticMsg,
        projectAlias: activeAlias,
        projectDir,
        taskPrompt: pending.originalTask || `Work on ${activeAlias}`,
        continueSession: true,
      });
      processQueue(sock).catch((err) => {
        console.error('⚠️ processQueue failed:', err?.message || err);
      });
      return;
    } catch (err) {
      console.warn(`⚠️ switchGroupProject inside vote resolution failed (${err.message}). Falling back to generic task.`);
    }
  }

  const projectDir = (activeAlias && state.projects[activeAlias]) || CONFIG.defaultProjectDir;

  await sendReply(sock, groupJid, `got it: "${chosenOption}". on it 🫡`);
  const syntheticMsg = {
    key: {
      remoteJid: groupJid,
      fromMe: false,
      id: `vote_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    },
    message: {
      conversation: `${pending.originalTask}\n(User selected choice: ${chosenOption})`,
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
  taskQueue.push({
    jid: groupJid,
    msg: syntheticMsg,
    projectAlias: activeAlias,
    projectDir,
    taskPrompt: `${pending.originalTask}\n(User selected choice: ${chosenOption})`,
    continueSession: true,
  });
  processQueue(sock).catch((err) => {
    console.error('⚠️ processQueue failed:', err?.message || err);
  });
}

async function handleIncomingMessage(sock, msg, type, nowSec, acceptMessagesAfter = 0) {
      try {
        const dbg = unwrapMessage(msg);
        console.log(
          `🔍 [MSG] type=${type} jid=${msg.key?.remoteJid} fromMe=${msg.key?.fromMe} id=${msg.key?.id} hasMessage=${!!msg.message} stubType=${msg.messageStubType || 'none'}`
        );
      } catch {}

      if (!msg.message || !msg.key?.remoteJid) return;
      if (msg.key.remoteJid === 'status@broadcast') return;

      if (msg.key?.id && msg.message) {
        recordRawMessage(msg.key.id, msg.message);
      }

      // Record sender's pushName so we can message them by name later
      if (msg.pushName && !msg.key.fromMe) {
        const senderJid = msg.key.participant || msg.key.remoteJid;
        if (senderJid) {
          saveContactsList([{ id: senderJid, notify: msg.pushName }]);
        }
      }

      // If group message, cache group subject & participant mappings if not cached
      if (msg.key.remoteJid.endsWith('@g.us')) {
        const groupJid = msg.key.remoteJid;
        if (!getGroupName(groupJid)) {
          sock.groupMetadata(groupJid).then((meta) => {
            if (meta?.subject) setGroupName(groupJid, meta.subject);
            if (Array.isArray(meta?.participants)) {
              const discovered = [];
              for (const p of meta.participants) {
                if (p.jid && p.lid) {
                  discovered.push({ id: p.jid, lid: p.lid });
                }
              }
              if (discovered.length > 0) saveContactsList(discovered);
            }
          }).catch(() => {});
        }
      }

      // Account for PC clock skew (e.g. dual-boot or RTC drift) by comparing against calibrated server time.
      const msgTime = Number(msg.messageTimestamp || 0);
      if (msgTime > 0) {
        const rawDiff = Math.floor(Date.now() / 1000) - msgTime;
        // Only calibrate clock offset against recent messages (within 5 minutes), never against hour-old backlog
        if (!hasCalibratedClock && Math.abs(rawDiff) < 300) {
          serverTimeOffsetSec = rawDiff;
          hasCalibratedClock = true;
          console.log(`⏱️ Calibrated clock offset against incoming message: ${rawDiff}s`);
        }

        // WhatsApp App Sync Logic:
        // When reconnecting or opening after laptop shutdown/sleep, WhatsApp server sends backlogged/sync messages.
        // We sync contacts, group metadata, and chat context so the app has full history,
        // but NEVER execute or reply to any message sent before the bot was opened/started.
        // A 15-second grace buffer accounts for slight network transit or clock alignment differences.
        const effectiveBotStartSec = BOT_START_TIME_SEC - serverTimeOffsetSec;
        if (effectiveBotStartSec > 0 && msgTime < (effectiveBotStartSec - 15)) {
          const text = extractMessageText(msg);
          if (text && msg.key?.remoteJid) {
            const senderDisplay = msg.pushName || (msg.key?.fromMe ? 'Owner' : getSenderNumber(msg));
            recordChatMessage(msg.key.remoteJid, {
              sender: senderDisplay,
              text,
              timestamp: msgTime * 1000,
              quotedText: extractQuotedText(msg),
            });
          }
          console.log(`⏱️ [Sync/Backlog Message Recorded, Execution Skipped] msgId=${msg.key?.id} msgTime=${msgTime} cutoff=${effectiveBotStartSec - 15}`);
          return;
        }
      }

      // Never process messages sent by the bot itself or already processed / currently processing
      if (!msg.key?.id) return;
      if (sentMessageIds.has(msg.key.id) || processedMessageIds.has(msg.key.id) || inFlightMessageIds.has(msg.key.id)) {
        console.log(`⏭️ [Duplicate/Self Message Skipped] id=${msg.key.id}`);
        return;
      }
      inFlightMessageIds.add(msg.key.id);

      try {
        await _processIncomingMessage(sock, msg, type, nowSec, acceptMessagesAfter);
      } finally {
        inFlightMessageIds.delete(msg.key.id);
      }
}

async function _processIncomingMessage(sock, msg, type, nowSec, acceptMessagesAfter = 0) {
      // 1. Check for incoming Poll Vote or Reaction Vote
      try {
        const pollVote = await handlePollVote(sock, msg);
        if (pollVote?.resolved) {
          recordProcessedMessageId(msg.key.id);
          await handleVoteResolution(sock, pollVote);
          return;
        }

        const reactionVote = await handleReactionVote(sock, msg);
        if (reactionVote?.resolved) {
          recordProcessedMessageId(msg.key.id);
          await handleVoteResolution(sock, reactionVote);
          return;
        }
      } catch (voteErr) {
        console.warn('⚠️ Vote processing error:', voteErr?.message || voteErr);
      }

      // Skip text-less messages (stickers, reactions, location-only pings
      // without captions are handled via their captions/attachment download).
      const text = extractMessageText(msg);
      const audioMsg = extractAudioMessage(msg);
      const hasAttachment =
        !!extractDocumentMessage(msg) ||
        !!extractImageMessage(msg) ||
        !!extractVideoMessage(msg) ||
        !!audioMsg;

      const jid = msg.key?.remoteJid;
      const isGroup = jid && jid.endsWith('@g.us');

      // 2. SECTION 3 INITIALIZATION GATE
      // "Until someone sends @agent initialize in a group, the agent must never interact there,
      // even if pinged or mentioned. After initialization it responds normally. Initialization is saved per group."
      if (isGroup) {
        const isInit = isGroupInitialized(jid);
        const cleanText = (text || '').trim().toLowerCase();
        const callsign = (CONFIG.triggerPrefix || '').toLowerCase().trim();
        const callsignNoAt = callsign.replace(/^@/, '');

        // Commands must be strictly prefixed with call sign (e.g. "@ap init", "@ap initialize")
        const isInitCmd =
          cleanText === `${callsign} initialize` ||
          cleanText === `${callsign} init` ||
          cleanText === `@${callsignNoAt} initialize` ||
          cleanText === `@${callsignNoAt} init` ||
          (callsignNoAt && (cleanText === `${callsignNoAt} initialize` || cleanText === `${callsignNoAt} init`)) ||
          cleanText === '@agent initialize' ||
          cleanText === '@agent init';

        const isDeinitCmd =
          cleanText === `${callsign} deinitialize` ||
          cleanText === `${callsign} deinit` ||
          cleanText === `@${callsignNoAt} deinitialize` ||
          cleanText === `@${callsignNoAt} deinit` ||
          (callsignNoAt && (cleanText === `${callsignNoAt} deinitialize` || cleanText === `${callsignNoAt} deinit`)) ||
          cleanText === '@agent deinitialize' ||
          cleanText === '@agent deinit';

        const senderIsOwner = isOwner(msg);

        if (!isInit) {
          if (isInitCmd) {
            recordProcessedMessageId(msg.key.id);
            if (!senderIsOwner) {
              await sendReply(sock, jid, "You cannot use this agent until the owner gives you permission.", msg);
              return;
            }

            const sender = msg.key.participant || jid;
            markGroupInitialized(jid, sender);

            let masterDir = '';
            let bound = null;
            let projects = [];
            try {
              masterDir = getValidatedMasterDir();
              const listInfo = listProjectsForGroup(jid);
              bound = listInfo.boundAlias;
              projects = listInfo.projects || [];
            } catch {}

            const initReply = TEMPLATES.welcome_init({
              masterDir,
              activeProject: bound,
              projects,
            });
            await sendReply(sock, jid, initReply, msg);
            return;
          }

          // Silent gate: Group not initialized. Never interact.
          console.log(`🔇 Group ${jid} not initialized. Dropping message.`);
          return;
        } else {
          if (isDeinitCmd) {
            recordProcessedMessageId(msg.key.id);
            if (!senderIsOwner) {
              await sendReply(sock, jid, "Only the owner can deinitialize this group.", msg);
              return;
            }

            markGroupDeinitialized(jid);
            await sendReply(
              sock,
              jid,
              `💤 *Agent Deinitialized for this group.*\nI will now stay silent and ignore all messages in this group until initialized again via \`${callsign || '@agent'} init\`.`,
              msg
            );
            return;
          } else if (isInitCmd) {
            recordProcessedMessageId(msg.key.id);
            if (!senderIsOwner) {
              await sendReply(sock, jid, "You cannot use this agent until the owner gives you permission.", msg);
              return;
            }
            const listInfo = listProjectsForGroup(jid);
            const bound = listInfo.boundAlias;
            await sendReply(
              sock,
              jid,
              `ℹ️ *Agent is already initialized in this group.*\n${bound ? `🟢 Active project: \`${bound}\`` : `⚪ Active project: None (unbound)`}\n\nSay \`${callsign} list projects\` to view available projects or \`${callsign} switch to <name>\` to switch.`,
              msg
            );
            return;
          }
        }
      }

      console.log(`🔍 [Incoming Msg] JID=${msg.key?.remoteJid} fromMe=${msg.key?.fromMe} text="${text}" hasAudio=${!!audioMsg} hasAttach=${hasAttachment}`);

      if (text && msg.key?.remoteJid) {
        const senderDisplay = msg.pushName || (msg.key?.fromMe ? 'Owner' : getSenderNumber(msg));
        recordChatMessage(msg.key.remoteJid, {
          sender: senderDisplay,
          text,
          timestamp: Number(msg.messageTimestamp || 0) * 1000 || Date.now(),
          quotedText: extractQuotedText(msg),
        });
      }

      if (!text && !hasAttachment) return;

      const rawTriggeredBody = extractTriggeredBody(sock, msg, text);
      if (rawTriggeredBody === null) {
        console.log(`⏭️ Not triggered: text="${text}" hasAudio=${!!audioMsg}`);
        return;
      }

      recordProcessedMessageId(msg.key.id);

      console.log(
        `📩 [WhatsApp Trigger] JID=${msg.key.remoteJid} | fromMe=${msg.key.fromMe} | rawBody="${rawTriggeredBody}"`
      );

      if (!isSenderAuthorized(msg)) {
        console.log(`🔒 Unauthorized sender in ${jid}: ${getSenderNumber(msg)}`);
        await sendReply(sock, jid, "You cannot use this agent until the owner gives you permission.", msg);
        return;
      }

      const owner = isOwner(msg);
      const currentState = loadProjectsState();
      let rawBody = rawTriggeredBody;

      // Handle voice notes / audio messages: transcribe voice note into text prompt!
      if (audioMsg) {
        try {
          await reactToMessage(sock, msg, '🎙️');
          const boundProj = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
          const targetProjDir =
            (boundProj && currentState.projects?.[boundProj]) || CONFIG.defaultProjectDir;

          const downloadedAudio = await downloadWhatsAppAttachment(msg, targetProjDir);
          if (!downloadedAudio?.filePath) {
            console.warn(`⚠️ Failed to download voice note audio attachment from ${jid}`);
            await reactToMessage(sock, msg, '❌');
            await sendReply(
              sock,
              jid,
              `⚠️ Failed to download the voice note from WhatsApp. Please try sending again.`,
              msg
            );
            return;
          }

          console.log(`🎙️ Transcribing voice note from ${jid}: ${downloadedAudio.filePath}`);
          const transcribedText = await transcribeAudioFile(downloadedAudio.filePath);

          if (transcribedText) {
            console.log(`🗣️ Transcribed text: "${transcribedText}"`);
            const isDirectAudio = !!unwrapMessage(msg)?.audioMessage;
            if (isDirectAudio) {
              // Audio is attached to the current message
              if (rawBody && rawBody !== '[voice note]' && rawBody !== transcribedText) {
                rawBody = `${rawBody} (Voice Note: "${transcribedText}")`;
              } else {
                rawBody = transcribedText;
              }
            } else {
              // Audio was quoted/replied to by the user (e.g. user swiped voice note and sent "@agent" or "@agent fix this")
              if (!rawBody || rawBody.toLowerCase() === CONFIG.triggerPrefix || isStopWord(rawBody)) {
                rawBody = transcribedText;
              } else {
                rawBody = `${rawBody}\n\nTranscribed Quoted Voice Note: "${transcribedText}"`;
              }
            }
            recordChatMessage(jid, {
              sender: msg.pushName || (msg.key?.fromMe ? 'Owner' : getSenderNumber(msg)),
              text: `[Voice Note]: "${transcribedText}"`,
              timestamp: Number(msg.messageTimestamp || 0) * 1000 || Date.now(),
              quotedText: extractQuotedText(msg),
            });
          } else {
            console.warn('⚠️ Voice note transcription returned empty string.');
            await reactToMessage(sock, msg, '❌');
            if (!rawBody || rawBody.toLowerCase() === CONFIG.triggerPrefix) {
              await sendReply(
                sock,
                jid,
                `🎙️ Couldn't detect clear speech in that voice note. Please speak clearly or send text.`,
                msg
              );
              return;
            }
          }
        } catch (sttErr) {
          console.error('⚠️ Voice transcription failed:', sttErr?.message || sttErr);
          await reactToMessage(sock, msg, '❌');
          if (!rawBody || rawBody.toLowerCase() === CONFIG.triggerPrefix) {
            await sendReply(
              sock,
              jid,
              `⚠️ Failed to transcribe voice note: ${sttErr?.message || sttErr}`,
              msg
            );
            return;
          }
        }
      }

      // Only restrict DMs if ADMIN_NUMBERS is explicitly configured and sender is not an owner
      if (!isGroup && CONFIG.adminNumbers.length > 0 && !owner) {
        console.log(`🔒 Ignored non-owner DM trigger from: ${jid}`);
        return;
      }

      // If this group was shut down via /shutdown, completely ignore non-owners!
      if (isGroup && currentState.disabledGroups?.[jid] && !owner) {
        console.log(`🛑 Ignored non-owner trigger in shut-down group: ${jid}`);
        return;
      }

      const quotedText = extractQuotedText(msg);
      const replyingToBot = isReplyingToBot(msg, sock);

      // If user sent just "@agent" while quoting a message, use the quoted message as the task!
      if (!rawBody && quotedText && !replyingToBot) {
        rawBody = quotedText;
      }

      if (!rawBody) {
        if (!text && hasAttachment && !audioMsg) {
          rawBody = '(uploaded a file with no caption — inspect the attachment and describe what you see)';
        } else {
          await handleSlashCommand(sock, jid, msg, '/help');
          return;
        }
      }

      if (
        owner &&
        currentState.pendingEmailDrafts?.[jid] &&
        ['confirm', 'send', 'send it', 'yes', 'yes send', 'yes, send', 'send now', 'confirm send', 'cancel', 'discard'].includes(
          rawBody.toLowerCase().trim()
        )
      ) {
        const lowerCmd = rawBody.toLowerCase().trim();
        rawBody = lowerCmd === 'cancel' || lowerCmd === 'discard' ? '/cancel' : '/confirm';
      }

      // Handle owner response to a pending project deletion in Send-to-Self DM
      if (owner && isSendToSelf(msg, sock) && currentState.pendingProjectDeletions?.[jid]) {
        const pending = currentState.pendingProjectDeletions[jid];
        const lowerResp = rawBody.toLowerCase().trim();

        if (['cancel', 'discard', 'no', 'stop', 'nevermind', 'abort'].includes(lowerResp)) {
          delete currentState.pendingProjectDeletions[jid];
          saveProjectsState(currentState);
          await reactToMessage(sock, msg, '🛡️');
          await sendReply(sock, jid, `🛡️ *Cancelled project deletion.* "${pending.targetAlias}" is safe.`, msg);
          return;
        }

        const isYes = ['yes', 'confirm', 'proceed', 'sure', 'do it', 'delete', 'yep', 'yeah'].includes(lowerResp);
        if (isYes) {
          delete currentState.pendingProjectDeletions[jid];
          const targetAlias = pending.targetAlias;
          const targetPath = pending.targetPath;

          // Delete folder if within masterDir
          try {
            if (targetPath && fs.existsSync(targetPath)) {
              fs.rmSync(targetPath, { recursive: true, force: true });
            }
          } catch (err) {
            console.error('Failed to rm project directory:', err);
          }

          if (currentState.projects?.[targetAlias]) {
            delete currentState.projects[targetAlias];
          }
          if (currentState.activeProject === targetAlias) {
            currentState.activeProject = Object.keys(currentState.projects)[0] || '';
          }
          // Remove from group bindings
          for (const [gj, al] of Object.entries(currentState.groupBindings || {})) {
            if (al === targetAlias) delete currentState.groupBindings[gj];
          }
          // Remove from projectAccess
          for (const gj of Object.keys(currentState.projectAccess || {})) {
            if (currentState.projectAccess[gj]?.[targetAlias]) {
              delete currentState.projectAccess[gj][targetAlias];
            }
          }
          saveProjectsState(currentState);

          await reactToMessage(sock, msg, '🗑️');
          await sendReply(
            sock,
            jid,
            `🗑️ *Deleted project "${targetAlias}".*\nFolder and all associations have been removed.`,
            msg
          );
          return;
        } else {
          await sendReply(
            sock,
            jid,
            `⚠️ Please reply *yes* to permanently delete "${pending.targetAlias}" or *cancel* to abort.`,
            msg
          );
          return;
        }
      }

      // Handle owner response to a pending project confirmation
      if (owner && currentState.pendingProjectConfirmations?.[jid]) {
        const pending = currentState.pendingProjectConfirmations[jid];
        const lowerResp = rawBody.toLowerCase().trim();

        // 1. Cancel / Discard
        if (['cancel', 'discard', 'no', 'stop', 'nevermind', 'abort'].includes(lowerResp)) {
          delete currentState.pendingProjectConfirmations[jid];
          saveProjectsState(currentState);
          await reactToMessage(sock, msg, '🗑️');
          await sendReply(sock, jid, `🗑️ *Cancelled.* No files were created or modified.`, msg);
          return;
        }

        // 2. Confirmed (yes, confirm, proceed, ok, sure, do it) or project name
        const isYes = ['yes', 'y', 'confirm', 'proceed', 'sure', 'do it', 'ok', 'okay', 'yep', 'yeah'].includes(lowerResp);
        let chosenProject = null;

        if (isYes) {
          chosenProject = pending.suggestedProject;
        } else {
          // Check if user replied with a project name (e.g. "wisewallets", "rocktoberfest", "lattice", "demo")
          const cleanResp = lowerResp.replace(/[^a-z0-9]/g, '');
          for (const key of Object.keys(currentState.projects)) {
            if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanResp) {
              chosenProject = key;
              break;
            }
          }
          if (!chosenProject) {
            for (const [alias, patterns] of Object.entries(PROJECT_PHONETIC_PATTERNS)) {
              if (!currentState.projects[alias]) continue;
              if (patterns.some((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanResp)) {
                chosenProject = alias;
                break;
              }
            }
          }
        }

        if (chosenProject && currentState.projects[chosenProject]) {
          delete currentState.pendingProjectConfirmations[jid];
          currentState.activeProject = chosenProject;
          saveProjectsState(currentState);

          await reactToMessage(sock, msg, '🎯');

          if (pending.isScreenshot) {
            const targetUrl =
              (await getProjectDeploymentUrl(currentState.projects[chosenProject], chosenProject)) ||
              'http://localhost:3000';
            await sendReply(
              sock,
              jid,
              `🎯 *Confirmed project: \`${chosenProject}\`*\nCapturing screenshot of ${targetUrl}...`,
              msg
            );
            rawBody = `/screenshot ${targetUrl}${pending.isMobile ? ' mobile' : ''}`;
          } else {
            await sendReply(
              sock,
              jid,
              `🎯 *Confirmed project: \`${chosenProject}\`*\nProceeding with task...`,
              msg
            );
            rawBody = `[${chosenProject}] ${pending.taskPrompt}`;
          }
        } else if (!rawBody.startsWith('/')) {
          await sendReply(
            sock,
            jid,
            `❓ Reply *yes* to proceed on \`${pending.suggestedProject || 'active'}\`, or reply with a project name (*wisewallets*, *rocktoberfest*, *lattice*...), or *cancel*.`,
            msg
          );
          return;
        }
      }

      // =============================================================
      // AUTOPILOT MODE & OPERATING AGENT STATE MACHINE
      // =============================================================
      const isFullAutoGroup = Boolean(currentState.fullAutoGroups?.[jid]);

      // 1. Resolve Pending Collaborator Verification (if user was asked about an unknown friend)
      if (currentState.pendingCollaborators?.[jid]) {
        const collabResolution = resolvePendingCollaborator(jid, rawBody);
        if (collabResolution?.resolved) {
          const { username, friend, newlyAdded, projectDir: targetProjDir, permission } = collabResolution;
          await reactToMessage(sock, msg, '⏳');
          try {
            const res = await executeCollaboratorInvite({
              username,
              permission,
              projectDir: targetProjDir || (currentState.groupBindings?.[jid] ? currentState.projects[currentState.groupBindings[jid]] : currentState.projects[currentState.activeProject]),
            });
            await reactToMessage(sock, msg, '🤝');
            const notice = newlyAdded
              ? `\n💾 *Saved "${friend.name}" (@${username}) to your Friends list for next time.*`
              : '';
            await sendReply(
              sock,
              jid,
              res.isAlready
                ? `✅ *@${username}* is already a collaborator on \`${res.owner}/${res.repo}\` (${res.permission}).${notice}`
                : `🤝 Invited *${friend.name}* (\`@${username}\`) to \`${res.owner}/${res.repo}\` (${res.permission}) — ${res.invitationUrl}${notice}`,
              msg
            );
          } catch (err) {
            await sendReply(sock, jid, `❌ Failed to invite @${username}: ${err.message}`, msg);
          }
          return;
        }
      }

      // 2. Resolve Pending Ambiguity Clarification (user replied with "1", "2", "3" or option text)
      if (currentState.pendingClarifications?.[jid]) {
        const clarificationRes = resolvePendingClarification(jid, rawBody);
        if (clarificationRes?.resolved) {
          const { chosenOption, originalPrompt } = clarificationRes;
          await sendReply(sock, jid, `👍 *Option ${chosenOption.index}: ${chosenOption.label}* — Proceeding...`, msg);
          rawBody = originalPrompt;
        }
      }

      // 3. Administrative Triggers (@agent initialize, @agent deinitialize, @agent full auto)
      const lowerRaw = rawBody.toLowerCase().trim();
      const callsign = (CONFIG.triggerPrefix || '').toLowerCase().trim();
      const callsignNoAt = callsign.replace(/^@/, '');

      const isDeinitBody =
        lowerRaw === 'deinitialize' ||
        lowerRaw === 'deinit' ||
        lowerRaw === `${callsign} deinitialize` ||
        lowerRaw === `${callsign} deinit` ||
        lowerRaw === `@${callsignNoAt} deinitialize` ||
        lowerRaw === `@${callsignNoAt} deinit` ||
        (callsignNoAt && (lowerRaw === `${callsignNoAt} deinitialize` || lowerRaw === `${callsignNoAt} deinit`)) ||
        lowerRaw === '@agent deinitialize' ||
        lowerRaw === '@agent deinit';

      if (isDeinitBody) {
        if (!owner) {
          await sendReply(sock, jid, "Only the owner can deinitialize this group.", msg);
          return;
        }
        if (isGroup) {
          markGroupDeinitialized(jid);
          await sendReply(
            sock,
            jid,
            `💤 *Agent Deinitialized for this group.*\nI will now stay silent and ignore all messages in this group until initialized again via \`${callsign || '@agent'} init\`.`,
            msg
          );
          return;
        } else {
          await sendReply(
            sock,
            jid,
            `ℹ️ *Deinitialize is for group chats.* In your Send-to-Self personal DM, I remain available directly.`,
            msg
          );
          return;
        }
      }

      const isInitBody =
        lowerRaw === 'initialize' ||
        lowerRaw === 'init' ||
        lowerRaw === `${callsign} initialize` ||
        lowerRaw === `${callsign} init` ||
        lowerRaw === `@${callsignNoAt} initialize` ||
        lowerRaw === `@${callsignNoAt} init` ||
        (callsignNoAt && (lowerRaw === `${callsignNoAt} initialize` || lowerRaw === `${callsignNoAt} init`)) ||
        lowerRaw === '@agent initialize' ||
        lowerRaw === '@agent init';

      if (isInitBody) {
        if (!owner) {
          await sendReply(sock, jid, "You cannot use this agent until the owner gives you permission.", msg);
          return;
        }

        const listInfo = listProjectsForGroup(jid);
        const bound = listInfo.boundAlias;

        if (isGroup && isGroupInitialized(jid)) {
          await sendReply(
            sock,
            jid,
            `ℹ️ *Agent is already initialized in this group.*\n${bound ? `🟢 Active project: \`${bound}\`` : `⚪ Active project: None (unbound)`}\n\nSay \`${callsign} list projects\` to view available projects or \`${callsign} switch to <name>\` to switch.`,
            msg
          );
          return;
        }

        let masterDir = '';
        try {
          masterDir = getValidatedMasterDir();
        } catch (err) {
          await sendReply(sock, jid, `⚠️ *Master Directory Required*\n${err.message}`, msg);
          return;
        }

        if (isGroup) {
          markGroupInitialized(jid, msg.key.participant || jid);
        }

        const initReply = TEMPLATES.welcome_init({
          masterDir,
          activeProject: bound,
          projects: listInfo.projects || [],
        });

        await sendReply(sock, jid, initReply, msg);
        return;
      }

      // Helper: Calculate Levenshtein distance for fuzzy matching typos
      function getLevenshteinDistance(a, b) {
        const s1 = String(a || '').toLowerCase();
        const s2 = String(b || '').toLowerCase();
        const m = s1.length;
        const n = s2.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
              dp[i][j] = dp[i - 1][j - 1];
            } else {
              dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
          }
        }
        return dp[m][n];
      }

      // Helper: View access permissions (Chat is view-only)
      async function handleViewAccessCommand(sock, jid, msg, isGroup) {
        const stateNow = loadProjectsState();
        const activeAlias = isGroup ? stateNow.groupBindings?.[jid] : stateNow.activeProject;
        const allowAll = isGroup && isGroupAllowAll(jid);

        if (!activeAlias) {
          await sendReply(
            sock,
            jid,
            `🔒 *No active project bound to this chat.*\n\n👑 *Owner:* Full Access\n${allowAll ? '👥 *Group Access:* Give Permission to All is ON (anyone can chat)' : ''}\nℹ️ Permissions can only be managed from the desktop app.`,
            msg
          );
          return;
        }

        const allowedList = getProjectAccess(activeAlias);
        const contactLines =
          allowedList && allowedList.length > 0
            ? allowedList.map((num) => `• ${num}`).join('\n')
            : `• _None (Owner only)_`;

        const permsReply = [
          `🔒 *Allowed contacts for project "${activeAlias}":*`,
          contactLines,
          '',
          `👑 *Owner:* Full Access`,
          ...(allowAll ? ['👥 *Group Access:* Give Permission to All is *ON* (all group members can interact)'] : []),
          `ℹ️ Permissions can only be managed from the desktop app.`,
        ].join('\n');

        await sendReply(sock, jid, permsReply, msg);
      }

      // Helper: Manage access command (Permissions can NEVER be added, edited, or removed from the chat)
      async function handleManageAccessCommand(sock, jid, msg) {
        await reactToMessage(sock, msg, 'ℹ️');
        await sendReply(
          sock,
          jid,
          `ℹ️ *Permissions can only be managed from the desktop app.*\n\nUnder each project in the desktop app, you can add or remove phone numbers.`,
          msg
        );
      }

      // 3a. Who Has Perms / Permissions Query
      const isPermsQuery =
        lowerRaw === 'who has perms' ||
        lowerRaw === 'who has perms?' ||
        lowerRaw === 'who has permissions' ||
        lowerRaw === 'who has permissions?' ||
        lowerRaw === 'list perms' ||
        lowerRaw === 'list perms?' ||
        lowerRaw === 'list access perms' ||
        lowerRaw === 'list access permissions' ||
        lowerRaw === 'show perms' ||
        lowerRaw === 'show permissions' ||
        lowerRaw === 'perms' ||
        lowerRaw === 'permissions' ||
        lowerRaw.includes('who has perms') ||
        lowerRaw.includes('who has permissions') ||
        lowerRaw.includes('list access perms');

      if (isPermsQuery && !rawBody.startsWith('/')) {
        await handleViewAccessCommand(sock, jid, msg, isGroup);
        return;
      }

      const isFullAutoCmd =
        lowerRaw === 'fullauto' ||
        lowerRaw === 'full auto' ||
        lowerRaw === '/fullauto' ||
        lowerRaw === `${callsign} fullauto` ||
        lowerRaw === `${callsign} full auto` ||
        lowerRaw === `@${callsignNoAt} fullauto` ||
        lowerRaw === `@${callsignNoAt} full auto` ||
        (callsignNoAt && (lowerRaw === `${callsignNoAt} fullauto` || lowerRaw === `${callsignNoAt} full auto`)) ||
        lowerRaw === '@agent fullauto' ||
        lowerRaw === '@agent full auto' ||
        lowerRaw.endsWith(' fullauto') ||
        lowerRaw.endsWith(' full auto');

      if (isFullAutoCmd) {
        if (!owner) {
          await sendReply(sock, jid, "Only the owner can toggle full auto mode.", msg);
          return;
        }
        const nextState = !isFullAutoGroup;
        currentState.fullAutoGroups = currentState.fullAutoGroups || {};
        currentState.fullAutoGroups[jid] = nextState;
        saveProjectsState(currentState);

        await sendReply(
          sock,
          jid,
          nextState
            ? `🚀 *Full Auto ENGAGED!*\nI am now actively listening to all messages in this chat without needing you to tag @ap.\n_(Say "@ap fullauto" again anytime to revert to mention mode)._`
            : `⏸️ *Full Auto DISENGAGED.*\nReverted to mention mode (tag @ap to talk to me).`,
          msg
        );
        return;
      }

      // 3b. Risky Project Deletion Guard:
      // Project deletions can ONLY be done through personal DM (1-to-1 Send-to-Self / text to self), with explicit confirmation!
      const deleteProjMatch = rawBody.match(/\b(?:delete|remove|erase|destroy|nuke|rm)\s+(?:the\s+)?(?:project\s+)?([a-zA-Z0-9_-]+)/i);
      if (deleteProjMatch && !rawBody.startsWith('/')) {
        const candidateAlias = deleteProjMatch[1].toLowerCase();
        const stateNow = loadProjectsState();
        const masterDir = stateNow.masterDir;
        let matchedAlias = null;
        let matchedPath = null;

        // Check configured projects
        for (const [k, p] of Object.entries(stateNow.projects || {})) {
          if (k.toLowerCase() === candidateAlias) {
            matchedAlias = k;
            matchedPath = p;
            break;
          }
        }

        // Also check actual subdirectories in masterDir
        if (!matchedAlias && masterDir && fs.existsSync(masterDir)) {
          try {
            const dirs = fs.readdirSync(masterDir, { withFileTypes: true })
              .filter(d => d.isDirectory() && !d.name.startsWith('.'));
            const found = dirs.find(d => d.name.toLowerCase() === candidateAlias);
            if (found) {
              matchedAlias = found.name;
              matchedPath = path.join(masterDir, found.name);
            }
          } catch {}
        }

        // Also check if user said "delete this project" or "delete current project"
        if (!matchedAlias && ['this', 'current', 'it'].includes(candidateAlias)) {
          const bound = isGroup ? stateNow.groupBindings?.[jid] : stateNow.activeProject;
          if (bound) {
            matchedAlias = bound;
            matchedPath = stateNow.projects?.[bound] || (masterDir ? path.join(masterDir, bound) : null);
          }
        }

        if (matchedAlias) {
          const isSelfChat = isSendToSelf(msg, sock);
          // Deleting a project can NEVER happen from a group. It can only happen from the owner's self DM.
          if (isGroup || !owner || !isSelfChat) {
            await reactToMessage(sock, msg, '🔒');
            await sendReply(
              sock,
              jid,
              `🔒 *Project deletions can never be performed from a group chat.* To delete \`${matchedAlias}\`, please do it directly from the owner's personal Send-to-Self DM chat.`,
              msg
            );
            return;
          } else {
            // In Send-to-Self DM: send explicit confirmation
            stateNow.pendingProjectDeletions = stateNow.pendingProjectDeletions || {};
            stateNow.pendingProjectDeletions[jid] = {
              targetAlias: matchedAlias,
              targetPath: matchedPath,
              timestamp: Date.now(),
            };
            saveProjectsState(stateNow);
            await reactToMessage(sock, msg, '⚠️');
            await sendReply(
              sock,
              jid,
              `⚠️ *Are you sure you want to delete project \`${matchedAlias}\`?*\nThis will permanently delete the project folder and its associations.\n\nReply *yes* to proceed or *cancel* to abort.`,
              msg
            );
            return;
          }
        }
      }



      // 3c. Granular Project Access Commands: "allow XYZ from now", "give XYZ access", "revoke XYZ access"
      const manageAccessMatch =
        rawBody.match(/\b(?:allow|grant|give)\s+([a-zA-Z0-9_+@.'’-]+(?:\s+[a-zA-Z0-9_+@.'’-]+)?)\s+(?:access|permission|perms|from\s+now|to\s+use)/i) ||
        rawBody.match(/\b(?:allow|grant|give)\s+(?:agent\s+)?(?:perms|permissions|access)\s+(?:to|for)\s+([a-zA-Z0-9_+@.'’-]+(?:\s+[a-zA-Z0-9_+@.'’-]+)?)/i) ||
        rawBody.match(/\b(?:revoke|remove|disallow)\s+([a-zA-Z0-9_+@.'’-]+(?:\s+[a-zA-Z0-9_+@.'’-]+)?)\s+(?:access|permission|perms)/i) ||
        rawBody.match(/\b(?:revoke|remove|disallow)\s+(?:agent\s+)?(?:perms|permissions|access)\s+(?:from|for|to)\s+([a-zA-Z0-9_+@.'’-]+(?:\s+[a-zA-Z0-9_+@.'’-]+)?)/i);

      if (manageAccessMatch && !rawBody.startsWith('/') && owner) {
        const isRevoke = rawBody.toLowerCase().includes('revoke') || rawBody.toLowerCase().includes('remove') || rawBody.toLowerCase().includes('disallow');
        const userTarget = manageAccessMatch[1].trim();
        await handleManageAccessCommand(sock, jid, msg, isRevoke ? 'revoke' : 'grant', userTarget, null, isGroup, owner);
        return;
      }

      // 3d. Add / Remove Friends Directly From WhatsApp Chat:
      // e.g. "add friend Alice github: alice-dev", "save friend Bob bob_gh", "remove friend Alice"
      const addFriendMatch = rawBody.match(/^(?:please\s+)?(?:add|save)\s+friend\s+([A-Za-z0-9_.-]+)(?:\s+(?:github[:=]?\s*|@)?([A-Za-z0-9_.-]+))?$/i);
      const removeFriendMatch = rawBody.match(/^(?:please\s+)?(?:remove|delete)\s+friend\s+([A-Za-z0-9_.-]+)$/i);

      if (owner && !rawBody.startsWith('/')) {
        if (addFriendMatch) {
          const friendName = addFriendMatch[1];
          const githubUser = addFriendMatch[2] || friendName;
          try {
            const savedFriend = addFriend(friendName, githubUser);
            await reactToMessage(sock, msg, '👥');
            await sendReply(
              sock,
              jid,
              `👥 *Saved Friend:* "${savedFriend.name}" → GitHub \`@${savedFriend.github}\`.`,
              msg
            );
            return;
          } catch (err) {
            await sendReply(sock, jid, `⚠️ ${err.message}`, msg);
            return;
          }
        }
        if (removeFriendMatch) {
          const friendTarget = removeFriendMatch[1];
          const removed = removeFriend(friendTarget);
          await reactToMessage(sock, msg, removed ? '🗑️' : '❓');
          await sendReply(
            sock,
            jid,
            removed
              ? `🗑️ *Removed Friend:* "${friendTarget}" has been removed from your directory.`
              : `❓ Friend "${friendTarget}" was not found in your directory.`,
            msg
          );
          return;
        }
      }

      // 4. Intent Routing (Conversational AI Classifier)
      if (!rawBody.startsWith('/')) {
        const recentChat = (chatMessageHistory.get(jid) || []).slice(-5);
        const routeResult = await routeAutopilotIntent({
          prompt: rawBody,
          groupJid: jid,
          recentHistory: recentChat,
        });

        console.log(`✈️ [Autopilot Router] Intent=${routeResult.intent}`);

        // Lane 1: system_command
        if (routeResult.intent === 'system_command' && routeResult.systemCommand) {
          const cmd = routeResult.systemCommand;
          const projectName = routeResult.projectName;

          if (cmd === 'list_projects') {
            try {
              const listInfo = listProjectsForGroup(jid);
              await sendReply(
                sock,
                jid,
                TEMPLATES.list_projects({
                  projects: listInfo.projects,
                  activeProject: listInfo.boundAlias,
                }),
                msg
              );
            } catch (err) {
              await sendReply(sock, jid, `⚠️ ${err.message}`, msg);
            }
            return;
          }

          if (cmd === 'create_project') {
            if (!owner) {
              await sendReply(sock, jid, "Only the owner can do that.", msg);
              return;
            }
            if (!projectName) {
              await sendReply(sock, jid, TEMPLATES.missing_project_name({ action: 'create' }), msg);
              return;
            }
            try {
              const res = createProjectUnderMaster(projectName, jid);
              await sendReply(
                sock,
                jid,
                TEMPLATES.create_project({
                  projectName: res.alias,
                  folderPath: res.path,
                }),
                msg
              );
            } catch (err) {
              await sendReply(sock, jid, `⚠️ ${err.message}`, msg);
            }
            return;
          }

          if (cmd === 'switch_project') {
            if (!owner) {
              await sendReply(sock, jid, "Only the owner can do that.", msg);
              return;
            }
            if (!projectName) {
              const listInfo = listProjectsForGroup(jid);
              const choices = (listInfo.projects || []).filter((p) => p !== listInfo.boundAlias);
              if (choices.length === 0) {
                await sendReply(sock, jid, `no other projects in master dir to switch to.`, msg);
                return;
              }
              await sendChoicePoll(sock, {
                groupJid: jid,
                allowedVoterJid: msg.key.participant || jid,
                question: 'which project do you want to switch this group to?',
                options: choices,
                context: 'switch_project',
                originalTask: rawBody,
              });
              return;
            }
            try {
              const res = switchGroupProject(projectName, jid);
              await sendReply(
                sock,
                jid,
                TEMPLATES.switch_project({ projectName: res.alias }),
                msg
              );
            } catch (err) {
              const listInfo = listProjectsForGroup(jid);
              await sendReply(
                sock,
                jid,
                TEMPLATES.project_not_found({
                  projectName,
                  availableProjects: listInfo.projects,
                }),
                msg
              );
            }
            return;
          }

          if (cmd === 'current_project') {
            const st = getGroupProjectStatus(jid);
            await sendReply(
              sock,
              jid,
              TEMPLATES.current_project({
                projectName: st.bound ? st.alias : null,
                folderPath: st.path,
              }),
              msg
            );
            return;
          }

          if (cmd === 'unbind_project') {
            if (!owner) {
              await sendReply(sock, jid, "Only the owner can do that.", msg);
              return;
            }
            const unb = unbindGroupProject(jid);
            await sendReply(
              sock,
              jid,
              TEMPLATES.unbind_project({ previousProject: unb.previous }),
              msg
            );
            return;
          }

          if (cmd === 'view_access') {
            await handleViewAccessCommand(sock, jid, msg, isGroup);
            return;
          }

          if (cmd === 'manage_access') {
            await handleManageAccessCommand(sock, jid, msg);
            return;
          }
        }

        // Lane 2: choice_needed
        if (routeResult.intent === 'choice_needed' && routeResult.choiceQuestion) {
          await sendChoicePoll(sock, {
            groupJid: jid,
            allowedVoterJid: msg.key.participant || jid,
            question: routeResult.choiceQuestion,
            options: routeResult.choiceOptions || ['yes', 'no'],
            context: routeResult.choiceContext || 'user_choice',
            originalTask: rawBody,
          });
          return;
        }

        // Lane 3: chat
        if (routeResult.intent === 'chat' && routeResult.chatReplyText) {
          await sendReply(sock, jid, routeResult.chatReplyText, msg);
          return;
        }

        // Lane 4: laptop_task
        if (routeResult.intent === 'laptop_task') {
          if (routeResult.autoActivateProject && !getGroupActiveProject(jid)) {
            try {
              switchGroupProject(routeResult.autoActivateProject, jid);
              console.log(`🚀 Auto-activated project "${routeResult.autoActivateProject}" for group ${jid} (inferred from prompt/single project).`);
            } catch (err) {
              console.warn(`⚠️ Failed to auto-activate project ${routeResult.autoActivateProject}:`, err.message);
            }
          }

          const activeAlias = getGroupActiveProject(jid);
          if (!activeAlias) {
            const listInfo = listProjectsForGroup(jid);
            if (listInfo.projects && listInfo.projects.length > 0) {
              await sendChoicePoll(sock, {
                groupJid: jid,
                allowedVoterJid: msg.key.participant || jid,
                question: 'no active project in this group rn. which one should we work on?',
                options: listInfo.projects,
                context: 'activate_project_for_task',
                originalTask: rawBody,
              });
              return;
            } else {
              await sendReply(sock, jid, TEMPLATES.no_active_project(), msg);
              return;
            }
          }

          const state = loadProjectsState();
          const projectDir = state.projects[activeAlias];
          const taskInstructions = routeResult.laptopTaskInstructions || rawBody;

          // Send immediate natural context-aware acknowledgement before Antigravity runs
          if (routeResult.acknowledgementText) {
            await sendReply(sock, jid, routeResult.acknowledgementText, msg);
          }

          await reactToMessage(sock, msg, '⚡');

          taskQueue.push({
            jid,
            msg,
            projectAlias: activeAlias,
            projectDir,
            taskPrompt: taskInstructions,
            continueSession: true,
          });

          processQueue(sock).catch((err) => {
            console.error('⚠️ processQueue failed:', err?.message || err);
          });
          return;
        }
      }

      // Fast-path: natural language GitHub collaborator requests from the owner
      // (e.g. "add @octocat as collaborator to wisewallets", "invite https://github.com/user as a collaborator", "remove octocat from collaborators")
      if (owner && !rawBody.startsWith('/')) {
        const normalizedCollabText = rawBody
          .replace(/\[([^\]]+)\]\((https?:\/\/github\.com\/[^)]+)\)/gi, '$2')
          .replace(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)/gi, '$1')
          .trim();

        const emailInTextMatch = normalizedCollabText.match(
          /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/
        );
        const extractedEmail = emailInTextMatch ? emailInTextMatch[1] : '';

        const addCollabMatch =
          normalizedCollabText.match(
            /^(?:please\s+)?(?:can\s+you\s+)?(?:add|invite)\s+@?([A-Za-z0-9_.-]+)(?:\s*\([^)]*\))?\s+(?:as\s+(?:a\s+)?)?(?:github\s+)?collaborator(?:\s+(?:on|to|in|for)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?/i
          ) ||
          normalizedCollabText.match(
            /^(?:please\s+)?(?:can\s+you\s+)?(?:add|invite)\s+(?:github\s+)?collaborator\s+@?([A-Za-z0-9_.-]+)(?:\s*\([^)]*\))?(?:\s+(?:on|to|in|for)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?/i
          );
        const removeCollabMatch = normalizedCollabText.match(
          /^(?:please\s+)?(?:can\s+you\s+)?(?:remove|delete|revoke|uninvite)\s+@?([A-Za-z0-9_.-]+)\s+(?:as\s+(?:a\s+)?)?(?:collaborator|from\s+collaborators)(?:\s+(?:on|from|in)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?/i
        );
        const listCollabMatch = normalizedCollabText.match(
          /^(?:please\s+)?(?:list|show|get)\s+(?:all\s+)?(?:github\s+)?collaborators(?:\s+(?:on|for|in|of)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?$/i
        );

        const stopWords = new Set(['this', 'that', 'the', 'my', 'our', 'current', 'repo', 'repository', 'project', 'here']);
        if (addCollabMatch) {
          const user = addCollabMatch[1];
          const repoCandidate = (addCollabMatch[2] || '').replace(/[,.!?]+$/, '');
          const repoPart = repoCandidate && !stopWords.has(repoCandidate.toLowerCase()) ? ` ${repoCandidate}` : '';
          const emailPart = extractedEmail ? ` ${extractedEmail}` : '';
          rawBody = `/collab ${user}${repoPart}${emailPart}`;
        } else if (removeCollabMatch) {
          const user = removeCollabMatch[1];
          const repoCandidate = (removeCollabMatch[2] || '').replace(/[,.!?]+$/, '');
          const repoPart = repoCandidate && !stopWords.has(repoCandidate.toLowerCase()) ? ` ${repoCandidate}` : '';
          rawBody = `/removecollab ${user}${repoPart}`;
        } else if (listCollabMatch) {
          const repoCandidate = (listCollabMatch[1] || '').replace(/[,.!?]+$/, '');
          const repoPart = repoCandidate && !stopWords.has(repoCandidate.toLowerCase()) ? ` ${repoCandidate}` : '';
          rawBody = `/collabs${repoPart}`;
        }
      }

      // Fast-path: deployment / vercel URL query
      // (e.g. "pull out the vercel link", "what is the deployment link", "where is it deployed")
      if (!rawBody.startsWith('/')) {
        const lowerBody = rawBody.toLowerCase();
        if (
          lowerBody.includes('vercel link') ||
          lowerBody.includes('vercel url') ||
          lowerBody.includes('deployment link') ||
          lowerBody.includes('deployment url') ||
          lowerBody.includes('deployed link') ||
          lowerBody.includes('live link') ||
          lowerBody.includes('live url')
        ) {
          let projectDir = CONFIG.defaultProjectDir;
          let detectedAlias = null;
          try {
            const resolved = resolveProjectAndTask(rawBody, jid);
            if (resolved.projectDir) {
              projectDir = resolved.projectDir;
              detectedAlias = resolved.projectAlias;
            }
          } catch {
            const boundProject = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
            projectDir = (boundProject && currentState.projects?.[boundProject]) || CONFIG.defaultProjectDir;
            detectedAlias = boundProject;
          }

          const liveUrl = await getProjectDeploymentUrl(projectDir, detectedAlias);
          if (liveUrl) {
            await sendReply(
              sock,
              jid,
              `🌐 *Live Deployment for \`${detectedAlias || 'project'}\`:*\n${liveUrl}`,
              msg
            );
            return;
          }
        }
      }

      // Fast-path: natural language screenshot / visual inspection requests
      // (e.g. "take a screenshot of the current page", "send me a screenshot of localhost 3000", "screenshot https://example.com mobile")
      if (!rawBody.startsWith('/')) {
        const lowerBody = rawBody.toLowerCase();
        if (
          lowerBody.includes('screenshot') ||
          lowerBody.includes('screen shot') ||
          /\bss\b/i.test(lowerBody) ||
          lowerBody.includes('capture the page') ||
          lowerBody.includes('capture page') ||
          lowerBody.includes('visual test') ||
          lowerBody.includes('qa test') ||
          lowerBody.includes('landing page screenshot')
        ) {
          // Check if there is an explicit URL or port
          const urlMatch = rawBody.match(/(?:https?:\/\/[^\s]+|localhost:[0-9]+|:[0-9]{2,5}|\b[0-9]{4,5}\b)/i);
          const isMobile = lowerBody.includes('mobile') || lowerBody.includes('phone');
          let target = urlMatch ? urlMatch[0] : '';

          // If no specific URL was given, check if project has a live Vercel/GitHub deployment URL!
          if (!target) {
            let projectDir = CONFIG.defaultProjectDir;
            let detectedAlias = null;
            let resolved = null;
            try {
              resolved = resolveProjectAndTask(rawBody, jid);
              if (resolved.projectDir) {
                projectDir = resolved.projectDir;
                detectedAlias = resolved.projectAlias;
              }
            } catch {
              const boundProject = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
              projectDir = (boundProject && currentState.projects?.[boundProject]) || CONFIG.defaultProjectDir;
              detectedAlias = boundProject;
            }


            // 1. Try to discover live Vercel / GitHub Pages / deployment URL
            const liveUrl = await getProjectDeploymentUrl(projectDir, detectedAlias);
            if (liveUrl) {
              target = liveUrl;
            } else {
              // 2. Fall back to local project index.html or dev server
              const indexPath = path.join(projectDir, 'index.html');
              if (fs.existsSync(indexPath)) {
                target = `file://${indexPath}`;
              } else {
                target = 'http://localhost:3000';
              }
            }
          }

          rawBody = `/screenshot ${target}${isMobile ? ' mobile' : ''}`;
        }
      }

      // Check if it's a slash command or control command
      // Legacy slash commands or single control command keywords
      const lowerRawTrim = rawBody.toLowerCase().trim();
      const isControlCmd = [
        'help', 'shutdown', 'shtudown', 'wakeup', 'resume', 'start',
        'projects', 'unbind', 'turnoff', 'turn off'
      ].includes(lowerRawTrim) || lowerRawTrim.startsWith('project ') || lowerRawTrim.startsWith('bind ');
      if (rawBody.startsWith('/') || isControlCmd) {
        const handled = await handleSlashCommand(sock, jid, msg, rawBody);
        if (handled) return;
      }

      // Natural Language Processing Pipeline (Zero Slash Commands Needed!)
      let continueSession = replyingToBot;
      const recentChat = (chatMessageHistory.get(jid) || []).slice(-5);
      const senderDisplay = msg.pushName || (msg.key?.fromMe ? 'Owner' : getSenderNumber(msg));

      const intentResult = await classifyUserIntent({
        text: rawBody,
        groupJid: jid,
        recentHistory: recentChat,
        senderName: senderDisplay,
      });

      console.log(`🤖 [NLP Dispatch] JID=${jid} Intent=${intentResult.intent} Confidence=${intentResult.confidence}`);

      const dispatchResult = await dispatchIntent({
        intentResult,
        sock,
        jid,
        msg,
        rawBody,
        owner,
        isGroup,
        boundProject: isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject,
        state: currentState,
        taskQueue,
        currentRunningItem,
        sendReply,
        reactToMessage,
        sendWhatsAppFile,
        recentChatContext: getRecentChatContext(jid),
        chatHistory: chatMessageHistory.get(jid) || [],
      });

      if (dispatchResult?.handled) {
        return;
      }

      if (dispatchResult?.isCodingTask) {
        rawBody = dispatchResult.taskPrompt || rawBody;
        if (dispatchResult.continueSession) {
          continueSession = true;
        }
        if (dispatchResult.targetProject) {
          rawBody = `[${dispatchResult.targetProject}] ${rawBody}`;
        }
      }

      // If owner sends a normal task in a group that is currently shut down, remind them to wake up first
      if (isGroup && currentState.disabledGroups?.[jid]) {
        await sendReply(
          sock,
          jid,
          `🛑 *Weave is currently asleep in this group.*\nJust say *"wake up"* to turn it back on!`,
          msg
        );
        return;
      }

      // Check for continuation flag (-c or --continue)
      if (rawBody.startsWith('-c ') || rawBody.startsWith('--continue ')) {
        continueSession = true;
        rawBody = rawBody.replace(/^(-c|--continue)\s+/, '').trim();
      }

      // If quoting a non-bot message AND also providing instructions (e.g. quoting a meeting link and typing "@agent mail this to me and add it to my calendar")
      if (quotedText && !replyingToBot && rawBody !== quotedText) {
        rawBody = `Referenced quoted message:\n"""\n${quotedText}\n"""\n\nUser Instruction: ${rawBody}`;
      }

      try {
        const resolved = resolveProjectAndTask(rawBody, jid);
        const {
          projectAlias,
          projectDir,
          taskPrompt,
        } = resolved;

        if (isProcessingQueue || taskQueue.length > 0) {
          const position = taskQueue.length + 1;
          await sendReply(
            sock,
            jid,
            `⏳ Queued (#${position})`,
            msg
          );
        }

        taskQueue.push({
          jid,
          msg,
          projectAlias,
          projectDir,
          taskPrompt,
          continueSession,
        });

        processQueue(sock).catch((err) => {
          console.error('⚠️ processQueue failed:', err?.message || err);
        });
      } catch (err) {
        // Only show "group not bound yet" instructions if the Owner triggered it
        if (err.code === 'UNBOUND_GROUP' && !owner) {
          return;
        }
        await sendReply(sock, jid, `⚠️ ${err.message}`, msg);
      }
}

/**
 * Returns the current live status of the WhatsApp bot socket and task execution.
 */
export function getBotStatus() {
  return {
    connected: Boolean(activeSock && activeSock.user),
    user: activeSock?.user || null,
    registered: Boolean(activeSock?.authState?.creds?.registered),
    activeTask: getActiveTaskInfo(),
  };
}

/**
 * Requests an 8-digit pairing code from Baileys for a phone number.
 */
export async function requestPairingCode(phoneNumber) {
  if (!activeSock) {
    throw new Error('WhatsApp socket is not initialized');
  }
  const cleanNumber = (phoneNumber || '').replace(/[^0-9]/g, '');
  if (!cleanNumber) {
    throw new Error('Please enter a valid phone number with country code (e.g. 15551234567)');
  }
  const code = await activeSock.requestPairingCode(cleanNumber);
  return code;
}
