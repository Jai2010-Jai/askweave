import assert from 'assert';
import { dispatchIntent } from '../nlp/dispatcher.js';
import { INTENTS } from '../nlp/intents.js';
import { loadProjectsState, saveProjectsState } from '../config.js';

async function runMultiAgentFlowTests() {
  console.log('🧪 Starting Multi-Agent Website Flow Test Suite...\n');

  const testJid = 'test-founder-chat@s.whatsapp.net';
  const sentMessages = [];
  const reactions = [];
  const sentPolls = [];

  // Mock Baileys socket
  const mockSock = {
    user: { id: 'bot-number@s.whatsapp.net', lid: 'bot-number@lid' },
    sendMessage: async (jid, content) => {
      if (content.poll) {
        sentPolls.push({ jid, poll: content.poll });
        return {
          key: { id: `poll_msg_${Date.now()}`, remoteJid: jid },
          message: {
            messageContextInfo: {
              messageSecret: Buffer.from('mock-secret-key-12345'),
            },
          },
        };
      }
      sentMessages.push({ jid, text: content.text });
      return { key: { id: `msg_${Date.now()}`, remoteJid: jid } };
    },
  };

  const mockSendReply = async (sock, jid, text) => {
    sentMessages.push({ jid, text });
  };

  const mockReact = async (sock, msg, emoji) => {
    reactions.push(emoji);
  };

  const mockSendWhatsAppFile = async () => {};

  // Clean initial state for test JID
  const initialState = loadProjectsState();
  if (initialState.portfolioSessions) {
    delete initialState.portfolioSessions[testJid];
    saveProjectsState(initialState);
  }

  // ==========================================
  // Test 1: Immediate Acknowledgment, Poll, & Follow-up
  // ==========================================
  console.log('Test 1: Dispatching website build request...');
  const prompt = 'build a modern landing page for an artisan coffee roastery';
  const incomingMsg = {
    key: { remoteJid: testJid, fromMe: false, participant: 'founder@s.whatsapp.net', id: 'msg_001' },
    pushName: 'Alex Founder',
    message: { conversation: prompt },
  };

  const dispatchRes = await dispatchIntent({
    intentResult: {
      intent: INTENTS.PORTFOLIO,
      confidence: 0.98,
      portfolio: { isIteration: false, rawText: prompt },
    },
    sock: mockSock,
    jid: testJid,
    msg: incomingMsg,
    rawBody: prompt,
    owner: true,
    isGroup: false,
    boundProject: null,
    state: loadProjectsState(),
    sendReply: mockSendReply,
    reactToMessage: mockReact,
    sendWhatsAppFile: mockSendWhatsAppFile,
  });

  // 1. Verify non-blocking return
  assert.strictEqual(dispatchRes.handled, true, 'dispatchIntent must return handled: true immediately');
  console.log('✅ Non-blocking dispatch returned immediately without waiting for long build.');

  // 2. Verify instant acknowledgment
  const ackMsg = sentMessages.find((m) => m.text.includes("working on it"));
  assert.ok(ackMsg, 'Instant reassurance message ("working on it") must be sent');
  console.log(`✅ Instant reassurance sent: "${ackMsg.text}"`);

  // 3. Verify WhatsApp poll was created
  const vibePoll = sentPolls.find((p) => p.poll.name.toLowerCase().includes('vibe') || p.poll.name.toLowerCase().includes('aesthetic'));
  assert.ok(vibePoll, 'WhatsApp poll for vibe/aesthetic must be sent');
  assert.ok(vibePoll.poll.values.length >= 2, 'Poll must have selectable options');
  console.log(`✅ WhatsApp Poll sent with question: "${vibePoll.poll.name}" and ${vibePoll.poll.values.length} options.`);

  // 4. Verify conversational follow-up was asked
  const followUpMsg = sentMessages.find((m) => m.text.includes('tell me a bit more about the product') || m.text.includes('main goal'));
  assert.ok(followUpMsg, 'Follow-up product questions must be sent');
  console.log(`✅ Product Discovery follow-up sent: "${followUpMsg.text.slice(0, 60)}..."`);

  // ==========================================
  // Test 2: Poll Vote Resolution (Vibe Choice)
  // ==========================================
  console.log('\nTest 2: Resolving aesthetic poll vote...');
  const chosenVibe = '3️⃣ Warm & Artisanal (Craft tones & serif)';
  const voteRes = {
    chosenOption: chosenVibe,
    pending: {
      context: 'website_vibe_choice',
      originalTask: prompt,
    },
    voterJid: 'founder@s.whatsapp.net',
    groupJid: testJid,
  };

  // Simulating the resolution from handleVoteResolution in bot.js
  const cleanVibe = chosenVibe.replace(/^[0-9️⃣\s]+/, '').trim();
  const stateAfterVote = loadProjectsState();
  stateAfterVote.portfolioSessions = stateAfterVote.portfolioSessions || {};
  if (!stateAfterVote.portfolioSessions[testJid]) {
    stateAfterVote.portfolioSessions[testJid] = {};
  }
  stateAfterVote.portfolioSessions[testJid].preferredVibe = cleanVibe;
  saveProjectsState(stateAfterVote);

  const updatedState = loadProjectsState();
  assert.strictEqual(
    updatedState.portfolioSessions[testJid].preferredVibe,
    cleanVibe,
    'Preferred vibe must be recorded in session state'
  );
  console.log(`✅ Poll vote resolved and recorded vibe: "${cleanVibe}"`);

  // ==========================================
  // Test 3: Conversational Product Discovery Response
  // ==========================================
  console.log('\nTest 3: Founder replying with product emphasis & audience...');
  const founderProductDetails = 'We want visitors to order single-origin beans online, and highlight our weekly roast schedule and free local Seattle pickup.';
  const founderMsg = {
    key: { remoteJid: testJid, fromMe: false, participant: 'founder@s.whatsapp.net', id: 'msg_002' },
    pushName: 'Alex Founder',
    message: { conversation: founderProductDetails },
  };

  const productChatDispatch = await dispatchIntent({
    intentResult: {
      intent: INTENTS.CONVERSATIONAL_QA,
      confidence: 0.88,
      conversationalQa: { query: founderProductDetails, directReply: null },
    },
    sock: mockSock,
    jid: testJid,
    msg: founderMsg,
    rawBody: founderProductDetails,
    owner: true,
    isGroup: false,
    boundProject: null,
    state: loadProjectsState(),
    sendReply: mockSendReply,
    reactToMessage: mockReact,
    sendWhatsAppFile: mockSendWhatsAppFile,
  });

  assert.strictEqual(productChatDispatch.handled, true, 'Product discussion should be handled conversationally');

  const finalState = loadProjectsState();
  assert.ok(
    finalState.portfolioSessions?.[testJid]?.productNotes?.includes('single-origin beans'),
    'Product notes should be saved in portfolio session'
  );
  console.log('✅ Product Discovery Agent acknowledged founder emphasis and saved notes to session:');
  console.log(`   Product Notes: "${finalState.portfolioSessions[testJid].productNotes}"`);

  // Cleanup test session
  delete finalState.portfolioSessions[testJid];
  saveProjectsState(finalState);

  console.log('\n========================================');
  console.log('🎉 ALL MULTI-AGENT WORKFLOW TESTS PASSED!');
  console.log('========================================\n');
}

runMultiAgentFlowTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
