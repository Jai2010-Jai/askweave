import { dispatchIntent } from '../../nlp/dispatcher.js';
import { INTENTS } from '../../nlp/intents.js';

console.log('🧪 Testing Cab Intent Dispatcher...\n');

let replySent = null;

const fakeSock = {};
const fakeMsg = {};
const sendReply = async (sock, jid, text, msg) => {
  replySent = text;
};
const reactToMessage = async (sock, msg, emoji) => {
  console.log(`Reacted with: ${emoji}`);
};

const intentResult = {
  intent: INTENTS.CAB_BOOKING,
  confidence: 0.98,
  cabBooking: {
    pickup: 'Indiranagar, Bengaluru',
    destination: 'MG Road, Bengaluru',
    provider: null,
    category: null,
  },
};

const res = await dispatchIntent({
  intentResult,
  sock: fakeSock,
  jid: 'test-user@s.whatsapp.net',
  msg: fakeMsg,
  rawBody: 'compare cabs from Indiranagar to MG Road',
  owner: true,
  isGroup: false,
  boundProject: null,
  state: {},
  sendReply,
  reactToMessage,
});

console.log('Dispatch result handled:', res.handled);
console.log('\n--- WhatsApp Card Sent ---\n');
console.log(replySent);
console.log('\n---------------------------\n');

if (!res.handled || !replySent || !replySent.includes('https://nammayatri.in') || replySent.includes('RECOMMENDED RIDE PICK')) {
  throw new Error('Dispatcher failed to return expected natural conversational recommendation message with deep link!');
}

console.log('--- Test Compare Action ---');
let compareReply = null;
const compareIntentResult = {
  intent: INTENTS.CAB_BOOKING,
  confidence: 0.98,
  cabBooking: {
    action: 'compare',
    pickup: 'Indiranagar, Bengaluru',
    destination: 'MG Road, Bengaluru',
    provider: null,
    category: null,
  },
};

await dispatchIntent({
  intentResult: compareIntentResult,
  sock: fakeSock,
  jid: 'test-user@s.whatsapp.net',
  msg: fakeMsg,
  rawBody: 'compare cabs from Indiranagar to MG Road',
  owner: true,
  isGroup: false,
  boundProject: null,
  state: {},
  sendReply: async (s, j, text) => {
    compareReply = text;
  },
  reactToMessage,
});

if (!compareReply || !compareReply.includes('RIDE FARE COMPARISON')) {
  throw new Error('Dispatcher failed to return comparison card for compare action!');
}

console.log('✅ Cab Intent Dispatcher test PASSED successfully!');
