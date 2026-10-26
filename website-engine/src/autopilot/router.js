import { GeminiClient } from '../gemini-client.js';
import { AUTOPILOT_ROUTER_SYSTEM_PROMPT } from './guidelines.js';
import { loadProjectsState, getFriends } from '../config.js';
import { listProjectsForGroup } from './workspace.js';

let geminiClientInstance = null;

function getGeminiClient() {
  if (!geminiClientInstance) {
    geminiClientInstance = new GeminiClient();
  }
  return geminiClientInstance;
}

/**
 * Deterministic intent router powered by Gemini 2.5 Flash with low temperature.
 * Strictly classifies into: laptop_task, system_command, chat, or choice_needed.
 */
export async function routeAutopilotIntent({ prompt, groupJid, recentHistory = [] }) {
  const gemini = getGeminiClient();
  const state = loadProjectsState();

  let workspaceContext = {
    masterDir: state.masterDir || '',
    boundProject: state.groupBindings?.[groupJid] || null,
    availableProjects: [],
  };

  try {
    const listInfo = listProjectsForGroup(groupJid);
    workspaceContext.availableProjects = listInfo.projects || [];
  } catch {
    // If masterDir is not set yet, availableProjects remains empty
  }

  const promptPayload = [
    `Current Workspace Context:`,
    `- Master Directory: ${workspaceContext.masterDir ? `"${workspaceContext.masterDir}"` : 'NOT_SET'}`,
    `- Currently Active Project in this WhatsApp group: ${workspaceContext.boundProject ? `"${workspaceContext.boundProject}"` : 'NONE'}`,
    `- Subproject Folders inside Master Directory: ${JSON.stringify(workspaceContext.availableProjects)}`,
    '',
    `Recent Conversation Context:`,
    recentHistory.length > 0
      ? recentHistory.map((m) => `[${m.sender}]: ${m.text}`).join('\n')
      : '(No prior messages)',
    '',
    `Incoming Message:`,
    `"${prompt}"`,
    '',
    `Classify this message into EXACTLY ONE of the 4 execution lanes:`,
    `1. "laptop_task": Build, edit, fix, run, test, deploy, inspect code, or terminal work in the active project.`,
    `2. "system_command": One of ["list_projects", "create_project", "switch_project", "current_project", "unbind_project", "view_access", "manage_access"].`,
    `3. "chat": General question, tech concept explanation, advice, or greeting that does NOT edit files or run commands.`,
    `4. "choice_needed": User must make a choice (e.g. which project to switch to, where to deploy, or clarify ambiguous intent).`,
    '',
    `Return ONLY a JSON object conforming to this schema:`,
    `{`,
    `  "intent": "laptop_task" | "system_command" | "chat" | "choice_needed",`,
    `  "systemCommand": "list_projects" | "create_project" | "switch_project" | "current_project" | "unbind_project" | "view_access" | "manage_access" | null,`,
    `  "projectName": string | null,`,
    `  "accessAction": "grant" | "revoke" | null,`,
    `  "targetUser": string | null,`,
    `  "laptopTaskInstructions": string | null,`,
    `  "chatReplyText": string | null,`,
    `  "choiceQuestion": string | null,`,
    `  "choiceOptions": string[] | null,`,
    `  "choiceContext": string | null`,
    `}`,
  ].join('\n');

  try {
    const res = await gemini.generateContent(
      promptPayload,
      AUTOPILOT_ROUTER_SYSTEM_PROMPT,
      {
        temperature: 0.1,
        responseMimeType: 'application/json',
      }
    );

    let parsed = null;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      const match = res.text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    }

    if (!parsed || !parsed.intent) {
      return {
        intent: 'chat',
        chatReplyText: res.text || 'yo, how can i help?',
      };
    }

    // SECTION 4 & 5 ENFORCEMENT:
    // 1. If laptop_task requested but no project is active in this group:
    if (parsed.intent === 'laptop_task' && !workspaceContext.boundProject) {
      const avail = workspaceContext.availableProjects || [];
      // If there's only 1 project available, automatically bind/use it!
      if (avail.length === 1) {
        return {
          ...parsed,
          autoActivateProject: avail[0],
        };
      }
      // If the user's prompt explicitly mentions one of the available projects, use it!
      const lowerPrompt = prompt.toLowerCase();
      const mentioned = avail.find(p => lowerPrompt.includes(p.toLowerCase()));
      if (mentioned) {
        return {
          ...parsed,
          autoActivateProject: mentioned,
        };
      }
      if (avail.length > 1) {
        return {
          intent: 'choice_needed',
          choiceQuestion: 'no active project in this group rn. which one should we work on?',
          choiceOptions: avail.slice(0, 8),
          choiceContext: 'activate_project_for_task',
          originalTask: prompt,
        };
      }
    }

    // 2. If switch_project requested without specifying project name:
    if (parsed.intent === 'system_command' && parsed.systemCommand === 'switch_project' && !parsed.projectName) {
      const candidateProjects = (workspaceContext.availableProjects || []).filter(p => p !== workspaceContext.boundProject);
      if (candidateProjects.length === 1) {
        return {
          intent: 'system_command',
          systemCommand: 'switch_project',
          projectName: candidateProjects[0],
        };
      }
      if (candidateProjects.length > 1) {
        return {
          intent: 'choice_needed',
          choiceQuestion: 'which project do you want to switch to?',
          choiceOptions: candidateProjects.slice(0, 8),
          choiceContext: 'switch_project',
          originalTask: prompt,
        };
      }
    }

    return parsed;
  } catch (err) {
    console.error('⚠️ Autopilot router failed, falling back to chat:', err.message);
    return {
      intent: 'chat',
      chatReplyText: `hit a snag routing that: ${err.message}`,
    };
  }
}
