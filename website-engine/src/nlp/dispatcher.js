import fs from 'fs';
import path from 'path';
import { INTENTS } from './intents.js';
import {
  CONFIG,
  loadProjectsState,
  saveProjectsState,
  updateTriggerPrefix,
  getConnectedUserEmail,
} from '../config.js';
import {
  listProjectsForGroup,
  switchGroupProject,
  unbindGroupProject,
  getGroupProjectStatus,
  createProjectUnderMaster,
} from '../autopilot/workspace.js';
import {
  handleCollaboratorRequest,
  executeCollaboratorInvite,
} from '../autopilot/friends.js';
import {
  stopActiveTask,
  getActiveTaskInfo,
  gitCommitAndPush,
  listGitHubCollaborators,
  removeGitHubCollaborator,
} from '../agent.js';
import { captureWebScreenshot, getProjectDeploymentUrl } from '../qa.js';
import { checkAndApplyOtaUpdate, getOtaStatus } from '../ota.js';
import { handleCabRequest } from '../concierge/cabs/cabService.js';
import { handleSwiggyRequest } from '../concierge/swiggy/swiggyService.js';
import { handleEmailRequest } from '../concierge/emailService.js';
import {
  executePortfolioCreation,
  iteratePortfolioDesign,
} from '../portfolio/portfolioOrchestrator.js';
import { geminiClient } from '../gemini-client.js';
import { sendChoicePoll } from '../autopilot/polls.js';

/**
 * Dispatches a classified intent to its corresponding handler.
 * Returns { handled: true } if completely executed, or
 * returns { isCodingTask: true, ... } if the request is a coding task to be queued.
 */
