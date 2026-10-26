import { resolveProjectAndTask } from './config.js';
import { runAntigravityTask } from './agent.js';

const rawInput =
  process.argv.slice(2).join(' ') ||
  'Check index.html and tell me the current page title and main heading.';

async function main() {
  const { projectAlias, projectDir, taskPrompt } =
    resolveProjectAndTask(rawInput);

  console.log(`🧪 Testing Antigravity Agent Bridge...`);
  console.log(`📂 Project : ${projectAlias} (${projectDir})`);
  console.log(`📝 Task    : ${taskPrompt}\n`);

  const result = await runAntigravityTask({
    projectAlias,
    projectDir,
    taskPrompt,
  });

  console.log(`✅ Completed in ${result.durationSeconds?.toFixed(1)}s!`);
  console.log(`🆔 Conversation ID: ${result.conversationId || 'N/A'}\n`);
  console.log(`--- WhatsApp Reply Preview ---`);
  console.log(result.response);
  if (result.gitSummary) {
    console.log(`\n📊 Modified Files:\n${result.gitSummary}`);
  }
  console.log(`------------------------------`);
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
