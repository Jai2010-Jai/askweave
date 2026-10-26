#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Weave — WhatsApp Agent Bridge for Google Antigravity & Gemini

Usage:
  weave                        Start the WhatsApp bot daemon (default call-sign: @weave)
  weave start                  Start the WhatsApp bot daemon
  weave callsign [@handle]     View or set a unique agent call-sign (@agent is reserved)
  weave auth                   Interactive Google OAuth 2.0 (PKCE) login
  weave desktop                Launch the desktop UI (Electron)
  weave --callsign <@handle>   Start with a specific unique call-sign
  weave --help, -h             Show help information
  weave --version, -v          Show version
`);
}

function printVersion() {
  try {
    const pkgPath = path.join(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(`weave-agent v${pkg.version}`);
  } catch {
    console.log('weave-agent v1.0.0');
  }
}

if (args.includes('--help') || args.includes('-h') || command === 'help') {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v') || command === 'version') {
  printVersion();
  process.exit(0);
}

// Check for --callsign <handle> flag
const callsignFlagIdx = args.findIndex((a) => a === '--callsign' || a === '-c');
if (callsignFlagIdx !== -1 && args[callsignFlagIdx + 1]) {
  const { updateTriggerPrefix } = await import('../src/config.js');
  const res = updateTriggerPrefix(args[callsignFlagIdx + 1]);
  if (!res.success) {
    console.error(`❌ ${res.error}`);
    process.exit(1);
  }
  console.log(`✅ Weave call-sign set to: ${res.triggerPrefix}`);
}

if (command === 'callsign' || command === 'trigger') {
  const { CONFIG, updateTriggerPrefix } = await import('../src/config.js');
  const newHandle = args[1];
  if (!newHandle) {
    console.log(`🏷️  Current Weave Call-Sign: ${CONFIG.triggerPrefix}`);
    console.log(`💡 To change it: weave callsign @myweave  (Note: @agent is reserved)`);
    process.exit(0);
  }
  const res = updateTriggerPrefix(newHandle);
  if (!res.success) {
    console.error(`❌ ${res.error}`);
    process.exit(1);
  }
  console.log(`✅ Weave Call-Sign updated to: ${res.triggerPrefix}`);
  process.exit(0);
} else if (command === 'auth') {
  import('../src/auth.js');
} else if (command === 'desktop') {
  import('child_process').then(({ spawn }) => {
    const electronMain = path.join(__dirname, '../electron/main.js');
    const electronBin = path.join(__dirname, '../node_modules/.bin/electron');
    const child = spawn(electronBin, [electronMain], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
  });
} else {
  import('../src/index.js');
}