export async function dispatchIntent({
  intentResult,
  sock,
  jid,
  msg,
  rawBody,
  owner,
  isGroup,
  boundProject,
  state,
  taskQueue = [],
  currentRunningItem = null,
  sendReply,
  reactToMessage,
  sendWhatsAppFile,
  recentChatContext = '',
  chatHistory = [],
}) {
  const { intent, confidence } = intentResult;

  // 1. Task Control (Stop, Status, Context Reset, Append)
  if (intent === INTENTS.TASK_CONTROL) {
    const action = intentResult.taskControl?.action || 'status';

    if (action === 'stop') {
      const active = getActiveTaskInfo();
      const running = currentRunningItem;

      if (active && !owner && isGroup && active.projectAlias !== boundProject) {
        await sendReply(sock, jid, `🔒 You cannot stop a task running for another group.`, msg);
        return { handled: true };
      }

      let stoppedSomething = false;
      if (running) {
        running.cancelled = true;
        stoppedSomething = true;
      }

      const stopped = stopActiveTask();
      if (stopped) stoppedSomething = true;

      // Cancel any queued tasks for this jid
      const qIdx = taskQueue.findIndex((item) => item.jid === jid);
      if (qIdx !== -1) {
        taskQueue.splice(qIdx, 1);
        stoppedSomething = true;
      }

      await reactToMessage(sock, msg, '🛑');
      if (stoppedSomething) {
        await sendReply(sock, jid, `🛑 *Stopped.* The active task was cancelled.`, msg);
      } else {
        await sendReply(sock, jid, `⚪ Nothing is currently running or queued.`, msg);
      }
      return { handled: true };
    }

    if (action === 'status') {
      const active = getActiveTaskInfo();
      if (!active) {
        await sendReply(
          sock,
          jid,
          `🟢 *Weave is Idle*\nProject: \`${boundProject || 'unbound'}\`\nQueue: ${taskQueue.length} task(s)\n\nWhat shall we build next?`,
          msg
        );
      } else {
        await sendReply(
          sock,
          jid,
          `🟡 *Working on \`${active.projectAlias}\`:*\n"${active.taskPrompt}"\n\nQueued: ${taskQueue.length} task(s)`,
          msg
        );
      }
      return { handled: true };
    }

    if (action === 'reset_context') {
      const fresh = loadProjectsState();
      fresh.conversations = fresh.conversations || {};
      if (boundProject) {
        delete fresh.conversations[boundProject];
      }
      delete fresh.conversations[null];
      saveProjectsState(fresh);

      await reactToMessage(sock, msg, '✨');
      await sendReply(
        sock,
        jid,
        `✨ *Session context refreshed!*\nWe're starting with a clean slate for \`${boundProject || 'the active project'}\`.`,
        msg
      );
      return { handled: true };
    }

    if (action === 'append_context') {
      const note = intentResult.taskControl?.contextNote || rawBody;
      return {
        isCodingTask: true,
        taskPrompt: `By the way, additional instruction: ${note}`,
        continueSession: true,
      };
    }
  }

  // 2. Workspace Management (List, Switch/Bind, Unbind, Create, Status)
  if (intent === INTENTS.WORKSPACE_MANAGEMENT) {
    const action = intentResult.workspace?.action || 'list';
    const requestedProject = intentResult.workspace?.projectName?.trim();

    if (action === 'list') {
      try {
        const listInfo = listProjectsForGroup(jid);
        const bullets =
          listInfo.projects.length > 0
            ? listInfo.projects
                .map((p) => `• *${p}*${p === listInfo.boundAlias ? ' _(Active in this chat)_' : ''}`)
                .join('\n')
            : '_No projects found in Master Directory._';

        await sendReply(
          sock,
          jid,
          `📂 *Available Projects:*\n${bullets}\n\n💡 _To work on one, just tell me: "let's switch to <project-name>"_`,
          msg
        );
      } catch (err) {
        // Fallback to state.projects
        const keys = Object.keys(state.projects || {});
        const bullets =
          keys.length > 0
            ? keys
                .map((p) => `• *${p}*${p === boundProject ? ' _(Active)_' : ''}`)
                .join('\n')
            : '_No projects registered yet._';
        await sendReply(
          sock,
          jid,
          `📂 *Registered Projects:*\n${bullets}\n\n💡 _To work on one, tell me: "switch to <name>"_`,
          msg
        );
      }
      return { handled: true };
    }

    if (action === 'status') {
      const st = getGroupProjectStatus(jid);
      await sendReply(
        sock,
        jid,
        st.bound
          ? `📍 *Active Project in this chat:* \`${st.alias}\`\n📁 *Location:* \`${st.path}\``
          : `⚪ No project is currently bound to this chat.\n💡 _Tell me: "switch to <project-name>" to connect one._`,
        msg
      );
      return { handled: true };
    }

    if (action === 'unbind') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can disconnect projects from this chat.`, msg);
        return { handled: true };
      }
      const unb = unbindGroupProject(jid);
      await sendReply(
        sock,
        jid,
        `🔓 *Disconnected from \`${unb.previous || 'project'}\`.*\nThis chat is now unbound. Tell me "switch to <project>" anytime to reconnect!`,
        msg
      );
      return { handled: true };
    }

    if (action === 'create' && requestedProject) {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can create new project directories.`, msg);
        return { handled: true };
      }
      try {
        const res = createProjectUnderMaster(requestedProject, jid);
        await reactToMessage(sock, msg, '📁');
        await sendReply(
          sock,
          jid,
          `📁 *Created & Connected Project: \`${res.alias}\`*\nPath: \`${res.path}\`\nThis chat is now actively working on \`${res.alias}\`.`,
          msg
        );
      } catch (err) {
        await sendReply(sock, jid, `⚠️ Could not create project: ${err.message}`, msg);
      }
      return { handled: true };
    }

    if ((action === 'switch' || action === 'bind') && requestedProject) {
      if (isGroup && !owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can switch project bindings in group chats.`, msg);
        return { handled: true };
      }
      try {
        const res = switchGroupProject(requestedProject, jid);
        await reactToMessage(sock, msg, '🔄');
        await sendReply(
          sock,
          jid,
          `🔄 *Switched Active Project to: \`${res.alias}\`*\nPath: \`${res.path}\`\nAll coding tasks in this chat will now target this project.`,
          msg
        );
      } catch (err) {
        // Check if project exists in general projects map
        const stateFresh = loadProjectsState();
        let targetAlias = null;
        for (const [alias] of Object.entries(stateFresh.projects || {})) {
          if (alias.toLowerCase() === requestedProject.toLowerCase()) {
            targetAlias = alias;
            break;
          }
        }
        if (targetAlias) {
          if (isGroup) {
            stateFresh.groupBindings = stateFresh.groupBindings || {};
            stateFresh.groupBindings[jid] = targetAlias;
          }
          stateFresh.activeProject = targetAlias;
          saveProjectsState(stateFresh);
          await reactToMessage(sock, msg, '🔄');
          await sendReply(
            sock,
            jid,
            `🔄 *Switched Active Project to: \`${targetAlias}\`*\nAll coding tasks in this chat will now target this project.`,
            msg
          );
        } else {
          await sendReply(
            sock,
            jid,
            `⚠️ Could not find project "${requestedProject}". Ask me "what projects do we have?" to view available ones.`,
            msg
          );
        }
      }
      return { handled: true };
    }
  }

  // 3. Visual QA & Screenshots
  if (intent === INTENTS.VISUAL_QA) {
    const activeProj = isGroup ? state.groupBindings?.[jid] : state.activeProject;
    const projDir = (activeProj && state.projects?.[activeProj]) || CONFIG.defaultProjectDir;
    const isMobile = Boolean(intentResult.visualQa?.isMobile);
    let target = intentResult.visualQa?.targetUrl || '';

    if (!target) {
      target = (await getProjectDeploymentUrl(projDir, activeProj)) || 'http://localhost:3000';
    }

    await reactToMessage(sock, msg, '📸');
    try {
      const { filePath, url, width, height } = await captureWebScreenshot(target, { mobile: isMobile });
      const projectLabel = activeProj ? `\n📁 *Project:* \`${activeProj}\`` : '';
      await sendWhatsAppFile(
        sock,
        jid,
        filePath,
        `📸 *Visual Preview*${projectLabel}\n🌐 *URL:* ${url}\n📐 *Resolution:* ${width}x${height}${isMobile ? ' (Mobile)' : ''}`,
        msg
      );
      await reactToMessage(sock, msg, '✅');
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(sock, jid, `❌ Could not capture preview: ${err.message}`, msg);
    }
    return { handled: true };
  }

  // 4. Git & GitHub Operations
  if (intent === INTENTS.GIT_GITHUB) {
    const gitAction = intentResult.git?.action || 'push';

    if (gitAction === 'push') {
      if (!boundProject || !state.projects[boundProject]) {
        await sendReply(sock, jid, `⚠️ No project is connected to this chat. Tell me "switch to <project>" first!`, msg);
        return { handled: true };
      }
      const commitMsg = intentResult.git?.commitMessage || 'Update via WhatsApp Agent';
      await reactToMessage(sock, msg, '⏳');
      try {
        const info = gitCommitAndPush(state.projects[boundProject], commitMsg);
        await reactToMessage(sock, msg, '🚀');
        await sendReply(
          sock,
          jid,
          `🚀 Pushed \`${boundProject}\` to \`${info.branch}\` (\`${info.commitHash}\`).`,
          msg
        );
      } catch (err) {
        await reactToMessage(sock, msg, '❌');
        await sendReply(sock, jid, `❌ Git push failed: ${err.message}`, msg);
      }
      return { handled: true };
    }

    if (gitAction === 'autopush_toggle') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can toggle auto-push.`, msg);
        return { handled: true };
      }
      if (!boundProject || !state.projects[boundProject]) {
        await sendReply(sock, jid, `⚠️ No project connected to this chat. Connect one first!`, msg);
        return { handled: true };
      }
      const enable = intentResult.git?.enabled !== false;
      const fresh = loadProjectsState();
      fresh.autoPush = fresh.autoPush || {};
      fresh.autoPush[boundProject] = enable;
      saveProjectsState(fresh);

      await sendReply(
        sock,
        jid,
        `🚀 Automatic GitHub push for *${boundProject}* is now *${enable ? 'ON' : 'OFF'}*.`,
        msg
      );
      return { handled: true };
    }

    if (gitAction === 'collab_add' && intentResult.git?.username) {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can invite repository collaborators.`, msg);
        return { handled: true };
      }
      const req = handleCollaboratorRequest({
        requestedName: intentResult.git.username,
        role: 'write',
        groupJid: jid,
        projectDir: state.projects[boundProject] || CONFIG.defaultProjectDir,
      });

      if (req.status === 'unknown') {
        await sendReply(sock, jid, req.replyPrompt, msg);
        return { handled: true };
      }

      if (req.status === 'known') {
        await reactToMessage(sock, msg, '⏳');
        try {
          const res = await executeCollaboratorInvite({
            username: req.username,
            permission: req.permission,
            projectDir: state.projects[boundProject] || CONFIG.defaultProjectDir,
          });
          await reactToMessage(sock, msg, '🤝');
          await sendReply(
            sock,
            jid,
            res.isAlready
              ? `✅ *@${req.username}* is already a collaborator on \`${res.owner}/${res.repo}\`.`
              : `🤝 Invited *${req.friend.name}* (\`@${req.username}\`) to \`${res.owner}/${res.repo}\` (${res.permission}) — ${res.invitationUrl}`,
            msg
          );
        } catch (err) {
          await sendReply(sock, jid, `❌ Failed to invite @${req.username}: ${err.message}`, msg);
        }
        return { handled: true };
      }
    }

    if (gitAction === 'collab_list') {
      try {
        const info = await listGitHubCollaborators({
          projectDir: state.projects[boundProject] || CONFIG.defaultProjectDir,
        });
        const collabs = info.collaborators.map((c) => `• @${c.username} (${c.permission})`).join('\n') || '_None_';
        await sendReply(sock, jid, `👥 *Collaborators on \`${info.owner}/${info.repo}\`:*\n${collabs}`, msg);
      } catch (err) {
        await sendReply(sock, jid, `⚠️ Could not list collaborators: ${err.message}`, msg);
      }
      return { handled: true };
    }
  }

  // 5. File Operations (Send file)
  if (intent === INTENTS.FILE_OPERATIONS) {
    const rawFileName = intentResult.fileOps?.fileName;
    if (rawFileName) {
      const activeProjDir = state.projects[boundProject] || CONFIG.defaultProjectDir;
      let targetPath = path.resolve(activeProjDir, rawFileName);

      if (!fs.existsSync(targetPath)) {
        targetPath = path.resolve(process.cwd(), rawFileName);
      }

      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        await reactToMessage(sock, msg, '📎');
        await sendWhatsAppFile(sock, jid, targetPath, `📎 *File:* \`${path.basename(targetPath)}\``, msg);
        return { handled: true };
      } else {
        await sendReply(sock, jid, `⚠️ Could not find file "${rawFileName}" in project.`, msg);
        return { handled: true };
      }
    }
  }

  // 6. Agent Lifecycle (Sleep, Wakeup, Callsign, OTA Update)
  if (intent === INTENTS.AGENT_LIFECYCLE) {
    const lifeAction = intentResult.lifecycle?.action || 'wakeup';

    if (lifeAction === 'sleep') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can put Weave to sleep.`, msg);
        return { handled: true };
      }
      const fresh = loadProjectsState();
      fresh.disabledGroups = fresh.disabledGroups || {};
      fresh.disabledGroups[jid] = true;
      saveProjectsState(fresh);

      await reactToMessage(sock, msg, '😴');
      await sendReply(sock, jid, `😴 *Going to sleep in this chat.*\nSay "wake up" anytime to bring me back!`, msg);
      return { handled: true };
    }

    if (lifeAction === 'wakeup') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can wake up Weave.`, msg);
        return { handled: true };
      }
      const fresh = loadProjectsState();
      fresh.disabledGroups = fresh.disabledGroups || {};
      delete fresh.disabledGroups[jid];
      saveProjectsState(fresh);

      await reactToMessage(sock, msg, '⚡');
      await sendReply(
        sock,
        jid,
        `⚡ *I'm awake and ready!*\nConnected to \`${boundProject || 'unbound'}\`. What are we building today?`,
        msg
      );
      return { handled: true };
    }

    if (lifeAction === 'callsign_change' && intentResult.lifecycle?.newCallsign) {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can change the call-sign.`, msg);
        return { handled: true };
      }
      const res = updateTriggerPrefix(intentResult.lifecycle.newCallsign);
      if (!res.success) {
        await sendReply(sock, jid, `⚠️ ${res.error}`, msg);
        return { handled: true };
      }
      await reactToMessage(sock, msg, '✅');
      await sendReply(
        sock,
        jid,
        `✅ *Weave Call-Sign updated to:* \`${res.triggerPrefix}\`\n\nPrompt me anytime using *${res.triggerPrefix} <task>*.`,
        msg
      );
      return { handled: true };
    }

    if (lifeAction === 'ota_update') {
      await reactToMessage(sock, msg, '⏳');
      try {
        const res = await checkAndApplyOtaUpdate({});
        await reactToMessage(sock, msg, '✅');
        if (res.updated) {
          await sendReply(
            sock,
            jid,
            `⚡ *Weave Live Update Applied!*\n• *Version:* \`v${res.version}\`\n• *Files updated:* ${res.filesUpdated}\n• *Status:* Live in-place (no restart needed)`,
            msg
          );
        } else {
          const status = getOtaStatus();
          await sendReply(sock, jid, `✅ *Weave is already up to date* (\`v${status.version}\`).`, msg);
        }
      } catch (err) {
        await sendReply(sock, jid, `⚠️ Update check failed: ${err.message}`, msg);
      }
      return { handled: true };
    }
  }

  // 7. Cab Booking & Route Fare Comparison (Uber, Ola, Namma Yatri)
  if (intent === INTENTS.CAB_BOOKING) {
    if (reactToMessage) {
      await reactToMessage(sock, msg, '🚖').catch(() => {});
    }
    try {
      const card = await handleCabRequest({
        text: rawBody,
        msg,
        intentResult,
      });
      await sendReply(sock, jid, card, msg);
    } catch (err) {
      await sendReply(
        sock,
        jid,
        `⚠️ *Could not fetch cab comparison:* ${err.message}`,
        msg
      );
    }
    return { handled: true };
  }

  // 8. Swiggy Food & Instamart Groceries
  if (intent === INTENTS.SWIGGY) {
    if (reactToMessage) {
      const isIm = intentResult.swiggy?.service === 'instamart' || /instamart|grocery/i.test(rawBody);
      await reactToMessage(sock, msg, isIm ? '⚡' : '🍽️').catch(() => {});
    }
    try {
      const card = await handleSwiggyRequest({
        text: rawBody,
        msg,
        intentResult,
        jid,
      });
      await sendReply(sock, jid, card, msg);
    } catch (err) {
      await sendReply(
        sock,
        jid,
        `⚠️ *Could not process Swiggy request:* ${err.message}`,
        msg
      );
    }
    return { handled: true };
  }

  // 8.4. Email & Conversation Summary (Catch-Up & Project Delivery)
  if (intent === INTENTS.EMAIL) {
    try {
      const res = await handleEmailRequest({
        text: rawBody,
        rawBody,
        intentResult,
        jid,
        msg,
        owner,
        isGroup,
        boundProject,
        state,
        recentChatContext,
        chatHistory,
        sock,
        sendReply,
        reactToMessage,
        sendWhatsAppFile,
      });
      return res;
    } catch (err) {
      console.error('[Dispatcher] Email Request Error:', err);
      await sendReply(
        sock,
        jid,
        `⚠️ *Could not process email request:* ${err.message}`,
        msg
      );
      return { handled: true };
    }
  }

  // 8.5. Portfolio Creation & Stitch MCP Generation (Netlify Drop)
  if (intent === INTENTS.PORTFOLIO) {
    if (reactToMessage) {
      await reactToMessage(sock, msg, '🎨').catch(() => {});
    }
    try {
      const isIteration = intentResult.portfolio?.isIteration;
      if (isIteration) {
        const iterRes = await iteratePortfolioDesign({
          chatJid: jid,
          feedbackText: rawBody,
        });

        if (iterRes?.updatedShotPath && fs.existsSync(iterRes.updatedShotPath)) {
          await sendWhatsAppFile(
            sock,
            jid,
            iterRes.updatedShotPath,
            `📸 *Updated Design Preview* (${iterRes.updatedPhilosophy ? iterRes.updatedPhilosophy.toUpperCase() : 'ACTIVE'})`,
            msg
          );
        }

        const cleanedText = (iterRes?.messageText || '')
          .replace(/\[SEND_FILE:[^\]]+\]/g, '')
          .trim();
        if (cleanedText) {
          await sendReply(sock, jid, cleanedText, msg);
        }
        if (reactToMessage) await reactToMessage(sock, msg, '✅').catch(() => {});
        return { handled: true };
      }

      // New Portfolio Website creation
      const defaultProjDir =
        (boundProject && state?.projects?.[boundProject]) ||
        path.resolve(process.cwd(), 'demo-site');

      // 1. Instant acknowledgment without long pause
      if (reactToMessage) await reactToMessage(sock, msg, '🚀').catch(() => {});
      await sendReply(
        sock,
        jid,
        `Yeah, hey, I'm just working on it! 🚀`,
        msg
      ).catch(() => {});

      // 2. Interactive Discovery Poll (Vibe & Aesthetic)
      const voterJid = msg?.key?.fromMe
        ? (sock?.user?.id || jid)
        : (msg?.key?.participant || msg?.key?.remoteJid || jid);

      try {
        await sendChoicePoll(sock, {
          groupJid: jid,
          allowedVoterJid: voterJid,
          question: 'What vibe or aesthetic are you going for?',
          options: [
            '1️⃣ Minimalist & Clean (Editorial whitespace)',
            '2️⃣ Dark Cyber & High-Tech (Glowing accents)',
            '3️⃣ Warm & Artisanal (Craft tones & serif)',
            '4️⃣ Bold & Vibrant (Bento grid & dynamic)',
          ],
          intent: 'choice_needed',
          originalTask: rawBody,
          context: 'website_vibe_choice',
        });
      } catch (pollErr) {
        console.warn('[Dispatcher] Vibe poll notice:', pollErr.message);
      }

      // 3. Product Discovery Follow-up (Agent 2 - Conversational Product Discovery)
      await sendReply(
        sock,
        jid,
        `While the Stitch UI agent creates the layouts in the background, tell me a bit more about the product:\n• What's the main goal or call-to-action for visitors (e.g. book a call, order online, join waitlist)?\n• Are there any specific features or products you want front and center?`,
        msg
      ).catch(() => {});

      // Initialize session state so early poll votes and product notes can attach immediately
      const preState = loadProjectsState();
      preState.portfolioSessions = preState.portfolioSessions || {};
      preState.portfolioSessions[jid] = {
        ...(preState.portfolioSessions[jid] || {}),
        projectDir: defaultProjDir,
        projectAlias: boundProject || 'portfolio-website',
        originalPrompt: rawBody,
        status: 'generating',
        createdAt: new Date().toISOString(),
      };
      saveProjectsState(preState);

      // 4. Background UI Generation Agent (Agent 1 - Stitch MCP UI Agent)
      // Runs autonomously in the background without blocking conversation
      (async () => {
        try {
          console.log(`[StitchUIAgent] Background generation started for prompt: "${rawBody}"`);
          const result = await executePortfolioCreation({
            prompt: rawBody,
            chatJid: jid,
            targetProjectDir: defaultProjDir,
            projectAlias: boundProject || 'portfolio-website',
            senderName: msg?.pushName || 'Founder / Architect',
          });

          // Send all 3 Google Stitch design variations
          if (result.variants && result.variants.length > 0) {
            for (const v of result.variants) {
              if (v.screenshotPath && fs.existsSync(v.screenshotPath)) {
                console.log(`[StitchUIAgent] Sending screenshot for Option ${v.option}: ${v.name} (${v.screenshotPath})`);
                try {
                  await sendWhatsAppFile(
                    sock,
                    jid,
                    v.screenshotPath,
                    `🎨 *Option ${v.option}: ${v.name}*\n_${v.description}_`,
                    msg
                  );
                } catch (shotErr) {
                  console.warn(`[StitchUIAgent] Failed to send screenshot for ${v.name}:`, shotErr.message);
                }
              }
            }
          }

          // Send deploy card message
          const cleanedText = result.messageText.replace(/\[SEND_FILE:[^\]]+\]/g, '').trim();
          await sendReply(sock, jid, cleanedText, msg);
          if (reactToMessage) await reactToMessage(sock, msg, '✅').catch(() => {});
        } catch (err) {
          console.error('[StitchUIAgent] Portfolio Creation Error:', err);
          await sendReply(
            sock,
            jid,
            `❌ *Stitch Screen Generation Error:* ${err.message}`,
            msg
          );
          if (reactToMessage) await reactToMessage(sock, msg, '❌').catch(() => {});
        }
      })();

      return { handled: true };
    } catch (err) {
      console.error('[Dispatcher] Portfolio Creation Error:', err);
      await sendReply(
        sock,
        jid,
        `❌ *Portfolio Creation Error:* ${err.message}`,
        msg
      );
      if (reactToMessage) await reactToMessage(sock, msg, '❌').catch(() => {});
      return { handled: true };
    }
  }

  // 8.6. Product Discovery & Personalization: Handle founder's product emphasis while or after website build
  const activePortfolioSession = state?.portfolioSessions?.[jid];
  const isWebsiteCreationOrIteration = intent === INTENTS.PORTFOLIO;
  const isExplicitControl =
    intent === INTENTS.TASK_CONTROL ||
    intent === INTENTS.WORKSPACE_MANAGEMENT ||
    intent === INTENTS.GIT_GITHUB ||
    intent === INTENTS.EMAIL ||
    intent === INTENTS.CAB_BOOKING ||
    intent === INTENTS.SWIGGY;

  const isEmailOrSummary =
    intent === INTENTS.EMAIL ||
    /\b(?:email|mail|summary|recap|catch\s*up|context|calendar|meeting)\b/i.test(rawBody);

  const productKeywordsRegex =
    /\b(?:emphasize|highlight|feature|features|call\s*to\s*action|cta|goal|visitors?|product|service|audience|pricing|headline|logo|brand|order|book|sell|contact|signup|sign\s*up)\b/i;

  const isWebsiteContext =
    activePortfolioSession?.status === 'generating' ||
    /\b(?:website|site|page|hero|navbar|footer|layout|vibe|portfolio|design|section)\b/i.test(rawBody);

  if (activePortfolioSession && !isWebsiteCreationOrIteration && !isExplicitControl && !isEmailOrSummary) {
    const isProductDetailMessage = isWebsiteContext && productKeywordsRegex.test(rawBody);

    if (isProductDetailMessage) {
      if (reactToMessage) await reactToMessage(sock, msg, '✨').catch(() => {});
      try {
        const productAckPrompt = `You are Weave, a sharp, friendly developer and product designer chatting with a founder on WhatsApp.
The founder just responded with their product focus, key features, or what to emphasize on their website:
"${rawBody}"

Original website request: "${activePortfolioSession.originalPrompt || activePortfolioSession.projectAlias || 'Website'}"

In 1-2 punchy, encouraging, conversational sentences:
1. Validate their product emphasis and highlight why it makes the site stronger.
2. Confirm you are weaving that into the messaging, hero section, and offerings.
Tone: Helpful developer friend on WhatsApp (informal, confident, zero corporate fluff).`;

        const res = await geminiClient.generateContent(productAckPrompt);
        const replyText = res.text?.trim() || `Love that focus! Incorporating that directly into the site's layout and messaging ✨`;
        await sendReply(sock, jid, replyText, msg);

        // Store into session
        const freshState = loadProjectsState();
        if (freshState.portfolioSessions?.[jid]) {
          const prevNotes = freshState.portfolioSessions[jid].productNotes || '';
          freshState.portfolioSessions[jid].productNotes = prevNotes ? `${prevNotes}\n${rawBody}` : rawBody;
          saveProjectsState(freshState);
        }
        return { handled: true };
      } catch (noteErr) {
        console.warn('[Dispatcher] Product note acknowledgement notice:', noteErr.message);
      }
    }
  }

  // 9. Conversational Q&A (Informational question without file edits)
  if (intent === INTENTS.CONVERSATIONAL_QA) {
    const query = intentResult.conversationalQa?.query || rawBody;
    const directReply = intentResult.conversationalQa?.directReply;

    if (directReply) {
      await sendReply(sock, jid, directReply, msg);
      return { handled: true };
    }

    await reactToMessage(sock, msg, '💡');
    try {
      const prompt = `You are Weave, a friendly and expert developer companion on WhatsApp. Answer the user's question concisely in clear Markdown formatted for WhatsApp (1-2 short paragraphs max):\n\nQuestion: "${query}"`;
      const res = await geminiClient.generateContent(prompt);
      await sendReply(sock, jid, res.text || 'I understand, but have no additional details right now.', msg);
    } catch (err) {
      // If direct generation fails, let it fall through to coding task
      return {
        isCodingTask: true,
        taskPrompt: query,
        continueSession: false,
      };
    }
    return { handled: true };
  }

  // 8. Help / Capabilities Guide (Pure Natural Language UX - Zero Slash Commands!)
  if (intent === INTENTS.HELP_GUIDE) {
    const trig = CONFIG.triggerPrefix;
    const projLabel = boundProject ? `\`${boundProject}\`` : '_None (unbound)_';
    const helpMessage = [
      `👋 *Hi, I'm Weave!* Your natural language WhatsApp coding agent.`,
      `📍 *Current Project:* ${projLabel}`,
      '',
      `Just talk to me like a teammate using *${trig}* followed by plain English:`,
      '',
      `💻 *Code & Features:*`,
      `• *"${trig} add a dark mode toggle to the navbar"*`,
      `• *"${trig} fix the crash when clicking checkout"*`,
      `• *"${trig} make that button rounded and emerald green"*`,
      '',
      `📁 *Projects & Workspaces:*`,
      `• *"${trig} what projects do we have?"*`,
      `• *"${trig} switch this chat to portfolio-website"*`,
      `• *"${trig} start a new project called payment-gateway"*`,
      '',
      `📸 *Visual UI Previews:*`,
      `• *"${trig} show me what the landing page looks like on mobile"*`,
      `• *"${trig} screenshot localhost:3000"*`,
      '',
      `🚀 *Git & GitHub:*`,
      `• *"${trig} push our changes to github with message 'fixed navbar'"*`,
      `• *"${trig} invite @alex to collaborate on this repo"*`,
      '',
      `📎 *Files & Sharing:*`,
      `• *"${trig} send me package.json"*`,
      '',
      `🛑 *Control & Questions:*`,
      `• *"${trig} what are you working on right now?"*`,
      `• *"${trig} stop what you're doing"*`,
      `• *"${trig} how does JWT refresh token rotation work?"*`,
    ].join('\n');

    await sendReply(sock, jid, helpMessage, msg);
    return { handled: true };
  }

  // 9. Clarification Needed
  if (intent === INTENTS.CLARIFICATION_NEEDED && intentResult.clarification) {
    const { question, options } = intentResult.clarification;
    const optionBullets = (options || []).map((o, idx) => `*${idx + 1}.* ${o}`).join('\n');
    await sendReply(
      sock,
      jid,
      `🤔 *${question}*\n\n${optionBullets}\n\n_Reply with 1, 2... or tell me what you'd like to do!_`,
      msg
    );
    return { handled: true };
  }

  // 10. Default: Coding Task
  return {
    isCodingTask: true,
    taskPrompt: intentResult.codingTask?.instructions || rawBody,
    targetProject: intentResult.codingTask?.targetProject || null,
    continueSession: Boolean(intentResult.codingTask?.isContinuation),
  };
}
