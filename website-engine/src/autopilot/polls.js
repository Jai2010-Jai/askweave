import crypto from 'crypto';
import { decryptPollVote, jidNormalizedUser } from '@whiskeysockets/baileys';
import { savePendingPoll, getPendingPoll, deletePendingPoll, recordRawMessage } from '../config.js';
import { recordSentMessageId } from '../bot.js';

const FALLBACK_EMOJIS = ['🟢', '🔵', '🟡', '🟣', '🟠', '🔴', '⚪', '🟤'];

/**
 * Sends a WhatsApp poll for interactive choices.
 * Falls back to emoji reactions if poll sending fails.
 */
export async function sendChoicePoll(sock, {
  groupJid,
  allowedVoterJid,
  question,
  options = [],
  intent = 'choice_needed',
  originalTask = '',
  context = '',
}) {
  const cleanOptions = options
    .map((o) => String(o).trim())
    .filter(Boolean)
    .slice(0, 12);

  if (cleanOptions.length === 0) {
    throw new Error('sendChoicePoll requires at least one option.');
  }

  const normalizedVoter = jidNormalizedUser(allowedVoterJid);
  const myCredsMe = sock.authState?.creds?.me || sock.user || {};
  const pollCreatorJid = myCredsMe.id ? jidNormalizedUser(myCredsMe.id) : (sock.user?.id ? jidNormalizedUser(sock.user.id) : null);
  const pollCreatorLid = myCredsMe.lid ? jidNormalizedUser(myCredsMe.lid) : (sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null);
  const pollCreatorRawId = myCredsMe.id || sock.user?.id || null;
  const pollCreatorRawLid = myCredsMe.lid || sock.user?.lid || null;

  try {
    const sent = await sock.sendMessage(groupJid, {
      poll: {
        name: question,
        values: cleanOptions,
        selectableCount: 1,
      },
    });

    const pollMsgId = sent.key?.id;
    if (pollMsgId) {
      recordSentMessageId(pollMsgId);
      if (sent.message) {
        recordRawMessage(pollMsgId, sent.message);
      }
    }
    const rawSecret = sent.message?.messageContextInfo?.messageSecret;
    const messageSecret = rawSecret ? Buffer.from(rawSecret).toString('base64') : null;

    const emojiMap = {};
    cleanOptions.forEach((opt, idx) => {
      const emoji = FALLBACK_EMOJIS[idx] || `${idx + 1}️⃣`;
      emojiMap[emoji] = opt;
    });

    savePendingPoll(pollMsgId, {
      pollMsgId,
      allowedVoterJid: normalizedVoter,
      rawAllowedVoterJid: allowedVoterJid,
      pollCreatorJid,
      pollCreatorLid,
      pollCreatorRawId,
      pollCreatorRawLid,
      groupJid,
      question,
      options: cleanOptions,
      emojiMap,
      intent,
      originalTask,
      context,
      messageSecret,
      isReactionFallback: false,
    });

    console.log(`📊 Sent WhatsApp poll [${pollMsgId}] to ${groupJid} (voter: ${normalizedVoter})`);
    return { success: true, mode: 'poll', messageId: pollMsgId };
  } catch (err) {
    console.warn(`⚠️ Native poll failed (${err.message}). Falling back to reactions.`);
    return sendReactionFallback(sock, {
      groupJid,
      allowedVoterJid: normalizedVoter,
      question,
      options: cleanOptions,
      intent,
      originalTask,
      context,
    });
  }
}

/**
 * Fallback: Sends a message formatted with emoji options and waits for reaction from original sender.
 */
export async function sendReactionFallback(sock, {
  groupJid,
  allowedVoterJid,
  question,
  options = [],
  intent = 'choice_needed',
  originalTask = '',
  context = '',
}) {
  const emojiMap = {};
  const lines = [question, ''];

  options.forEach((opt, idx) => {
    const emoji = FALLBACK_EMOJIS[idx] || `${idx + 1}️⃣`;
    emojiMap[emoji] = opt;
    lines.push(`${emoji} ${opt}`);
  });

  lines.push('');
  lines.push('👉 _React with the emoji of your choice (only original sender can vote)_');

  const textBody = lines.join('\n');
  const sent = await sock.sendMessage(groupJid, { text: textBody });
  const msgId = sent.key?.id;

  savePendingPoll(msgId, {
    pollMsgId: msgId,
    allowedVoterJid: jidNormalizedUser(allowedVoterJid),
    groupJid,
    question,
    options,
    emojiMap,
    intent,
    originalTask,
    context,
    isReactionFallback: true,
  });

  console.log(`📊 Sent reaction fallback [${msgId}] to ${groupJid}`);
  return { success: true, mode: 'reaction', messageId: msgId };
}

/**
 * Handles incoming poll vote updates.
 * Strictly verifies voter is the original sender.
 */
