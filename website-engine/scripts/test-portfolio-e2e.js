import { fastFuzzyClassify } from '../src/nlp/classifier.js';
import { executePortfolioCreation, iteratePortfolioDesign } from '../src/portfolio/portfolioOrchestrator.js';

async function runTest() {
  console.log('--- Step 1: Testing User Intent Classification ---');
  const userPrompt = 'create a portfolio website for my AI approach';
  const classification = fastFuzzyClassify(userPrompt);
  console.log('Intent:', classification.intent);
  console.log('Confidence:', classification.confidence);
  console.log('Portfolio Payload:', classification.portfolio);

  if (classification.intent !== 'portfolio') {
    throw new Error('Classification failed!');
  }

  console.log('\n--- Step 2: Testing Portfolio Creation Pipeline ---');
  const createResult = await executePortfolioCreation({
    prompt: userPrompt,
    chatJid: 'simulation-chat@s.whatsapp.net',
    targetProjectDir: '/tmp/test-portfolio-e2e',
    senderName: 'Tinchu',
  });

  console.log('Created Site URL:', createResult.siteUrl);
  console.log('Variants captured:', createResult.variants.map((v) => `Option ${v.option}: ${v.name}`));
  console.log('Live Preview Shot:', createResult.livePreviewScreenshot);
  console.log('WhatsApp Directives:');
  for (const line of createResult.messageText.split('\n')) {
    if (line.startsWith('[SEND_FILE:')) {
      console.log(' ', line);
    }
  }

  console.log('\n--- Step 3: Testing In-Chat WhatsApp Iteration ---');
  const iterPrompt = 'I like Option 2, switch to Swiss style and update tagline';
  const iterClassification = fastFuzzyClassify(iterPrompt);
  console.log('Iteration Intent:', iterClassification.intent);
  console.log('Is Iteration:', iterClassification.portfolio?.isIteration);

  const iterResult = await iteratePortfolioDesign({
    chatJid: 'simulation-chat@s.whatsapp.net',
    feedbackText: iterPrompt,
  });

  console.log('Updated Site URL:', iterResult.siteUrl);
  console.log('Updated Shot:', iterResult.updatedShotPath);
  console.log('\n✅ All stages executed successfully!');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
