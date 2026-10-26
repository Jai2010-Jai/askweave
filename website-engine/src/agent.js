import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG, DATA_DIR, loadProjectsState, saveProjectsState, isPathWithinMasterDir, getConnectedUserEmail } from './config.js';
import { geminiClient } from './gemini-client.js';

const __agentDir = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = fs.existsSync(path.join(DATA_DIR, '.env'))
  ? path.join(DATA_DIR, '.env')
  : path.resolve(__agentDir, '..', '.env');

function readEnvFileDirect(key) {
  try {
    if (!fs.existsSync(ENV_FILE_PATH)) return '';
    const content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      if (k === key) {
        return trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    // ignore
  }
  return '';
}

let activeChildProcess = null;
let currentTaskInfo = null;
let killFallbackTimer = null;

const MAX_WARM_WORKERS = 4;
const MAX_TURNS_PER_WORKER = 6;
const warmPool = new Map(); // projectDir -> WarmWorker

/**
 * Returns info about the currently running task, if any.
 */
export function getActiveTaskInfo() {
  return currentTaskInfo;
}

/**
 * Recursively retrieves all descendant process IDs for a given root PID on Linux/macOS.
 */
function getAllDescendantPids(rootPid) {
  if (!rootPid || process.platform === 'win32') return [];
  const pids = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift();
    let stdout = '';
    try {
      stdout = execFileSync('pgrep', ['-P', String(parent)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      try {
        stdout = execFileSync('ps', ['-o', 'pid=', '--ppid', String(parent)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        // No children or command failed
      }
    }
    if (stdout) {
      for (const token of stdout.trim().split(/\s+/)) {
        const p = parseInt(token.trim(), 10);
        if (p && !isNaN(p) && !pids.includes(p)) {
          pids.push(p);
          queue.push(p);
        }
      }
    }
  }
  return pids;
}

/**
 * Forcefully terminates a child process and its entire process tree across Linux and Windows.
 * On Windows: Uses taskkill /pid <pid> /T /F
 * On Linux/Unix: Gathers all descendants, sends SIGTERM to process group and tree (pkill -P),
 * followed by SIGKILL to ensure lingering bash, compilers, dev servers, etc. are eliminated.
 */
export function terminateProcessTree(child, { graceMs = 300 } = {}) {
  if (!child) return;
  child._cancelledByUser = true;
  const pid = child.pid;
  if (!pid) {
    try {
      child.kill('SIGKILL');
    } catch {}
    return;
  }

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } catch {
      try {
        child.kill();
      } catch {}
    }
    return;
  }

  // Linux / macOS:
  // Gather descendants before parent exits and children reparent
  const descendants = getAllDescendantPids(pid);

  const sendSignals = (sig) => {
    // 1. Send signal to process group (-pid)
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {}
    }

    // 2. Direct children via pkill -P
    const sigName = sig.replace(/^SIG/, '');
    try {
      execFileSync('pkill', [`-${sigName}`, '-P', String(pid)], { stdio: 'ignore' });
    } catch {}

    // 3. All gathered descendants and their process groups
    for (const dPid of descendants) {
      try {
        process.kill(-dPid, sig);
      } catch {}
      try {
        process.kill(dPid, sig);
      } catch {}
    }

    try {
      child.kill(sig);
    } catch {}
  };

  // Immediate SIGTERM to allow graceful shutdown
  sendSignals('SIGTERM');

  // Follow-up SIGKILL escalation to ensure zero orphan processes remain
  const killTimer = setTimeout(() => {
    sendSignals('SIGKILL');
  }, graceMs);
  killTimer.unref?.();
}

/**
 * Kills the currently running Antigravity CLI process (and its entire child process tree)
 * if one is active, aborts the active turn, retires the worker, and cleans up state.
 */
export function stopActiveTask() {
  const info = currentTaskInfo;
  let stopped = false;

  if (killFallbackTimer) {
    clearTimeout(killFallbackTimer);
    killFallbackTimer = null;
  }

  // Find and terminate any warm worker that is executing a turn or associated with activeChildProcess
  for (const worker of warmPool.values()) {
    if (
      worker.currentTurn ||
      (activeChildProcess && worker.child === activeChildProcess)
    ) {
      stopped = true;
      worker.dead = true;
      warmPool.delete(worker.projectDir);

      if (worker.currentTurn) {
        const turn = worker.currentTurn;
        worker.currentTurn = null;
        if (turn.timer) clearTimeout(turn.timer);
        const cancelErr = new Error('Task was cancelled by user.');
        cancelErr.cancelled = true;
        turn.reject(cancelErr);
      }

      const waiters = worker.initWaiters.splice(0);
      for (const w of waiters) {
        const cancelErr = new Error('Task was cancelled by user.');
        cancelErr.cancelled = true;
        w.reject(cancelErr);
      }

      try {
        worker.child?.stdin?.end();
      } catch {}

      terminateProcessTree(worker.child, { graceMs: 250 });
      const projDir = worker.projectDir;
      const projAlias = worker.projectAlias;
      setTimeout(() => prewarmAgentSession(projDir, projAlias), 400).unref?.();
    }
  }

  if (activeChildProcess) {
    stopped = true;
    terminateProcessTree(activeChildProcess, { graceMs: 250 });
    activeChildProcess = null;
  }

  currentTaskInfo = null;

  if (stopped) {
    return info || { stopped: true };
  }
  return null;
}

/**
 * Runs a git subcommand without a shell (no command-injection via branch/message).
 */
function gitRun(projectDir, args) {
  return execFileSync('git', args, {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Helper to get a brief git status summary if the project directory is a git repo.
 */
function getGitChangesSummary(projectDir) {
  try {
    const statusOut = gitRun(projectDir, ['status', '--short'])
      .split('\n')
      .filter((line) => line.trim() && !line.includes('.whatsapp-uploads'))
      .join('\n')
      .trim();
    return statusOut || null;
  } catch {
    return null;
  }
}

/**
 * Stages, commits (if needed), and pushes changes in `projectDir` to GitHub.
 */
export function gitCommitAndPush(projectDir, commitMessage = 'Update via WhatsApp Agent') {
  const statusBefore = gitRun(projectDir, ['status', '--short'])
    .split('\n')
    .filter((line) => line.trim() && !line.includes('.whatsapp-uploads'))
    .join('\n')
    .trim();
  if (statusBefore) {
    gitRun(projectDir, ['add', '-A']);
    try {
      gitRun(projectDir, ['reset', 'HEAD', '--', '.whatsapp-uploads']);
    } catch {
      // Ignore if .whatsapp-uploads was not staged
    }
    // Passed as a single argv entry — no shell, so $, backticks, quotes are safe.
    gitRun(projectDir, ['commit', '-m', commitMessage || 'Update via WhatsApp Agent']);
  }

  const branch = gitRun(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!/^[\w.\/-]+$/.test(branch) || branch === 'HEAD') {
    throw new Error(`Refusing to push unusual branch name: ${branch}`);
  }
  const commitHash = gitRun(projectDir, ['rev-parse', '--short', 'HEAD']);
  let remoteUrl = '';
  try {
    remoteUrl = gitRun(projectDir, ['config', '--get', 'remote.origin.url']).replace(
      /\.git$/,
      ''
    );
  } catch {
    remoteUrl = '';
  }

  gitRun(projectDir, ['push', 'origin', branch]);

  return {
    committedNewChanges: Boolean(statusBefore),
    branch,
    commitHash,
    remoteUrl,
  };
}

/**
 * Reads the GitHub personal access token from environment or ~/.git-credentials.
 */
function getGitHubCredentials() {
  const envToken = (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    readEnvFileDirect('GITHUB_TOKEN') ||
    readEnvFileDirect('GH_TOKEN') ||
    ''
  ).trim();
  const envUser = (process.env.GITHUB_USER || readEnvFileDirect('GITHUB_USER') || '').trim();
  if (envToken) {
    return { username: envUser || 'github-user', token: envToken };
  }
  try {
    const credPath = path.join(os.homedir(), '.git-credentials');
    if (fs.existsSync(credPath)) {
      const lines = fs.readFileSync(credPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const match = line.trim().match(/^https:\/\/([^:]+):([^@]+)@github\.com/i);
        if (match) {
          return {
            username: decodeURIComponent(match[1]),
            token: decodeURIComponent(match[2]),
          };
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Normalizes a GitHub username or profile URL into a clean username (or email if passed).
 */
function cleanGitHubUsername(input) {
  let s = String(input || '').trim();
  // Strip markdown links like [text](url)
  const mdMatch = s.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (mdMatch) {
    s = mdMatch[2].includes('github.com') ? mdMatch[2] : mdMatch[1];
  }
  // Extract from github.com/<username>
  const urlMatch = s.match(/github\.com\/([A-Za-z0-9_.-]+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  return s.replace(/^@/, '').trim();
}

/**
 * Resolves a GitHub username (or searches by email if an email address was given).
 */
async function resolveGitHubUsername(rawInput, headers) {
  const cleaned = cleanGitHubUsername(rawInput);
  if (!cleaned) return '';
  if (cleaned.includes('@')) {
    try {
      const q = encodeURIComponent(`${cleaned} in:email`);
      const res = await fetch(`https://api.github.com/search/users?q=${q}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data?.items?.length > 0 && data.items[0].login) {
          return data.items[0].login;
        }
      }
    } catch {
      // Fall through
    }
  }
  return cleaned;
}

/**
 * Normalizes friendly permission names into GitHub API permission values.
 */
function normalizeGitHubPermission(rawPerm = 'push') {
  const p = String(rawPerm || 'push').trim().toLowerCase();
  if (['read', 'pull', 'view', 'viewer', 'triage'].includes(p)) {
    return p === 'triage' ? 'triage' : 'pull';
  }
  if (['admin', 'owner', 'full'].includes(p)) return 'admin';
  if (['maintain', 'maintainer'].includes(p)) return 'maintain';
  return 'push'; // default write access
}

/**
 * Parses a GitHub repository identifier (`owner/repo`), GitHub URL, or local project directory
 * into `{ owner, repo, htmlUrl }`.
 */
export function resolveGitHubRepo({ projectDir, repoInput, defaultOwner } = {}) {
  const parseUrlOrSlug = (str) => {
    if (!str) return null;
    const trimmed = str.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
    // Match https://github.com/owner/repo or git@github.com:owner/repo
    const urlMatch = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
    if (urlMatch) {
      return {
        owner: urlMatch[1],
        repo: urlMatch[2],
        htmlUrl: `https://github.com/${urlMatch[1]}/${urlMatch[2]}`,
      };
    }
    // Match owner/repo slug
    const slugMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (slugMatch) {
      return {
        owner: slugMatch[1],
        repo: slugMatch[2],
        htmlUrl: `https://github.com/${slugMatch[1]}/${slugMatch[2]}`,
      };
    }
    // Bare repo name if defaultOwner is known
    if (defaultOwner && /^[A-Za-z0-9_.-]+$/.test(trimmed)) {
      return {
        owner: defaultOwner,
        repo: trimmed,
        htmlUrl: `https://github.com/${defaultOwner}/${trimmed}`,
      };
    }
    return null;
  };

  if (repoInput) {
    const direct = parseUrlOrSlug(repoInput);
    if (direct) return direct;
  }

  if (projectDir && fs.existsSync(projectDir)) {
    try {
      const remoteUrl = gitRun(projectDir, ['config', '--get', 'remote.origin.url']);
      const fromGit = parseUrlOrSlug(remoteUrl);
      if (fromGit) return fromGit;
    } catch {
      // Ignore if not a git repo or no remote.origin.url
    }
  }

  return null;
}

/**
 * Adds/invites a GitHub user as a collaborator to a repository.
 *
 * @param {object} params
 * @param {string} params.username - GitHub username (or email) to invite
 * @param {string} [params.permission='push'] - 'pull' | 'triage' | 'push' | 'maintain' | 'admin'
 * @param {string} [params.projectDir] - Local project directory to infer git remote from
 * @param {string} [params.repoInput] - Explicit 'owner/repo', repo name, or GitHub URL
 */
export async function addGitHubCollaborator({
  username,
  permission = 'push',
  projectDir,
  repoInput,
}) {
  const creds = getGitHubCredentials();
  if (!creds?.token) {
    throw new Error(
      'GitHub credentials not found. Set GITHUB_TOKEN in .env or configure ~/.git-credentials.'
    );
  }

  const headers = {
    Authorization: `Bearer ${creds.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'WhatsApp-Antigravity-Agent',
  };

  const cleanUser = await resolveGitHubUsername(username, headers);
  if (!cleanUser || !/^[A-Za-z0-9-]+$/.test(cleanUser)) {
    throw new Error(
      `Invalid or unresolvable GitHub username: "${username}". Please provide a valid GitHub username (e.g. octocat).`
    );
  }

  const repoInfo = resolveGitHubRepo({
    projectDir,
    repoInput,
    defaultOwner: creds.username,
  });

  if (!repoInfo) {
    throw new Error(
      'Could not determine the GitHub repository. Specify it as `owner/repo` or bind this chat to a project with a GitHub `origin` remote.'
    );
  }

  const normalizedPerm = normalizeGitHubPermission(permission);
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/collaborators/${encodeURIComponent(cleanUser)}`;

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ permission: normalizedPerm }),
  });

  if (res.status === 201) {
    const data = await res.json().catch(() => ({}));
    return {
      status: 'invited',
      username: cleanUser,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      permission: normalizedPerm,
      htmlUrl: data?.html_url || `${repoInfo.htmlUrl}/invitations`,
    };
  }

  if (res.status === 204) {
    return {
      status: 'already_collaborator',
      username: cleanUser,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      permission: normalizedPerm,
      htmlUrl: repoInfo.htmlUrl,
    };
  }

  const errBody = await res.json().catch(() => ({}));
  const errMsg = errBody?.message || `HTTP ${res.status}`;
  if (res.status === 404) {
    throw new Error(
      `GitHub returned 404 Not Found for ${repoInfo.owner}/${repoInfo.repo} or user @${cleanUser}. Verify the repo/username exists and your GITHUB_TOKEN has "repo" (or Collaborators Read/Write) permission.`
    );
  }
  if (res.status === 403 || res.status === 401) {
    throw new Error(
      `GitHub authentication/permission error (${res.status}): ${errMsg}. Ensure your token has admin/write access to ${repoInfo.owner}/${repoInfo.repo}.`
    );
  }
  throw new Error(`GitHub API error (${res.status}): ${errMsg}`);
}

/**
 * Removes a GitHub user as a collaborator from a repository (or cancels their pending invite).
 */
export async function removeGitHubCollaborator({ username, projectDir, repoInput }) {
  const creds = getGitHubCredentials();
  if (!creds?.token) {
    throw new Error(
      'GitHub credentials not found. Set GITHUB_TOKEN in .env or configure ~/.git-credentials.'
    );
  }

  const headers = {
    Authorization: `Bearer ${creds.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'WhatsApp-Antigravity-Agent',
  };

  const cleanUser = await resolveGitHubUsername(username, headers);
  if (!cleanUser || !/^[A-Za-z0-9-]+$/.test(cleanUser)) {
    throw new Error(`Invalid GitHub username: "${username}".`);
  }

  const repoInfo = resolveGitHubRepo({
    projectDir,
    repoInput,
    defaultOwner: creds.username,
  });

  if (!repoInfo) {
    throw new Error(
      'Could not determine the GitHub repository. Specify it as `owner/repo` or bind this chat to a project with a GitHub `origin` remote.'
    );
  }

  // Also check if there is a pending invitation for this user and cancel it if found
  try {
    const invUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/invitations`;
    const invRes = await fetch(invUrl, { headers });
    if (invRes.ok) {
      const invitations = await invRes.json();
      const pending = Array.isArray(invitations)
        ? invitations.find(
            (inv) => inv?.invitee?.login?.toLowerCase() === cleanUser.toLowerCase()
          )
        : null;
      if (pending?.id) {
        const delInvRes = await fetch(`${invUrl}/${pending.id}`, {
          method: 'DELETE',
          headers,
        });
        if (delInvRes.status === 204) {
          return {
            status: 'invitation_cancelled',
            username: cleanUser,
            owner: repoInfo.owner,
            repo: repoInfo.repo,
          };
        }
      }
    }
  } catch {
    // Fall through to collaborator removal
  }

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/collaborators/${encodeURIComponent(cleanUser)}`;
  const res = await fetch(apiUrl, {
    method: 'DELETE',
    headers,
  });

  if (res.status === 204) {
    return {
      status: 'removed',
      username: cleanUser,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    };
  }

  const errBody = await res.json().catch(() => ({}));
  throw new Error(
    `GitHub API error (${res.status}): ${errBody?.message || 'Failed to remove collaborator'}`
  );
}

/**
 * Lists current collaborators and pending invitations for a GitHub repository.
 */
export async function listGitHubCollaborators({ projectDir, repoInput } = {}) {
  const creds = getGitHubCredentials();
  if (!creds?.token) {
    throw new Error(
      'GitHub credentials not found. Set GITHUB_TOKEN in .env or configure ~/.git-credentials.'
    );
  }

  const repoInfo = resolveGitHubRepo({
    projectDir,
    repoInput,
    defaultOwner: creds.username,
  });

  if (!repoInfo) {
    throw new Error(
      'Could not determine the GitHub repository. Specify it as `owner/repo` or bind this chat to a project with a GitHub `origin` remote.'
    );
  }

  const headers = {
    Authorization: `Bearer ${creds.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'WhatsApp-Antigravity-Agent',
  };

  const collabUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/collaborators`;
  const invUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/invitations`;

  const [collabRes, invRes] = await Promise.all([
    fetch(collabUrl, { headers }),
    fetch(invUrl, { headers }),
  ]);

  if (!collabRes.ok) {
    const errBody = await collabRes.json().catch(() => ({}));
    throw new Error(
      `GitHub API error (${collabRes.status}): ${errBody?.message || 'Failed to list collaborators'}`
    );
  }

  const collabs = await collabRes.json();
  const invitations = invRes.ok ? await invRes.json().catch(() => []) : [];

  return {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    htmlUrl: repoInfo.htmlUrl,
    collaborators: Array.isArray(collabs)
      ? collabs.map((c) => ({
          username: c.login,
          roleName: c.role_name || (c.permissions?.admin ? 'admin' : c.permissions?.push ? 'write' : 'read'),
        }))
      : [],
    pendingInvitations: Array.isArray(invitations)
      ? invitations.map((inv) => ({
          id: inv.id,
          username: inv.invitee?.login || 'unknown',
          permission: inv.permissions || 'write',
          htmlUrl: inv.html_url,
        }))
      : [],
  };
}

/**
 * Cleans up IDE-specific file:// links so the message reads cleanly in WhatsApp.
 */
function formatForWhatsApp(text) {
  return text.replace(/\[([^\]]+)\]\(file:\/\/[^)]+\)/g, '`$1`').trim();
}

/**
 * Executes a coding task in the target project directory using the Antigravity CLI (`agy`).
 *
 * @param {object} params
 * @param {string} params.projectAlias
 * @param {string} params.projectDir
 * @param {string} params.taskPrompt
 * @param {boolean} [params.continueSession=false]
 * @returns {Promise<{response: string, conversationId?: string, durationSeconds?: number, numTurns?: number, gitSummary?: string | null}>}
 */
export async function runAntigravityTask({
  projectAlias,
  projectDir,
  taskPrompt,
  continueSession = false,
  imagePath = null,
  attachmentInfo = null,
  pendingEmailDraft = null,
  ownerAllowedToMessage = false,
  mentionedJids = [],
  recentChatContext = '',
}) {
  if (!projectDir || projectDir.includes('app.asar') || !fs.existsSync(projectDir)) {
    if (!projectDir || projectDir.includes('app.asar') || projectAlias === 'demo') {
      projectDir = CONFIG.defaultProjectDir;
      try {
        fs.mkdirSync(projectDir, { recursive: true });
      } catch {}
    }
    if (!fs.existsSync(projectDir)) {
      throw new Error(`Project directory does not exist: ${projectDir}`);
    }
  }

  // Strict Master Directory Sandboxing Enforcement
  const state = loadProjectsState();
  if (state.masterDir && !isPathWithinMasterDir(projectDir, state.masterDir)) {
    throw new Error(`Security Violation: Execution blocked. Directory "${projectDir}" is outside the Master Directory sandbox.`);
  }

  const now = new Date();
  const currentDateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const currentTimeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
  const todayIsoDate = now.toISOString().split('T')[0];

  const previousConvId = state.conversations?.[projectAlias];

  const filePath = attachmentInfo?.filePath || imagePath;
  const isImage = attachmentInfo ? attachmentInfo.type === 'image' : Boolean(imagePath);

  const imageInstructions = filePath
    ? isImage
      ? [
          `ATTACHED WHATSAPP IMAGE: The user attached an image saved at "${filePath}".`,
          `- You MUST first inspect this image using your view_file tool on "${filePath}" to see what it shows (e.g. a screenshot, mockup, error, or photo).`,
          `- If the user wants this image emailed as an attachment, include "${filePath}" in your [DRAFT_EMAIL: ...] directive and DO NOT delete "${filePath}".`,
          `- If the user wants this image added to the website/project, copy or move it from "${filePath}" into the appropriate assets/public folder of "${projectDir}".`,
          `- If the image was only a reference/screenshot (not meant to be emailed or committed to the repo), delete "${filePath}" after inspecting it so it doesn't clutter git status.`,
        ].join('\n')
      : [
          `ATTACHED WHATSAPP DOCUMENT/FILE: The user attached a file ("${attachmentInfo?.fileName || filePath}") saved locally at "${filePath}".`,
          `- You can read or inspect this file at "${filePath}" if needed to help draft an email or complete the user's task.`,
          `- IMPORTANT: Do NOT delete "${filePath}" if the user wants to email or forward this attachment!`,
        ].join('\n')
    : null;

  const existingDraftInstructions =
    ownerAllowedToMessage && pendingEmailDraft
      ? [
          `CURRENT PENDING EMAIL DRAFT (in case the user is asking to edit/revise the draft):`,
          `- To: ${pendingEmailDraft.to}`,
          `- Subject: ${pendingEmailDraft.subject}`,
          `- Attachments: ${(pendingEmailDraft.attachments || []).join(', ') || 'NONE'}`,
          `- Body:\n${pendingEmailDraft.body}`,
        ].join('\n')
      : null;

  const connectedGmail = getConnectedUserEmail() || CONFIG.ownerEmail || '';
  const ownerEmail = connectedGmail;

  const userGmailDirectives = connectedGmail
    ? [
        `USER GMAIL IDENTITY (RETRIEVED FROM CONNECTED GOOGLE ACCOUNT):`,
        `- The user's registered/connected Google account email is: "${connectedGmail}".`,
        `- Whenever the user mentions "me", "myself", "to me", "my email", "email me", or refers to him/herself, ALWAYS use "${connectedGmail}" as their email address!`,
        `- NEVER ask the user "what is your email address?". You already know their email is "${connectedGmail}".`,
        `- When asked to email a project, file, or conversation summary to "me", use "${connectedGmail}".`,
      ].join('\n')
    : null;

  const messagingInstructions = ownerAllowedToMessage
    ? [
        `OWNER CAPABILITIES: This request is from the Bot Owner.`,
        mentionedJids.length > 0
          ? `- Mentioned Contact JID(s) in this message: ${mentionedJids.join(', ')}`
          : null,
        userGmailDirectives,
        `- To send a WhatsApp text message/DM to a contact, include a line at the end of your response:`,
        `  [SEND_WHATSAPP: <target_jid_or_name_or_number> | <message_to_send>]`,
        `- To send a local file from this PC (e.g. from the home directory, ~/Documents, ~/Downloads, ~/Desktop, or the project folder) to the current chat or to a specific contact, locate the exact file path and include a line at the end of your response:`,
        `  [SEND_FILE: HERE | /absolute/path/to/file]`,
        `  (or to send the file to a specific contact: [SEND_FILE: <target_jid_or_name_or_number> | /absolute/path/to/file])`,
        `- For VISUAL QA & SCREENSHOTS: When asked to test, preview, or take a screenshot of a webpage or dev server, you can run headless Firefox:`,
        `  firefox --headless --window-size=1280,800 --screenshot=/tmp/preview.png http://localhost:PORT (or URL)`,
        `  and then send it to the chat by outputting: [SEND_FILE: HERE | /tmp/preview.png]`,
        ownerEmail ? `OWNER IDENTITY & PREFERENCES:` : null,
        ownerEmail ? `- The Owner's registered email address is: "${ownerEmail}".` : null,
        ownerEmail
          ? `- Whenever the owner says "mail this to me", "email this to me", "send this to my mail", or "email me", ALWAYS use "${ownerEmail}" as the recipient in your [SEND_EMAIL: ${ownerEmail} | ...] directive! The bot sends emails directly to the owner immediately without requiring any confirmation step.`
          : null,
        `- CALENDAR & MEETING INTELLIGENCE:`,
        ownerEmail ? `  * The owner's Google Calendar is associated with "${ownerEmail}".` : null,
        `  * Today is ${currentDateStr}. Current local time: ${currentTimeStr}.`,
        `  * When scheduling a meeting or adding an event to the owner's calendar:`,
        `    - CAREFULLY examine the referenced message AND the Recent Chat Context for agreed meeting times, topics, and agendas!`,
        `    - Look for timing agreements in the chat (e.g. "Is 7 fine?", "7 works", "let's do 7", "7 pm", "tomorrow at 11am"). If a time was agreed upon, schedule the event for that time! Do NOT guess or default to an arbitrary time when a time was discussed in the chat.`,
        `    - Extract the FULL meeting agenda or discussion points (e.g. "1. General order of events, 2. Social media updates...") and include them in:`,
        `      1) The [CALENDAR_EVENT: Title | Start | Duration | Description | Location] Description field.`,
        ownerEmail
          ? `      2) The [SEND_EMAIL: ${ownerEmail} | Subject | Attachments | Body] Body field.`
          : null,
        `    - Give the meeting a descriptive Title based on the topic/agenda (e.g. "Team Meeting: Event Order & Sales Strategy") rather than just a generic "Meeting".`,
        `    - Include the video conferencing link (e.g. Google Meet URL) in both the Description and Location.`,
        `    - Start Time format: ISO format with local timezone offset, e.g. "${todayIsoDate}T19:00:00+05:30" (or YYYY-MM-DDTHH:MM:SSZ).`,
        `  * Include a calendar event directive at the end of your response:`,
        `    [CALENDAR_EVENT: <Event Title> | <Start Date/Time e.g. ${todayIsoDate}T19:00:00+05:30> | <Duration e.g. 1h or End Date/Time> | <Description> | <Optional Location>]`,
        `    The bot automatically syncs this event directly to Google Calendar via RFC 5545 invite without opening links.`,
        `- SILENT EXECUTION FOR OWNER EMAIL & CALENDAR: When the owner's request is purely personal (e.g. "mail this to me", "add this to my calendar", "send this to my email and add it to my calendar"):`,
        `  * Do NOT output conversational greetings, chat text, meet links, or status cards in your response!`,
        `  * Output ONLY the directives [SEND_EMAIL: ...] and/or [CALENDAR_EVENT: ...].`,
        `  * The bot will acknowledge with a silent checkmark emoji reaction in WhatsApp so group chats remain clean, private, and uncluttered.`,
        `- To draft or revise an EMAIL (with or without attachments, either using the attached WhatsApp file "${filePath || ''}" or any local file), draft a clear, professional Subject and Body and include a block at the end of your response in this exact format so the owner can preview and confirm it before sending:`,
        `  [DRAFT_EMAIL: recipient@example.com | Subject Line Here | /path/to/attachment1, /path/to/attachment2 (or NONE) | Full drafted email body here...]`,
        `  * Note: The email body must end with the signature line "Sent by Weave" at the very bottom.`,
        ownerEmail
          ? `  (When the owner says "mail this to me", use "${ownerEmail}" as the recipient)`
          : null,
        `- To share the owner's LIVE LOCATION on WhatsApp with a contact (or in the current chat using HERE) for a specified duration in hours (e.g. 8 for 8 hours, 1 for 1 hour), include a line at the end of your response in this exact format:`,
        `  [SHARE_LIVE_LOCATION: <target_contact_name_or_number_or_HERE> | <duration_in_hours_e.g._8> | <AUTO_or_specific_place_or_lat,lon>]`,
        `- To add/invite a GitHub collaborator to a repository (either the current project's repo using CURRENT or a specific repo like owner/repo or repo-name), do NOT run curl or gh yourself — instead include a line at the end of your response in this exact format (and the bot will call the GitHub API directly):`,
        `  [ADD_COLLABORATOR: <github_username> | <CURRENT_or_owner/repo> | <push_or_pull_or_admin>]`,
        `- To remove a GitHub collaborator (or cancel their pending invitation) from a repository, include a line at the end of your response in this exact format:`,
        `  [REMOVE_COLLABORATOR: <github_username> | <CURRENT_or_owner/repo>]`,
        `- To list all GitHub collaborators and pending invitations for a repository, include a line at the end of your response in this exact format:`,
        `  [LIST_COLLABORATORS: <CURRENT_or_owner/repo>]`,
      ]
        .filter(Boolean)
        .join('\n')
    : `SECURITY RULE: This user is running in a shared or group workspace. You are strictly isolated to "${projectDir}". You MUST NEVER read, list, modify, or send any files outside "${projectDir}". If the user asks to email a project summary, code, or conversation summary to "me", use their connected Gmail "${connectedGmail || 'the registered user'}".`;

  const systemWrapperPrompt = [
    `You are being invoked remotely via WhatsApp to perform a task. Default project workspace: "${projectDir}".`,
    `CURRENT DATE & TIME: Today is ${currentDateStr}. Current time is ${currentTimeStr}.`,
    !ownerAllowedToMessage
      ? `CRITICAL SECURITY RULE: You are strictly isolated to "${projectDir}". You MUST NEVER read, list, modify, or run commands on any files or directories outside "${projectDir}", even if the user prompt explicitly asks you to.`
      : null,
    `Git & GitHub credentials are pre-configured on this machine. If the user asks to push to GitHub, deploy, or make changes live, run "git add -A && git commit -m '<concise message>' && git push" inside "${projectDir}" after making the edits.`,
    imageInstructions,
    existingDraftInstructions,
    recentChatContext
      ? [
          `RECENT CHAT CONTEXT (Recent messages from this WhatsApp conversation):`,
          recentChatContext,
          ``,
        ].join('\n')
      : null,
    messagingInstructions,
    `WEBSITE & UI DESIGN WITH GOOGLE STITCH MCP & NETLIFY:`,
    `When asked to create, design, or deploy any website, portfolio, hackathon site, or landing page:`,
    `- Connect to Google Stitch MCP (https://stitch.googleapis.com/mcp) or invoke the portfolio orchestrator ("src/portfolio/portfolioOrchestrator.js").`,
    `- Formulate 3 completely dynamic visual design philosophies organically invented for this specific domain (ZERO presets or canned templates).`,
    `- Deploy to Netlify via Netlify Drop ("netlify deploy --dir . --prod --allow-anonymous --no-build") or provide the preview.`,
    `- For each design variant, capture a visual screenshot and output [SEND_FILE: HERE | <path_to_screenshot>] so the user sees all Google Stitch designs in WhatsApp!`,
    `- Include the live link, preview password, and prompt the user to choose their preferred option or dictate design changes in WhatsApp.`,
    `Complete the requested task and provide a brief, direct response (1-2 short sentences max unless the user explicitly asks for details). Do NOT output robotic status reports, bulleted change summaries, or filler phrases.`,
    ``,
    `User Task: ${taskPrompt}`,
  ]
    .filter(Boolean)
    .join('\n');

  const timeoutMs =
    Number.isFinite(CONFIG.taskTimeoutMs) && CONFIG.taskTimeoutMs > 0
      ? CONFIG.taskTimeoutMs
      : 600000;

  try {
    return await runWithWarmWorker({
      projectAlias,
      projectDir,
      taskPrompt,
      systemWrapperPrompt,
      ownerAllowedToMessage,
      timeoutMs,
      allowRetry: true,
    });
  } catch (err) {
    if (err.cancelled) throw err;
    const msg = String(err.message || '');
    const isCliUnavailable =
      msg.includes('ENOENT') ||
      msg.includes('not recognized') ||
      msg.includes('exited before init') ||
      msg.includes('not logged into Antigravity');

    if (isCliUnavailable) {
      const startTime = Date.now();
      const { text } = await geminiClient.generateContent(systemWrapperPrompt);
      const durationSeconds = (Date.now() - startTime) / 1000;
      return {
        response: formatForWhatsApp(text || 'Task completed.'),
        durationSeconds,
        numTurns: 1,
        gitSummary: getGitChangesSummary(projectDir),
      };
    }
    throw err;
  }
}

function retireWarmWorker(worker) {
  if (!worker) return;
  worker.dead = true;
  if (warmPool.get(worker.projectDir) === worker) {
    warmPool.delete(worker.projectDir);
  }
  try {
    worker.child?.stdin?.end();
  } catch {
    // ignore
  }
  if (worker.currentTurn) {
    const turn = worker.currentTurn;
    worker.currentTurn = null;
    if (turn.timer) clearTimeout(turn.timer);
    const cancelErr = new Error('Warm worker retired.');
    cancelErr.cancelled = true;
    turn.reject(cancelErr);
  }
  const waiters = worker.initWaiters.splice(0);
  for (const w of waiters) {
    w.reject(new Error('Warm worker retired before init.'));
  }
  if (worker.child) {
    terminateProcessTree(worker.child, { graceMs: 300 });
  }
}

function evictOldestIdleWorkerIfNeeded(excludeProjectDir) {
  if (warmPool.size < MAX_WARM_WORKERS) return;
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [dir, w] of warmPool.entries()) {
    if (dir === excludeProjectDir || w.currentTurn) continue;
    if (w.lastUsedAt < oldestTime) {
      oldestTime = w.lastUsedAt;
      oldestKey = dir;
    }
  }
  if (oldestKey) {
    retireWarmWorker(warmPool.get(oldestKey));
  }
}

function createWarmWorker(projectDir, conversationId = null) {
  evictOldestIdleWorkerIfNeeded(projectDir);

  const isWin = process.platform === 'win32';
  const useWinShell =
    isWin && (!CONFIG.agyBin.toLowerCase().endsWith('.exe') || !path.isAbsolute(CONFIG.agyBin));

  const args = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    '--effort',
    process.env.AGY_EFFORT || 'low',
  ];

  if (CONFIG.agyModel) {
    args.push('--model', CONFIG.agyModel);
  }

  if (conversationId) {
    args.push('--conversation', conversationId);
  }

  args.push(useWinShell ? '"-p="' : '-p=');

  const child = spawn(CONFIG.agyBin, args, {
    cwd: projectDir,
    env: { ...process.env, PAGER: 'cat' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: !isWin,
    windowsHide: true,
    shell: useWinShell,
  });

  const worker = {
    projectDir,
    child,
    ready: false,
    dead: false,
    conversationId: null,
    turnsCompleted: 0,
    lastOwnerMode: null,
    lastUsedAt: Date.now(),
    stdoutBuffer: '',
    stderrBuffer: '',
    initWaiters: [],
    currentTurn: null,
  };

  warmPool.set(projectDir, worker);

  child.stdout.on('data', (chunk) => {
    worker.stdoutBuffer += chunk.toString();
    let newlineIdx;
    while ((newlineIdx = worker.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = worker.stdoutBuffer.slice(0, newlineIdx).trim();
      worker.stdoutBuffer = worker.stdoutBuffer.slice(newlineIdx + 1);
      if (!line || !line.startsWith('{')) continue;

      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }

      if (evt.event === 'init') {
        worker.ready = true;
        if (evt.conversation_id) {
          worker.conversationId = evt.conversation_id;
        }
        const waiters = worker.initWaiters.splice(0);
        for (const w of waiters) w.resolve();
      } else if (
        evt.event === 'step_update' &&
        evt.step_update?.step_type === 'agent_response' &&
        evt.step_update?.text_delta
      ) {
        if (worker.currentTurn) {
          worker.currentTurn.streamedText += evt.step_update.text_delta;
        }
      } else if (evt.event === 'result' && worker.currentTurn) {
        const turn = worker.currentTurn;
        worker.currentTurn = null;
        clearTimeout(turn.timer);
        if (activeChildProcess === child) {
          activeChildProcess = null;
          currentTaskInfo = null;
        }

        const resObj = evt.result || {};
        if (resObj.conversation_id) {
          worker.conversationId = resObj.conversation_id;
        }
        worker.turnsCompleted += 1;
        worker.lastUsedAt = Date.now();

        const elapsedSeconds = (Date.now() - turn.startTime) / 1000;
        const agentError =
          resObj.error ||
          (typeof resObj.status === 'string' && resObj.status.toUpperCase() === 'ERROR'
            ? `Agent reported status: ${resObj.status}`
            : null);

        const rawResponse = resObj.response || turn.streamedText || '';

        if (agentError && !rawResponse) {
          retireWarmWorker(worker);
          prewarmAgentSession(projectDir);
          turn.reject(
            new Error(
              `Agent failed: ${String(agentError).slice(0, 800)}${
                worker.stderrBuffer ? `\n${worker.stderrBuffer.slice(-400)}` : ''
              }`
            )
          );
          continue;
        }

        if (worker.conversationId && turn.projectAlias) {
          try {
            const updatedState = loadProjectsState();
            updatedState.conversations = updatedState.conversations || {};
            // Single persistent Antigravity session bound directly to this project
            updatedState.conversations[turn.projectAlias] = worker.conversationId;
            saveProjectsState(updatedState);
          } catch {
            // ignore state save error
          }
        }

        const gitSummary = getGitChangesSummary(projectDir);

        // Keep worker alive with its persistent conversation session; rotate if turn count is exceeded
        // but preserve conversationId so next worker immediately resumes the exact same Antigravity session
        if (worker.turnsCompleted >= MAX_TURNS_PER_WORKER) {
          const preservedConvId = worker.conversationId;
          retireWarmWorker(worker);
          createWarmWorker(projectDir, preservedConvId);
        }

        turn.resolve({
          response: formatForWhatsApp(rawResponse || 'Task completed (no text output).'),
          conversationId: worker.conversationId,
          durationSeconds: resObj.duration_seconds || elapsedSeconds,
          numTurns: resObj.num_turns || 1,
          gitSummary,
        });
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    worker.stderrBuffer = (worker.stderrBuffer + chunk.toString()).slice(-2000);
  });

  const handleExit = (code, signal) => {
    worker.dead = true;
    if (warmPool.get(projectDir) === worker) {
      warmPool.delete(projectDir);
    }

    const waiters = worker.initWaiters.splice(0);
    for (const w of waiters) {
      w.reject(
        new Error(
          `Agent process exited before init (code=${code}, signal=${signal}). ${worker.stderrBuffer.slice(-400)}`
        )
      );
    }

    if (worker.currentTurn) {
      const turn = worker.currentTurn;
      worker.currentTurn = null;
      clearTimeout(turn.timer);
      if (activeChildProcess === child) {
        activeChildProcess = null;
        currentTaskInfo = null;
      }

      if (signal === 'SIGTERM' || signal === 'SIGKILL' || child._cancelledByUser) {
        const cancelErr = new Error('Task was cancelled by user.');
        cancelErr.cancelled = true;
        turn.reject(cancelErr);
        setTimeout(() => prewarmAgentSession(projectDir), 500).unref?.();
        return;
      }

      const exitErr = new Error(
        `Agent exited unexpectedly (code ${code}). ${worker.stderrBuffer.slice(-600)}`
      );
      exitErr.workerDied = true;
      turn.reject(exitErr);
    }
  };

  child.on('error', (err) => {
    worker.stderrBuffer += `\n${err.message}`;
    handleExit(1, null);
  });

  child.on('close', handleExit);

  return worker;
}

/**
 * Pre-warms an Antigravity CLI process for `projectDir` in the background
 * so the next message in that project has zero cold-start latency (~2s response).
 */
export function prewarmAgentSession(projectDir, projectAlias = null) {
  try {
    if (!projectDir || !fs.existsSync(projectDir)) return;
    const existing = warmPool.get(projectDir);
    if (existing && !existing.dead) return;
    let savedConvId = null;
    try {
      const state = loadProjectsState();
      if (projectAlias && state.conversations?.[projectAlias]) {
        savedConvId = state.conversations[projectAlias];
      } else {
        // Find matching project alias for this project directory
        for (const [alias, dir] of Object.entries(state.projects || {})) {
          if (dir === projectDir && state.conversations?.[alias]) {
            savedConvId = state.conversations[alias];
            break;
          }
        }
      }
    } catch {}
    createWarmWorker(projectDir, savedConvId);
  } catch {
    // Ignore prewarm errors
  }
}

/**
 * Pre-warms the default project and bound group projects at startup.
 */
export function prewarmAllBoundProjects() {
  try {
    const state = loadProjectsState();
    const dirs = new Set();
    const activeAlias = state.activeProject || 'demo';
    if (state.projects?.[activeAlias]) {
      dirs.add(state.projects[activeAlias]);
    }
    if (CONFIG.defaultProjectDir) {
      dirs.add(CONFIG.defaultProjectDir);
    }
    for (const alias of Object.values(state.groupBindings || {})) {
      if (state.projects?.[alias]) {
        dirs.add(state.projects[alias]);
      }
      if (dirs.size >= MAX_WARM_WORKERS) break;
    }
    let delay = 0;
    for (const dir of dirs) {
      setTimeout(() => prewarmAgentSession(dir), delay).unref?.();
      delay += 1500;
    }
  } catch {
    // Ignore
  }
}

async function runWithWarmWorker({
  projectAlias,
  projectDir,
  taskPrompt,
  systemWrapperPrompt,
  ownerAllowedToMessage,
  timeoutMs,
  allowRetry = true,
}) {
  let worker = warmPool.get(projectDir);
  const wasPreexisting = Boolean(worker && !worker.dead);

  if (!worker || worker.dead || worker.currentTurn) {
    let savedConvId = null;
    try {
      const state = loadProjectsState();
      savedConvId = state.conversations?.[projectAlias] || null;
    } catch {}

    try {
      worker = createWarmWorker(projectDir, savedConvId);
      worker.projectAlias = projectAlias;
    } catch (err) {
      if (savedConvId) {
        // Fallback to fresh worker if resuming previous conversation failed
        try {
          const updatedState = loadProjectsState();
          if (updatedState.conversations?.[projectAlias]) {
            delete updatedState.conversations[projectAlias];
            saveProjectsState(updatedState);
          }
        } catch {}
        worker = createWarmWorker(projectDir, null);
        worker.projectAlias = projectAlias;
      } else {
        throw err;
      }
    }
  }

  activeChildProcess = worker.child;
  currentTaskInfo = {
    projectAlias,
    projectDir,
    taskPrompt,
    startedAt: new Date().toISOString(),
  };

  try {
    if (!worker.ready) {
      await new Promise((resolve, reject) => {
        worker.initWaiters.push({ resolve, reject });
      });
    }

    worker.lastOwnerMode = ownerAllowedToMessage;
    worker.lastUsedAt = Date.now();

    return await new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timer = setTimeout(() => {
        if (worker.currentTurn) {
          worker.currentTurn = null;
        }
        if (activeChildProcess === worker.child) {
          activeChildProcess = null;
          currentTaskInfo = null;
        }
        retireWarmWorker(worker);
        prewarmAgentSession(projectDir);
        reject(
          new Error(`Task timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
        );
      }, timeoutMs);

      worker.currentTurn = {
        projectAlias,
        startTime,
        timer,
        streamedText: '',
        resolve,
        reject,
      };

      const payload = JSON.stringify({
        event: 'user',
        message: {
          role: 'user',
          content: systemWrapperPrompt,
        },
      });

      worker.child.stdin.write(`${payload}\n`, (err) => {
        if (err && worker.currentTurn) {
          const turn = worker.currentTurn;
          worker.currentTurn = null;
          clearTimeout(turn.timer);
          retireWarmWorker(worker);
          const writeErr = new Error(`Failed to write to warm worker: ${err.message}`);
          writeErr.workerDied = true;
          turn.reject(writeErr);
        }
      });
    });
  } catch (err) {
    if (err.cancelled) throw err;
    // If resuming an old conversation ID failed (or process died while idle), clear the stale conversation ID and retry once
    if (allowRetry) {
      if (worker) retireWarmWorker(worker);
      try {
        const state = loadProjectsState();
        if (state.conversations?.[projectAlias]) {
          delete state.conversations[projectAlias];
          saveProjectsState(state);
        }
      } catch {}

      return runWithWarmWorker({
        projectAlias,
        projectDir,
        taskPrompt,
        systemWrapperPrompt,
        ownerAllowedToMessage,
        timeoutMs,
        allowRetry: false,
      });
    }
    throw err;
  }
}