export async function handlePollVote(sock, msg) {
  const pollUpdate = msg.message?.pollUpdateMessage;
  if (!pollUpdate) return null;

  const creationKey = pollUpdate.pollCreationMessageKey;
  const pollMsgId = creationKey?.id;
  if (!pollMsgId) return null;

  const pending = getPendingPoll(pollMsgId);
  if (!pending) return null;

  const myNormalizedId = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
  const myNormalizedLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null;

  // When fromMe is true, voter is the owner's WhatsApp account, NOT the group remoteJid
  const rawVoter = msg.key.fromMe
    ? (myNormalizedId || myNormalizedLid)
    : (msg.key.participant || msg.key.remoteJid);
  const voterJid = jidNormalizedUser(rawVoter);
  const allowedVoter = jidNormalizedUser(pending.allowedVoterJid);

  // Match by exact JID or by phone number prefix if one is LID and one is phone
  const voterNum = (voterJid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const allowedNum = (allowedVoter || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const isAuthorized = msg.key.fromMe || voterJid === allowedVoter || (voterNum && voterNum === allowedNum);

  if (!isAuthorized) {
    console.log(`🔒 Discarded poll vote from unauthorized user: ${voterJid} (allowed: ${allowedVoter})`);
    return null;
  }

  let chosenOption = null;

  try {
    if (pollUpdate.vote?.encPayload && pending.messageSecret) {
      const pollEncKey = Buffer.from(pending.messageSecret, 'base64');
      
      // WhatsApp GCM derivation depends on exact JID strings (phone vs LID, raw with :device vs normalized)
      // used by the client when creating/voting. NEVER include group JIDs (@g.us) as voter or creator candidate!
      const myCredsMe = sock.authState?.creds?.me || sock.user || {};
      const creatorCandidates = Array.from(new Set([
        pending.pollCreatorJid,
        pending.pollCreatorLid,
        pending.pollCreatorRawId,
        pending.pollCreatorRawLid,
        myNormalizedId,
        myNormalizedLid,
        myCredsMe.id,
        myCredsMe.lid,
        myCredsMe.id ? jidNormalizedUser(myCredsMe.id) : null,
        myCredsMe.lid ? jidNormalizedUser(myCredsMe.lid) : null,
        sock.user?.id,
        sock.user?.lid,
        sock.user?.id ? jidNormalizedUser(sock.user.id) : null,
        sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null,
      ])).filter(Boolean).filter((j) => typeof j === 'string' && !j.endsWith('@g.us'));

      const voterCandidates = Array.from(new Set([
        rawVoter,
        voterJid,
        msg.key.participant,
        msg.key.remoteJid,
        allowedVoter,
        pending.allowedVoterJid,
        pending.rawAllowedVoterJid,
        msg.key.fromMe ? myNormalizedId : null,
        msg.key.fromMe ? myNormalizedLid : null,
        msg.key.fromMe ? myCredsMe.id : null,
        msg.key.fromMe ? myCredsMe.lid : null,
        sock.user?.id,
        sock.user?.lid,
        sock.user?.id ? jidNormalizedUser(sock.user.id) : null,
        sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null,
      ])).filter(Boolean).filter((j) => typeof j === 'string' && !j.endsWith('@g.us'));

      let decrypted = null;
      let lastErr = null;

      outerLoop:
      for (const cJid of creatorCandidates) {
        for (const vJid of voterCandidates) {
          try {
            decrypted = decryptPollVote(
              {
                encPayload: pollUpdate.vote.encPayload,
                encIv: pollUpdate.vote.encIv,
              },
              {
                pollCreatorJid: cJid,
                pollMsgId: pending.pollMsgId,
                pollEncKey,
                voterJid: vJid,
              }
            );
            if (decrypted) break outerLoop;
          } catch (err) {
            lastErr = err;
          }
        }
      }

      if (!decrypted && lastErr) {
        throw lastErr;
      }

      const selectedHashBufs = decrypted?.selectedOptions || [];
      if (selectedHashBufs.length > 0) {
        const votedHashHex = Buffer.from(selectedHashBufs[0]).toString('hex');
        for (const opt of pending.options) {
          const optHashHex = crypto.createHash('sha256').update(opt).digest('hex');
          if (optHashHex === votedHashHex) {
            chosenOption = opt;
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Failed to decrypt poll vote: ${err.message}`);
  }

  if (chosenOption) {
    deletePendingPoll(pollMsgId);
    return {
      resolved: true,
      chosenOption,
      pending,
      voterJid,
      groupJid: pending.groupJid,
    };
  }

  return null;
}

/**
 * Handles incoming reaction votes (fallback for polls).
 * Strictly verifies voter is the original sender.
 */
export async function handleReactionVote(sock, msg) {
  const reaction = msg.message?.reactionMessage;
  if (!reaction) return null;

  const targetMsgId = reaction.key?.id;
  if (!targetMsgId) return null;

  const pending = getPendingPoll(targetMsgId);
  if (!pending) return null;

  const myNormalizedId = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
  const myNormalizedLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null;
  const rawVoter = msg.key.fromMe
    ? (myNormalizedId || myNormalizedLid)
    : (msg.key.participant || msg.key.remoteJid);
  const voterJid = jidNormalizedUser(rawVoter);
  const allowedVoter = jidNormalizedUser(pending.allowedVoterJid);

  const voterNum = (voterJid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const allowedNum = (allowedVoter || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const isAuthorized = msg.key.fromMe || voterJid === allowedVoter || (voterNum && voterNum === allowedNum);

  if (!isAuthorized) {
    console.log(`🔒 Discarded reaction vote from unauthorized user: ${voterJid} (allowed: ${allowedVoter})`);
    return null;
  }

  const emoji = reaction.text;
  let chosenOption = pending.emojiMap?.[emoji];
  if (!chosenOption && pending.options) {
    const idx = FALLBACK_EMOJIS.indexOf(emoji);
    if (idx >= 0 && pending.options[idx]) {
      chosenOption = pending.options[idx];
    }
  }

  if (chosenOption) {
    deletePendingPoll(targetMsgId);
    return {
      resolved: true,
      chosenOption,
      pending,
      voterJid,
      groupJid: pending.groupJid,
    };
  }

  return null;
}
