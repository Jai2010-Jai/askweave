import { startWhatsAppBot } from './bot.js';
import { CONFIG, loadProjectsState } from './config.js';

console.log('🚀 Starting WhatsApp Antigravity Agent Bridge...');
const state = loadProjectsState();
const activeDir = state.projects[state.activeProject] || CONFIG.defaultProjectDir;
if (!state.projects[state.activeProject]) {
  console.warn(
    `⚠️ Active project "${state.activeProject}" not found — falling back to ${activeDir}`
  );
}
console.log(`📂 Default Active Project: ${state.activeProject} -> ${activeDir}`);
console.log(`📣 Listening for trigger: "${CONFIG.triggerPrefix}"\n`);

const MAX_START_RETRIES = 5;
let startAttempts = 0;

async function startWithRetry() {
  startAttempts += 1;
  try {
    await startWhatsAppBot();
  } catch (err) {
    console.error(`Fatal error starting WhatsApp bot (attempt ${startAttempts}):`, err?.message || err);
    if (startAttempts < MAX_START_RETRIES) {
      const backoffMs = Math.min(30000, 2500 * startAttempts);
      console.log(`🔄 Retrying in ${backoffMs / 1000}s...`);
      setTimeout(startWithRetry, backoffMs);
    } else {
      console.error('❌ Max start retries exceeded. Exiting.');
      process.exit(1);
    }
  }
}

startWithRetry();
