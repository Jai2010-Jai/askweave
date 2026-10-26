import { classifyUserIntent } from './classifier.js';

async function testFastRouterPipeline() {
  console.log('🧪 Testing Tier 1 Fast Router Pipeline...\n');

  const testQueries = [
    { text: 'yo weave u up', expectedIntent: 'conversational_qa' },
    { text: 'in portfolio-website make the navbar sticky and dark mode', expectedIntent: 'coding_task' },
    { text: 'what is the difference between let and const', expectedIntent: 'conversational_qa' },
    { text: 'switch to wisewallets', expectedIntent: 'workspace_management' },
    { text: 'stop what ur doing', expectedIntent: 'task_control' },
  ];

  for (const q of testQueries) {
    const start = Date.now();
    const result = await classifyUserIntent({
      text: q.text,
      groupJid: 'test@g.us',
      recentHistory: [],
      senderName: 'Tinchu',
    });
    const elapsed = Date.now() - start;

    console.log(`──────────────────────────────────────────`);
    console.log(`Query: "${q.text}" (${elapsed}ms)`);
    console.log(`Intent: ${result.intent} (Expected: ${q.expectedIntent})`);
    if (result.directReply || result.conversationalQa?.directReply) {
      console.log(`Direct Persona Reply: "${result.directReply || result.conversationalQa?.directReply}"`);
    }
    if (result.codingTask) {
      console.log(`Coding Task Instructions: "${result.codingTask.instructions}"`);
      console.log(`Target Project: ${result.codingTask.targetProject}`);
    }
    if (result.workspace) {
      console.log(`Workspace Action: ${result.workspace.action} (Project: ${result.workspace.projectName})`);
    }
  }

  console.log('\nAll tests completed!');
}

testFastRouterPipeline().catch(console.error);
