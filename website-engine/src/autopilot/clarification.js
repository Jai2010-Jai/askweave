import { loadProjectsState, saveProjectsState } from '../config.js';

const CLARIFICATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Creates and stores a pending clarification for a WhatsApp group.
 */
export function createPendingClarification(groupJid, originalPrompt, question, rawOptions) {
  const state = loadProjectsState();
  state.pendingClarifications = state.pendingClarifications || {};

  const formattedOptions = (rawOptions || []).map((opt, idx) => ({
    index: idx + 1,
    key: String(idx + 1),
    label: typeof opt === 'string' ? opt : opt.label || `Option ${idx + 1}`,
    lane: opt.lane || null,
  }));

  state.pendingClarifications[groupJid] = {
    originalPrompt,
    question,
    options: formattedOptions,
    timestamp: Date.now(),
  };

  saveProjectsState(state);

  const emojiDigits = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const optionsText = formattedOptions
    .map((o, i) => `${emojiDigits[i] || `${i + 1}.`} *${o.label}*`)
    .join('\n');

  return [
    `🤔 *I want to make sure I get this right:*`,
    question,
    '',
    optionsText,
    '',
    `_Reply with the number of your choice (e.g. "1" or "2")._`,
  ].join('\n');
}

/**
 * Resolves a pending clarification if the user replied to it.
 */
export function resolvePendingClarification(groupJid, userReplyText) {
  const state = loadProjectsState();
  const pending = state.pendingClarifications?.[groupJid];

  if (!pending) return null;

  // TTL expiration check
  if (Date.now() - pending.timestamp > CLARIFICATION_TTL_MS) {
    delete state.pendingClarifications[groupJid];
    saveProjectsState(state);
    return null;
  }

  const cleanReply = String(userReplyText).trim().toLowerCase();

  // 1. Direct number match (e.g. "1", "1️⃣", "#1")
  const numMatch = cleanReply.match(/^#?([1-9])/);
  if (numMatch) {
    const selectedNum = parseInt(numMatch[1], 10);
    const chosenOption = pending.options.find((o) => o.index === selectedNum);
    if (chosenOption) {
      delete state.pendingClarifications[groupJid];
      saveProjectsState(state);
      return {
        resolved: true,
        originalPrompt: pending.originalPrompt,
        chosenOption,
      };
    }
  }

  // 2. Keyword match against option labels
  for (const opt of pending.options) {
    const labelLower = opt.label.toLowerCase();
    if (cleanReply.includes(labelLower) || labelLower.includes(cleanReply)) {
      delete state.pendingClarifications[groupJid];
      saveProjectsState(state);
      return {
        resolved: true,
        originalPrompt: pending.originalPrompt,
        chosenOption: opt,
      };
    }
  }

  return null;
}
