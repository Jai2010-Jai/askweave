import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { geminiClient } from '../gemini-client.js';
import { googleAuth } from '../auth.js';
import { googleServices } from '../google-services.js';
import {
  CONFIG,
  loadProjectsState,
  saveProjectsState,
  getConnectedUserEmail,
} from '../config.js';
import { getProjectDeploymentUrl } from '../qa.js';

/**
 * Returns current SMTP configuration from saved state or environment.
 */
export function getSmtpConfig() {
  const state = loadProjectsState();
  const saved = state?.smtp || {};
  const connectedEmail = getConnectedUserEmail() || '';
  return {
    host: saved.host || CONFIG.smtpHost || 'smtp.gmail.com',
    port: Number(saved.port || CONFIG.smtpPort || 465),
    user: saved.user || CONFIG.smtpUser || connectedEmail,
    pass: saved.pass || CONFIG.smtpPass || '',
  };
}

/**
 * Sends an email with optional attachments using Google OAuth (Gmail API) or SMTP fallback.
 */
export async function sendEmailDirect({ to, subject, body, attachmentPaths = [] }) {
  // 1. If Google account is connected, prefer direct Gmail API (seamless, no app password required)
  if (googleAuth.isAuthenticated()) {
    try {
      return await googleServices.sendEmail({
        to,
        subject,
        body,
        attachmentPaths,
        from: googleAuth.getUserEmail() || getConnectedUserEmail() || undefined,
      });
    } catch (apiErr) {
      const smtp = getSmtpConfig();
      if (smtp.pass) {
        console.warn(`[concierge] Gmail API send failed (${apiErr.message}), falling back to SMTP.`);
      } else {
        throw apiErr;
      }
    }
  }

  // 2. SMTP fallback
  const smtp = getSmtpConfig();
  if (!smtp.user || !smtp.pass) {
    const err = new Error('SMTP_NOT_CONFIGURED');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  const attachments = (attachmentPaths || [])
    .filter((p) => p && fs.existsSync(p) && fs.statSync(p).isFile())
    .map((p) => ({
      filename: path.basename(p),
      path: p,
    }));

  const emailSignature = 'Sent by Weave';
  let formattedBody = (body || '').trim();
  if (!formattedBody.endsWith(emailSignature)) {
    formattedBody = formattedBody ? `${formattedBody}\n\n${emailSignature}` : emailSignature;
  }

  const info = await transporter.sendMail({
    from: smtp.user,
    to,
    subject,
    text: formattedBody,
    attachments,
  });

  return { messageId: info.messageId, attachmentsCount: attachments.length, from: smtp.user, provider: 'smtp' };
}

/**
 * Resolves the target recipient email.
 * REQUIREMENT: Whenever the user mentions "me", "myself", "to me", "my email", or refers to him/herself,
 * use his Gmail retrieved from the connected Google Account.
 */
export function resolveRecipientEmail(rawRecipient) {
  const connectedEmail = getConnectedUserEmail();
  const r = (rawRecipient || '').trim().toLowerCase();

  const isSelf =
    !r ||
    ['me', 'myself', 'self', 'owner', 'to me', 'to myself', 'my email', 'my mail', 'to my email'].includes(r);

  if (isSelf) {
    return connectedEmail;
  }

  // If an explicit email address was provided
  const match = r.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (match) {
    return match[1];
  }

  return connectedEmail || null;
}

/**
 * Handles all natural language email requests (conversation summaries, project deliveries, drafts).
 */
export async function handleEmailRequest({
  text,
  rawBody,
  intentResult,
  jid,
  msg,
  owner,
  isGroup,
  boundProject,
  state,
  recentChatContext = '',
  chatHistory = [],
  sock,
  sendReply,
  reactToMessage,
  sendWhatsAppFile,
}) {
  if (reactToMessage) await reactToMessage(sock, msg, '📧').catch(() => {});

  const emailData = intentResult?.email || {};
  const isSummary =
    emailData.action === 'summary' ||
    emailData.isSummary ||
    /\b(?:summary|context|catch\s*up|recap|conversation|convo)\b/i.test(rawBody);

  const isProject =
    emailData.action === 'project' ||
    emailData.isProject ||
    /^(?:please\s+|can\s+you\s+)?(?:email|mail|send)\s+(?:this|the\s+project|the\s+site|the\s+website|the\s+code|the\s+files?|the\s+output)\b/i.test(rawBody) ||
    /^(?:please\s+|can\s+you\s+)?(?:email|mail)\s+(?:this|it)\s+to\s+me$/i.test(rawBody);

  // 1. Resolve recipient (always uses connected Google Account for "me" / self)
  const targetEmail = resolveRecipientEmail(emailData.recipient);

  if (!targetEmail) {
    await sendReply(
      sock,
      jid,
      `⚠️ *No Google account connected.*\n\nPlease connect your Google account in the Weave Desktop app (Step 2) or specify an email address: \`@weave email user@example.com ...\``,
      msg
    );
    return { handled: true };
  }

  // 2. Handle Conversation Summary ("i missed the context of the convo, email the summary to me")
  if (isSummary) {
    let formattedContext = recentChatContext;
    if (!formattedContext && chatHistory && chatHistory.length > 0) {
      formattedContext = chatHistory
        .map((m) => {
          const timeStr = new Date(m.timestamp).toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
          const quoteStr = m.quotedText ? ` (replying to: "${m.quotedText}")` : '';
          return `[${timeStr}] ${m.sender}${quoteStr}: ${m.text}`;
        })
        .join('\n');
    }

    if (!formattedContext || formattedContext.trim().length === 0) {
      await sendReply(
        sock,
        jid,
        `ℹ️ No prior conversation messages recorded in this chat to summarize yet. Send a few messages and try again!`,
        msg
      );
      return { handled: true };
    }

    let summaryBody = '';
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    try {
      const summaryPrompt = `You are Weave, an intelligent, helpful executive developer assistant on WhatsApp.
A user missed the recent context of this ${isGroup ? 'group' : 'private'} conversation and asked for an email summary.

Here is the recent conversation transcript:
${formattedContext}

Generate a structured, professional, executive email digest:
1. Executive Summary (2 sentences max)
2. Key Discussion Points & Topics Discussed
3. Decisions Made, Agreed Times & Shared Links
4. Action Items & Next Steps

Tone: Crisp, insightful, helpful, perfectly formatted with markdown bullet points.`;

      const res = await geminiClient.generateContent(summaryPrompt);
      summaryBody = res.text?.trim() || `Executive Summary of Recent Conversation:\n\n${formattedContext}`;
    } catch (err) {
      summaryBody = `Summary of Recent Conversation:\n\n${formattedContext}`;
    }

    const emailSignature = 'Sent by Weave';
    if (!summaryBody.endsWith(emailSignature)) {
      summaryBody = `${summaryBody}\n\n${emailSignature}`;
    }

    const subject = `Weave Catch-Up: Conversation Summary (${isGroup ? 'Group Chat' : 'Chat'} - ${dateStr})`;

    // Save pending draft into state
    const preState = loadProjectsState();
    preState.pendingEmailDrafts = preState.pendingEmailDrafts || {};
    preState.pendingEmailDrafts[jid] = {
      to: targetEmail,
      subject,
      body: summaryBody,
      attachments: [],
      updatedAt: new Date().toISOString(),
    };
    saveProjectsState(preState);

    // Attempt direct email dispatch via Gmail API / SMTP
    let emailSent = false;
    let sendErrCode = '';
    try {
      await sendEmailDirect({
        to: targetEmail,
        subject,
        body: summaryBody,
        attachmentPaths: [],
      });
      emailSent = true;
    } catch (err) {
      sendErrCode = err.code || '';
    }

    if (emailSent) {
      if (reactToMessage) await reactToMessage(sock, msg, '✅').catch(() => {});
      if (isGroup) {
        await sendReply(
          sock,
          jid,
          `📧 *Catch-up summary sent to \`${targetEmail}\`!* Check your inbox for the breakdown of recent discussions and key decisions.`,
          msg
        );
      } else {
        await sendReply(
          sock,
          jid,
          `📧 *Sent conversation summary to \`${targetEmail}\`!*\n\n• *Subject:* ${subject}\n• *Recipient:* \`${targetEmail}\``,
          msg
        );
      }
    } else {
      // Direct email dispatch not completed: present the summary and clear guidance
      if (reactToMessage) await reactToMessage(sock, msg, '📝').catch(() => {});
      const helpTip = sendErrCode === 'GMAIL_SCOPE_INSUFFICIENT'
        ? `_💡 Google permission needed: Connect Google Account in Weave app to authorize Gmail sending, or reply *confirm* once granted!_`
        : `_💡 Tip: Connect your Google account in Weave, or run \`/mailsetup ${targetEmail} <app-password>\` to automatically dispatch straight to your Gmail inbox!_`;

      await sendReply(
        sock,
        jid,
        [
          `📧 *Catch-Up Summary Prepared for \`${targetEmail}\`!*`,
          ``,
          summaryBody,
          ``,
          helpTip,
        ].join('\n'),
        msg
      );
    }

    return { handled: true };
  }

  // 3. Handle Project Delivery ("email this to me" / project details)
  if (isProject) {
    const currentState = loadProjectsState();
    const portfolioSession = currentState?.portfolioSessions?.[jid];
    const currentProjectAlias = boundProject || currentState?.activeProject || portfolioSession?.projectAlias || 'project';
    const projectDir =
      (currentProjectAlias && currentState?.projects?.[currentProjectAlias]) ||
      portfolioSession?.projectDir ||
      CONFIG.defaultProjectDir;

    // Check for live deployment URL
    let liveUrl = null;
    try {
      liveUrl = await getProjectDeploymentUrl(projectDir, currentProjectAlias);
    } catch {}

    const attachments = [];
    const distDir = path.join(projectDir, 'dist');
    const shotsDir = path.join(projectDir, 'shots');

    // Look for screenshots to attach
    for (const checkDir of [shotsDir, distDir, projectDir]) {
      if (fs.existsSync(checkDir)) {
        try {
          const files = fs.readdirSync(checkDir);
          for (const f of files) {
            if (f.endsWith('.png') || f.endsWith('.jpg')) {
              const fullP = path.join(checkDir, f);
              if (!attachments.includes(fullP) && attachments.length < 3) {
                attachments.push(fullP);
              }
            }
          }
        } catch {}
      }
    }

    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const subject = `Weave Project: ${currentProjectAlias} — Live Preview & Summary (${dateStr})`;

    const bodyLines = [
      `Hi,`,
      ``,
      `Here is the latest update and files for "${currentProjectAlias}":`,
      ``,
      `• Project: ${currentProjectAlias}`,
      `• Local Directory: ${projectDir}`,
      liveUrl ? `• Live Deployment: ${liveUrl}` : null,
      portfolioSession?.originalPrompt ? `• Original Request: "${portfolioSession.originalPrompt}"` : null,
      portfolioSession?.productNotes ? `• Product Notes:\n${portfolioSession.productNotes}` : null,
      ``,
      `Status: Successfully packaged and ready.`,
      ``,
      `Sent by Weave`,
    ].filter(Boolean);

    const emailBody = bodyLines.join('\n');

    // Save pending draft
    const preState = loadProjectsState();
    preState.pendingEmailDrafts = preState.pendingEmailDrafts || {};
    preState.pendingEmailDrafts[jid] = {
      to: targetEmail,
      subject,
      body: emailBody,
      attachments,
      updatedAt: new Date().toISOString(),
    };
    saveProjectsState(preState);

    let emailSent = false;
    let sendErrCode = '';
    try {
      await sendEmailDirect({
        to: targetEmail,
        subject,
        body: emailBody,
        attachmentPaths: attachments,
      });
      emailSent = true;
    } catch (err) {
      sendErrCode = err.code || '';
    }

    if (emailSent) {
      if (reactToMessage) await reactToMessage(sock, msg, '✅').catch(() => {});
      await sendReply(
        sock,
        jid,
        `📧 *Sent project summary & live links to \`${targetEmail}\`!* (${attachments.length} attachment${attachments.length === 1 ? '' : 's'})`,
        msg
      );
    } else {
      if (reactToMessage) await reactToMessage(sock, msg, '📝').catch(() => {});
      const attachInfo = attachments.length > 0
        ? `\n• *Attachments:* ${attachments.map((p) => `\`${path.basename(p)}\``).join(', ')}`
        : '';
      const helpTip = sendErrCode === 'GMAIL_SCOPE_INSUFFICIENT'
        ? `_💡 Google permission needed: Open the Weave desktop app and click "Connect Google Account" to grant Gmail sending, then reply *confirm*!_`
        : `_💡 Tip: Connect your Google account in Weave, or run \`/mailsetup ${targetEmail} <app-password>\` to dispatch directly to your Gmail inbox!_`;

      await sendReply(
        sock,
        jid,
        [
          `📧 *Project Summary Prepared for \`${targetEmail}\`!*`,
          `• *Project:* \`${currentProjectAlias}\``,
          liveUrl ? `• *Live URL:* ${liveUrl}` : null,
          attachInfo,
          ``,
          emailBody,
          ``,
          helpTip,
        ].filter(Boolean).join('\n'),
        msg
      );
    }

    return { handled: true };
  }

  const emailSignature = 'Sent by Weave';
  let body = rawBody;
  if (!body.endsWith(emailSignature)) {
    body = body ? `${body}\n\n${emailSignature}` : emailSignature;
  }

  const preState = loadProjectsState();
  preState.pendingEmailDrafts = preState.pendingEmailDrafts || {};
  preState.pendingEmailDrafts[jid] = {
    to: targetEmail,
    subject,
    body,
    attachments: [],
    updatedAt: new Date().toISOString(),
  };
  saveProjectsState(preState);

  await sendReply(
    sock,
    jid,
    [
      `📝 *Email Prepared for \`${targetEmail}\`*`,
      `• *To:* \`${targetEmail}\``,
      `• *Subject:* ${subject}`,
      ``,
      body,
      ``,
      `_Reply *confirm* to send, or edit details._`,
    ].join('\n'),
    msg
  );

  return { handled: true };
}
