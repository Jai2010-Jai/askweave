import { INTENTS, NLP_SYSTEM_PROMPT } from './intents.js';
import { geminiClient } from '../gemini-client.js';
import { queryFastRouter } from './fast-router.js';
import { loadProjectsState, getFriends } from '../config.js';
import { listProjectsForGroup } from '../autopilot/workspace.js';
import { getActiveTaskInfo } from '../agent.js';
import { parseCabEntities } from '../concierge/cabs/cabService.js';
import { parseSwiggyEntities } from '../concierge/swiggy/swiggyService.js';

/**
 * Fast Regex / Fuzzy Parser for zero-latency deterministic classification.
 * This runs in < 1ms and acts as both an accelerator and a reliable offline failsafe.
 */
export function fastFuzzyClassify(rawText, { availableProjects = [], boundProject = null } = {}) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();
  const clean = lower.replace(/^[,\s]+|[?.!,]+$/g, '').trim();

  // -1. Swiggy Food & Instamart Groceries
  if (
    /\b(?:swiggy|instamart)\b/i.test(clean) ||
    /\b(?:order|buy|find|search|get|suggest|craving)\b.*\b(?:food|grocer(?:y|ies)|dishes|restaurant|restaurants|pizza|biryani|burger|burgers|cake|cakes|dessert|desserts|ice\s*cream|pastr(?:y|ies)|milk|eggs|bread|curd|snack|snacks|meal|meals|lunch|dinner|breakfast)\b/i.test(clean) ||
    /\b(?:that\s+i\s+can\s+order|order\s+online|order\s+food)\b/i.test(clean) ||
    /^(?:view\s+cart|show\s+cart|my\s+cart|clear\s+cart|cart|checkout|apply\s+coupon)\b/i.test(clean) ||
    /^(?:order|buy)\s+\d+\s+.+?(?:\s+from\s+[a-zA-Z0-9\s'’]+)?$/i.test(clean) ||
    /^(?:menu|show\s+menu)\s+(?:for|of|from)\s+[a-zA-Z0-9\s'’]+$/i.test(clean) ||
    /\b(?:track(?:ing)?|where\s+is\s+my|status\s+of)\s+(?:food|order|swiggy|delivery)\b/i.test(clean)
  ) {
    if (
      !/\b(?:cabs?|taxis?|rides?|ubers?|olas?)\b/i.test(clean) &&
      !/\b(?:function|component|bug|code|test|file|git|repo|commit|css|html|js|ts)\b/i.test(clean)
    ) {
      const parsed = parseSwiggyEntities(text);
      return {
        intent: INTENTS.SWIGGY,
        confidence: 0.98,
        swiggy: parsed,
      };
    }
  }

  // 0. Cab Booking & Route Fare Comparison (Uber, Ola, Namma Yatri)
  if (
    /^(?:(?:please\s+)?(?:book|get|find|compare|check)\s+(?:me\s+)?(?:(?:an?|the)\s+)?(?:cabs?|taxis?|rides?|autos?|bikes?|ubers?|olas?|namma\s+yatri))\b/i.test(clean) ||
    /^(?:uber|ola|namma\s+yatri)\s+(?:to|from)\b/i.test(clean) ||
    /^(?:cabs?|autos?|taxis?|rides?)\s+to\b/i.test(clean) ||
    /\b(?:how\s+much\s+(?:is\s+)?(?:(?:an?|the)\s+)?(?:cabs?|taxis?|ubers?|olas?|autos?|rides?)\s+to)\b/i.test(clean)
  ) {
    const parsed = parseCabEntities(text);
    if (parsed.destination) {
      return {
        intent: INTENTS.CAB_BOOKING,
        confidence: 0.98,
        cabBooking: parsed,
      };
    }
  }

  // 0.2. Email, Conversation Summary & Catch-Up Requests
  const isEmailSummary =
    /\b(?:email|mail|send)\b.*\b(?:summary|context|catch\s*up|recap|conversation|convo)\b/i.test(clean) ||
    /\b(?:summary|context|catch\s*up|recap|conversation|convo)\b.*\b(?:email|mail|send\s+(?:it\s+)?to\s+me)\b/i.test(clean) ||
    /\b(?:missed\s+(?:the\s+)?context|what\s+happened\s+here)\b.*\b(?:email|mail|send)\b/i.test(clean) ||
    /\b(?:email|mail)\s+(?:me\s+)?(?:the\s+)?(?:summary|recap|catchup|catch\s*up|context)\b/i.test(clean);

  const isEmailProjectOrThis =
    /^(?:please\s+|can\s+you\s+)?(?:email|mail|send)\s+(?:this|it|the\s+project|the\s+site|the\s+website|the\s+code|the\s+files?|the\s+output|the\s+results?)\s+(?:to\s+)?(?:me|my\s+email|myself)?$/i.test(clean) ||
    /^(?:please\s+|can\s+you\s+)?(?:email|mail|send)\s+(?:me|my\s+email|myself)\s+(?:this|it|the\s+project|the\s+site|the\s+website|the\s+code|the\s+files?|the\s+output|the\s+results?)$/i.test(clean) ||
    /^(?:please\s+|can\s+you\s+)?(?:email|mail)\s+(?:this|it)\s+to\s+me$/i.test(clean) ||
    /^(?:please\s+|can\s+you\s+)?(?:email|mail)\s+this$/i.test(clean) ||
    /^(?:please\s+|can\s+you\s+)?email\s+(?:me\s+)?(?:the\s+)?(?:latest\s+)?(?:update|updates|details|summary|project)\b/i.test(clean);

  const isGeneralEmail =
    /^(?:please\s+|can\s+you\s+)?(?:email|send\s+an?\s+email|mail|draft\s+an?\s+email)\b/i.test(clean);

  if (isEmailSummary || isEmailProjectOrThis || isGeneralEmail) {
    const emailMatch = clean.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const mentionsSelf =
      /\b(?:me|myself|my\s+email|to\s+me|for\s+me)\b/i.test(clean) ||
      (!emailMatch && (isEmailSummary || isEmailProjectOrThis));

    return {
      intent: INTENTS.EMAIL,
      confidence: 0.99,
      email: {
        action: isEmailSummary ? 'summary' : (isEmailProjectOrThis ? 'project' : 'general'),
        recipient: emailMatch ? emailMatch[1] : (mentionsSelf ? 'me' : null),
        rawText: text,
        isSummary: Boolean(isEmailSummary),
        isProject: Boolean(isEmailProjectOrThis),
      },
    };
  }

  // 0.5. Website & Portfolio Creation & Iteration (Stitch MCP + Netlify)
  const isPortfolioCreation =
    /\b(?:create|build|make|generate|design|setup|deploy|need|want|host(?:ing)?)\b.*\b(?:website|landing\s+page|web\s+page|portfolio|site)\b/i.test(clean) ||
    /\b(?:need\s+a\s+website|build\s+a\s+website|create\s+a\s+website|make\s+a\s+website|hackathon\s+website|deploy\s+to\s+netlify)\b/i.test(clean) ||
    /^(?:portfolio\s+website|create\s+portfolio|build\s+portfolio)\b/i.test(clean);

  const isPortfolioIteration =
    /\b(?:option\s+[123]|switch\s+to\s+option|choose\s+option\s+[123]|swiss\s+style|bento\s+style|brutalist\s+style)\b/i.test(clean) ||
    /^(?:switch\s+to\s+option\s+[123]|option\s+[123]|make\s+it\s+swiss|make\s+it\s+bento|make\s+it\s+brutalist)$/i.test(clean);

  if (isPortfolioCreation || isPortfolioIteration) {
    return {
      intent: INTENTS.PORTFOLIO,
      confidence: 0.98,
      portfolio: {
        isIteration: Boolean(isPortfolioIteration),
        rawText: text,
      },
    };
  }

  // 1. Immediate Abort / Stop Reflex
  if (
    /^(?:please\s+)?(?:stop|halt|cancel|abort|shut\s*up|wait\s+stop|kill\s+task|stop\s+task|stop\s+what\s+you(?:'re|\s+are)\s+doing)/i.test(
      clean
    ) ||
      clean === 'stop' ||
      clean === 'cancel' ||
      clean === 'abort'
  ) {
    return {
      intent: INTENTS.TASK_CONTROL,
      confidence: 1.0,
      taskControl: { action: 'stop', contextNote: null },
    };
  }

  // 2. Status Queries
  if (
    /^(?:what(?:'s|\s+is)\s+(?:the\s+)?status|what\s+are\s+you\s+(?:currently\s+)?(?:doing|working\s+on)|are\s+you\s+busy|is\s+(?:the\s+)?task\s+(?:still\s+)?running|is\s+anything\s+running|queue\s+status|status)(?:\s+right\s+now)?$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.TASK_CONTROL,
      confidence: 0.98,
      taskControl: { action: 'status', contextNote: null },
    };
  }

  // 3. Reset / Fresh Context
  if (
    /(?:(?:let(?:'s|\s+us)\s+)?start\s+fresh|clear\s+context|clear\s+chat|forget\s+(?:the\s+)?previous|new\s+session|start\s+over|reset\s+context|new)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.TASK_CONTROL,
      confidence: 0.98,
      taskControl: { action: 'reset_context', contextNote: null },
    };
  }

  // 4. By The Way / Append Context
  const btwMatch = text.match(/^(?:btw|by\s+the\s+way)\s*[:,]?\s*(.+)$/i);
  if (btwMatch) {
    return {
      intent: INTENTS.TASK_CONTROL,
      confidence: 0.95,
      taskControl: { action: 'append_context', contextNote: btwMatch[1].trim() },
    };
  }

  // 5. Help / Capabilities
  if (
    /^(?:what\s+can\s+you\s+do|help|help\s+me|how\s+do\s+i\s+use\s+(?:you|weave)|what\s+are\s+your\s+capabilities|how\s+does\s+this\s+work|show\s+help)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.HELP_GUIDE,
      confidence: 0.98,
    };
  }

  // 6. Agent Lifecycle: Sleep / Shutdown
  if (
    /^(?:go\s+to\s+sleep|shut\s*down|sleep|pause\s+(?:bot|agent)|mute\s+yourself|stop\s+listening)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.AGENT_LIFECYCLE,
      confidence: 0.98,
      lifecycle: { action: 'sleep', newCallsign: null },
    };
  }

  // 7. Agent Lifecycle: Wake Up / Resume
  if (
    /^(?:wake\s*up|resume|turn\s+(?:back\s+)?on|start\s+listening|hey\s+weave\s+you\s+there)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.AGENT_LIFECYCLE,
      confidence: 0.98,
      lifecycle: { action: 'wakeup', newCallsign: null },
    };
  }

  // 8. Agent Lifecycle: OTA Update
  if (
    /^(?:check\s+for\s+updates|update\s+yourself|update\s+weave|is\s+there\s+an\s+update|ota\s+update)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.AGENT_LIFECYCLE,
      confidence: 0.95,
      lifecycle: { action: 'ota_update', newCallsign: null },
    };
  }

  // 9. Agent Lifecycle: Change Callsign / Trigger
  const callsignMatch = clean.match(
    /^(?:change\s+(?:your\s+)?call-?sign\s+to|change\s+(?:your\s+)?name\s+to|set\s+call-?sign\s+to|call\s+yourself)\s+(@?[a-z0-9_-]+)/i
  );
  if (callsignMatch) {
    return {
      intent: INTENTS.AGENT_LIFECYCLE,
      confidence: 0.95,
      lifecycle: { action: 'callsign_change', newCallsign: callsignMatch[1] },
    };
  }

  // 10. Workspace Management: List Projects
  if (
    /^(?:what\s+projects\s+(?:do\s+we\s+have(?:\s+available)?|are\s+available)|list\s+(?:all\s+)?projects|show\s+(?:all\s+)?projects|which\s+projects\s+exist|show\s+repos|list\s+repos|projects)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.WORKSPACE_MANAGEMENT,
      confidence: 0.98,
      workspace: { action: 'list', projectName: null },
    };
  }

  // 11. Workspace Management: Current Project Status
  if (
    /^(?:what\s+project\s+(?:are\s+we\s+(?:on|working\s+on)|is\s+active|is\s+this\s+group\s+bound\s+to)|current\s+project|project\s+status)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.WORKSPACE_MANAGEMENT,
      confidence: 0.98,
      workspace: { action: 'status', projectName: null },
    };
  }

  // 12. Workspace Management: Unbind / Disconnect
  if (
    /^(?:unbind\s+this\s+(?:group|chat)|disconnect\s+(?:from\s+)?project|turn\s+off\s+project(?:\s+here)?|remove\s+project\s+binding)$/i.test(
      clean
    )
  ) {
    return {
      intent: INTENTS.WORKSPACE_MANAGEMENT,
      confidence: 0.98,
      workspace: { action: 'unbind', projectName: null },
    };
  }

  // 13. Workspace Management: Create Project
  const createProjMatch = clean.match(
    /^(?:create|start|init|initialize)\s+(?:a\s+)?(?:new\s+)?project\s+(?:called\s+|named\s+)?([a-z0-9_-]+)/i
  );
  if (createProjMatch) {
    return {
      intent: INTENTS.WORKSPACE_MANAGEMENT,
      confidence: 0.96,
      workspace: { action: 'create', projectName: createProjMatch[1] },
    };
  }

  // 14. Workspace Management: Switch / Bind Project
  const switchMatch = clean.match(
    /^(?:switch\s+(?:this\s+chat\s+|this\s+group\s+)?to|let(?:'s|\s+us)\s+work\s+on|change\s+project\s+to|bind\s+(?:this\s+group\s+to\s+)?|work\s+on)\s+([a-z0-9_.-]+)$/i
  );
  if (switchMatch) {
    const candidate = switchMatch[1].trim();
    return {
      intent: INTENTS.WORKSPACE_MANAGEMENT,
      confidence: 0.95,
      workspace: { action: 'switch', projectName: candidate },
    };
  }

  // 15. Visual QA / Screenshots
  if (
    clean.includes('screenshot') ||
    clean.includes('screen shot') ||
    clean.includes('capture the screen') ||
    clean.includes('capture screen') ||
    /\bvisual\s+preview\b/i.test(clean) ||
    /\bhow\s+does\s+(?:the\s+site|the\s+app|the\s+landing\s+page)\s+look\b/i.test(clean) ||
    /\bwhat\s+(?:the\s+site|the\s+app|the\s+landing\s+page)\s+looks\s+like\b/i.test(clean) ||
    /\bshow\s+me\s+(?:how\s+it\s+looks|the\s+site|the\s+preview|the\s+landing\s+page)\b/i.test(clean)
  ) {
    const isMobile = /\b(mobile|phone|responsive|viewport)\b/i.test(clean);
    const urlMatch = text.match(/(?:https?:\/\/[^\s]+|localhost:[0-9]+|:[0-9]{2,5})/i);
    return {
      intent: INTENTS.VISUAL_QA,
      confidence: 0.95,
      visualQa: {
        targetUrl: urlMatch ? urlMatch[0] : null,
        isMobile,
      },
    };
  }

  // 16. Git Push & Commit
  const pushMatch = clean.match(
    /^(?:please\s+)?(?:push\s+(?:our\s+|the\s+)?changes(?:\s+to\s+github|\s+to\s+git)?|git\s+push|commit\s+and\s+push)(?:\s+with\s+(?:the\s+)?message\s+['"]?([^'"]+)['"]?)?$/i
  );
  if (pushMatch) {
    return {
      intent: INTENTS.GIT_GITHUB,
      confidence: 0.96,
      git: {
        action: 'push',
        commitMessage: pushMatch[1]?.trim() || null,
        username: null,
        enabled: null,
      },
    };
  }

  // 17. Git Autopush Toggle
  if (/\b(?:turn\s+on|enable)\s+(?:auto-?push|automatic\s+push)\b/i.test(clean)) {
    return {
      intent: INTENTS.GIT_GITHUB,
      confidence: 0.95,
      git: { action: 'autopush_toggle', enabled: true, commitMessage: null, username: null },
    };
  }
  if (/\b(?:turn\s+off|disable)\s+(?:auto-?push|automatic\s+push)\b/i.test(clean)) {
    return {
      intent: INTENTS.GIT_GITHUB,
      confidence: 0.95,
      git: { action: 'autopush_toggle', enabled: false, commitMessage: null, username: null },
    };
  }

  // 18. File Transfer / Send
  const sendFileMatch = text.match(
    /^(?:can\s+you\s+)?(?:send|share)\s+(?:me\s+)?(?:the\s+)?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)$/i
  );
  if (sendFileMatch) {
    return {
      intent: INTENTS.FILE_OPERATIONS,
      confidence: 0.95,
      fileOps: { fileName: sendFileMatch[1].trim() },
    };
  }

  // 19. Collaborator requests
  const addCollabMatch = clean.match(
    /^(?:please\s+)?(?:add|invite)\s+@?([a-z0-9_.-]+)\s+(?:as\s+(?:a\s+)?)?(?:collab|collaborator)/i
  );
  if (addCollabMatch) {
    return {
      intent: INTENTS.GIT_GITHUB,
      confidence: 0.95,
      git: {
        action: 'collab_add',
        username: addCollabMatch[1].trim(),
        commitMessage: null,
        enabled: null,
      },
    };
  }
  const removeCollabMatch = clean.match(
    /^(?:please\s+)?(?:remove|revoke)\s+@?([a-z0-9_.-]+)\s+(?:from\s+collaborators|as\s+collaborator)/i
  );
  if (removeCollabMatch) {
    return {
      intent: INTENTS.GIT_GITHUB,
      confidence: 0.95,
      git: {
        action: 'collab_remove',
        username: removeCollabMatch[1].trim(),
        commitMessage: null,
        enabled: null,
      },
    };
  }
  if (/^(?:who\s+has\s+access(?:\s+to\s+this\s+repo)?|list\s+(?:all\s+)?collaborators|show\s+collaborators)$/i.test(clean)) {
    return {
      intent: INTENTS.GIT_GITHUB,
      confidence: 0.95,
      git: {
        action: 'collab_list',
        username: null,
        commitMessage: null,
        enabled: null,
      },
    };
  }

  // 20. Natural Language Question (pure conversational Q&A)
  if (
    /^(?:how\s+does|how\s+do\s+i|what\s+is\s+the\s+difference\s+between|why\s+would|explain\s+how|what\s+are\s+the\s+pros\s+and\s+cons)\b/i.test(
      lower
    ) &&
    !/\b(code|file|function|error|bug|issue|in\s+our\s+repo|in\s+this\s+project)\b/i.test(lower)
  ) {
    return {
      intent: INTENTS.CONVERSATIONAL_QA,
      confidence: 0.85,
      conversationalQa: { query: text, directReply: null },
    };
  }

  return null;
}

/**
 * Full Semantic Classification Pipeline:
 * 1. Fast Fuzzy Matcher (0ms)
 * 2. LLM Semantic Classifier (Gemini / Antigravity) with rich contextual grounding
 * 3. Fallback heuristic (coding task on active project)
 */
export async function classifyUserIntent({
  text,
  groupJid,
  recentHistory = [],
  senderName = 'User',
}) {
  const state = loadProjectsState();
  const friends = getFriends();
  const boundProject = state.groupBindings?.[groupJid] || state.activeProject || null;

  let availableProjects = Object.keys(state.projects || {});
  try {
    const listInfo = listProjectsForGroup(groupJid);
    if (listInfo.projects?.length > 0) {
      availableProjects = listInfo.projects;
    }
  } catch {}

  // --- Step 1: Fast Reflex & Fuzzy Rules ---
  const fastResult = fastFuzzyClassify(text, { availableProjects, boundProject });
  if (fastResult && fastResult.confidence >= 0.90) {
    console.log(`⚡ [NLP Reflex] Intent=${fastResult.intent} (Confidence: ${fastResult.confidence})`);
    return fastResult;
  }

  // --- Step 2: Tier 1 Fast Router (Custom Open-Weights / OpenRouter) ---
  const fastRouterResult = await queryFastRouter({
    text,
    availableProjects,
    boundProject,
    recentHistory,
  });

  if (fastRouterResult && fastRouterResult.intent) {
    console.log(`⚡ [FastRouter Tier 1] Intent=${fastRouterResult.intent} (Confidence: ${fastRouterResult.confidence || 0.95})`);

    // Normalize format to match dispatcher expectations
    if (fastRouterResult.intent === INTENTS.CODING_TASK && !fastRouterResult.codingTask) {
      fastRouterResult.codingTask = {
        instructions: fastRouterResult.instructions || text,
        targetProject: fastRouterResult.targetProject || null,
        isContinuation: false,
      };
    } else if (fastRouterResult.intent === INTENTS.CONVERSATIONAL_QA && !fastRouterResult.conversationalQa) {
      fastRouterResult.conversationalQa = {
        query: text,
        directReply: fastRouterResult.directReply || null,
      };
    } else if (fastRouterResult.intent === INTENTS.WORKSPACE_MANAGEMENT && !fastRouterResult.workspace) {
      fastRouterResult.workspace = {
        action: fastRouterResult.action || 'list',
        projectName: fastRouterResult.targetProject || null,
      };
    }

    return fastRouterResult;
  }

  // --- Step 3: LLM Semantic Classifier Fallback (Gemini) ---
  const activeTask = getActiveTaskInfo();
  const workspaceContext = [
    `Current System Context:`,
    `- Master Directory: ${state.masterDir ? `"${state.masterDir}"` : 'NOT_SET'}`,
    `- Currently Bound Project in this chat: ${boundProject ? `"${boundProject}"` : 'NONE'}`,
    `- Known Project Aliases: ${JSON.stringify(availableProjects)}`,
    `- Is an Agent Task currently executing right now?: ${Boolean(activeTask)}`,
    `- Registered Friends: ${JSON.stringify(friends.map((f) => ({ name: f.name, github: f.github })))}`,
    '',
    `Recent Conversation History:`,
    recentHistory.length > 0
      ? recentHistory.slice(-5).map((m) => `[${m.sender}]: ${m.text}`).join('\n')
      : '(No prior messages)',
    '',
    `Incoming Message from "${senderName}":`,
    `"${text}"`,
  ].join('\n');

  try {
    const res = await geminiClient.generateContent(
      workspaceContext,
      NLP_SYSTEM_PROMPT,
      { responseMimeType: 'application/json' }
    );

    let parsed = null;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      const match = res.text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    if (parsed && parsed.intent) {
      console.log(`🧠 [NLP Semantic Classifier] Intent=${parsed.intent} Confidence=${parsed.confidence}`);
      return parsed;
    }
  } catch (err) {
    console.warn('⚠️ [NLP Classifier] LLM classification unavailable, falling back:', err.message);
  }

  // --- Step 3: Graceful Fallback ---
  // If the user spoke something that wasn't caught by fast rules and LLM is unavailable:
  // Check if it's a conversational follow-up or coding instruction
  const lower = text.toLowerCase();
  const isContinuation =
    /^(?:also|and|now|then|next|undo|revert|make\s+it|change\s+that|fix\s+it)\b/i.test(lower);

  // Check if a project name was mentioned in brackets e.g. [wisewallets] or "in <project>"
  let targetProject = null;
  const projectMentionMatch = text.match(/\b(?:in|for|on)\s+([a-z0-9_-]+)\b/i);
  if (projectMentionMatch && availableProjects.includes(projectMentionMatch[1].toLowerCase())) {
    targetProject = projectMentionMatch[1].toLowerCase();
  }

  return {
    intent: INTENTS.CODING_TASK,
    confidence: 0.70,
    codingTask: {
      instructions: text,
      targetProject,
      isContinuation,
    },
  };
}
