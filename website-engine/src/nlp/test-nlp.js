import { fastFuzzyClassify, classifyUserIntent } from './classifier.js';
import { INTENTS } from './intents.js';

const testCases = [
  // Task Control
  { input: 'stop what you are doing right now', expectedIntent: INTENTS.TASK_CONTROL },
  { input: 'wait stop', expectedIntent: INTENTS.TASK_CONTROL },
  { input: 'what are you working on right now?', expectedIntent: INTENTS.TASK_CONTROL },
  { input: 'status', expectedIntent: INTENTS.TASK_CONTROL },
  { input: 'let\'s start fresh, clear context', expectedIntent: INTENTS.TASK_CONTROL },
  { input: 'btw, also make sure tests pass', expectedIntent: INTENTS.TASK_CONTROL },

  // Help Guide
  { input: 'what can you do?', expectedIntent: INTENTS.HELP_GUIDE },
  { input: 'how do i use weave?', expectedIntent: INTENTS.HELP_GUIDE },

  // Workspace Management
  { input: 'what projects do we have available?', expectedIntent: INTENTS.WORKSPACE_MANAGEMENT },
  { input: 'show all projects', expectedIntent: INTENTS.WORKSPACE_MANAGEMENT },
  { input: 'switch to portfolio-website', expectedIntent: INTENTS.WORKSPACE_MANAGEMENT },
  { input: 'let\'s work on wisewallets', expectedIntent: INTENTS.WORKSPACE_MANAGEMENT },
  { input: 'unbind this group', expectedIntent: INTENTS.WORKSPACE_MANAGEMENT },
  { input: 'start a new project called payment-gateway', expectedIntent: INTENTS.WORKSPACE_MANAGEMENT },
  { input: 'what project are we on?', expectedIntent: INTENTS.WORKSPACE_MANAGEMENT },

  // Visual QA
  { input: 'show me what the landing page looks like on mobile', expectedIntent: INTENTS.VISUAL_QA },
  { input: 'take a screenshot of localhost:3000', expectedIntent: INTENTS.VISUAL_QA },
  { input: 'capture the screen', expectedIntent: INTENTS.VISUAL_QA },

  // Git & GitHub
  { input: 'push our changes to github with message "fixed navbar"', expectedIntent: INTENTS.GIT_GITHUB },
  { input: 'enable auto-push', expectedIntent: INTENTS.GIT_GITHUB },
  { input: 'add @octocat as a collaborator', expectedIntent: INTENTS.GIT_GITHUB },
  { input: 'who has access to this repo?', expectedIntent: INTENTS.GIT_GITHUB },

  // File Operations
  { input: 'send me the package.json', expectedIntent: INTENTS.FILE_OPERATIONS },
  { input: 'share index.html', expectedIntent: INTENTS.FILE_OPERATIONS },

  // Agent Lifecycle
  { input: 'go to sleep', expectedIntent: INTENTS.AGENT_LIFECYCLE },
  { input: 'wake up', expectedIntent: INTENTS.AGENT_LIFECYCLE },
  { input: 'check for updates', expectedIntent: INTENTS.AGENT_LIFECYCLE },
  { input: 'change your callsign to @jarvis', expectedIntent: INTENTS.AGENT_LIFECYCLE },

  // Conversational Q&A
  { input: 'how does JWT refresh token rotation work?', expectedIntent: INTENTS.CONVERSATIONAL_QA },
  { input: 'what is the difference between flexbox and grid?', expectedIntent: INTENTS.CONVERSATIONAL_QA },

  // Cab Booking & Fare Comparison (Uber, Ola, Namma Yatri)
  { input: 'book an auto to MG Road', expectedIntent: INTENTS.CAB_BOOKING },
  { input: 'compare cabs from Indiranagar to Kempegowda Airport', expectedIntent: INTENTS.CAB_BOOKING },
  { input: 'uber to Koramangala', expectedIntent: INTENTS.CAB_BOOKING },
  { input: 'check namma yatri fare to whitefield', expectedIntent: INTENTS.CAB_BOOKING },

  // Swiggy Food & Instamart Groceries
  { input: "order 1 Margherita Pizza from Domino's", expectedIntent: INTENTS.SWIGGY },
  { input: 'find biryani on swiggy', expectedIntent: INTENTS.SWIGGY },
  { input: 'show menu for Meghana Foods', expectedIntent: INTENTS.SWIGGY },
  { input: 'buy 2 milk from instamart', expectedIntent: INTENTS.SWIGGY },
  { input: 'view cart', expectedIntent: INTENTS.SWIGGY },
  { input: 'track my swiggy order', expectedIntent: INTENTS.SWIGGY },
];

async function runTests() {
  console.log('🧪 Running Weave Natural Language Classifier Test Suite...\n');
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const fastRes = fastFuzzyClassify(tc.input, {
      availableProjects: ['portfolio-website', 'wisewallets', 'rocktoberfest'],
      boundProject: 'portfolio-website',
    });

    const intent = fastRes ? fastRes.intent : null;
    const isPass = intent === tc.expectedIntent;

    if (isPass) {
      passed++;
      console.log(`✅ [PASS] "${tc.input}"`);
      console.log(`   -> Intent: ${intent} (Confidence: ${fastRes.confidence})`);
    } else {
      // Try full classifier pipeline
      const fullRes = await classifyUserIntent({
        text: tc.input,
        groupJid: 'test-group@g.us',
        senderName: 'Tester',
      });
      const fullPass = fullRes.intent === tc.expectedIntent;
      if (fullPass) {
        passed++;
        console.log(`✅ [PASS via Full Pipeline] "${tc.input}"`);
        console.log(`   -> Intent: ${fullRes.intent} (Confidence: ${fullRes.confidence})`);
      } else {
        failed++;
        console.log(`❌ [FAIL] "${tc.input}"`);
        console.log(`   Expected: ${tc.expectedIntent}, Got: ${intent || fullRes?.intent}`);
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
