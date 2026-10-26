import { getFriends, addFriend, loadProjectsState, saveProjectsState } from '../config.js';
import { addGitHubCollaborator } from '../agent.js';

const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Searches the registered friends directory for a given name or username.
 */
export function findFriend(query) {
  if (!query) return null;
  const friends = getFriends();
  const clean = String(query).replace(/^@/, '').trim().toLowerCase();

  // 1. Exact match on name or github
  const exact = friends.find(
    (f) => f.name.toLowerCase() === clean || f.github.toLowerCase() === clean
  );
  if (exact) return exact;

  // 2. Starts with / Substring match
  const partial = friends.find(
    (f) =>
      f.name.toLowerCase().startsWith(clean) ||
      clean.startsWith(f.name.toLowerCase()) ||
      f.github.toLowerCase().startsWith(clean)
  );
  return partial || null;
}

/**
 * Handles a collaborator request by checking the registered Friends directory.
 * If known, returns friend info ready for invite.
 * If unknown, saves a pending verification state and returns a verification prompt listing all registered friends.
 */
export function handleCollaboratorRequest({ requestedName, role = 'write', groupJid, projectDir }) {
  const matched = findFriend(requestedName);

  if (matched) {
    return {
      status: 'known',
      friend: matched,
      username: matched.github,
      permission: role,
    };
  }

  // Unknown friend: build verification prompt with registered friends list
  const friends = getFriends();
  const state = loadProjectsState();
  state.pendingCollaborators = state.pendingCollaborators || {};

  state.pendingCollaborators[groupJid] = {
    requestedName: String(requestedName).trim(),
    role,
    projectDir,
    timestamp: Date.now(),
  };
  saveProjectsState(state);

  let friendsListText = '_No friends registered yet in the desktop app._';
  if (friends.length > 0) {
    friendsListText = friends
      .map((f) => `• *${f.name}* (\`@${f.github}\`)`)
      .join('\n');
  }

  const prompt = [
    `🤔 *I couldn't find "${requestedName}" in your Friends list.*`,
    '',
    `👥 *Registered Friends:*`,
    friendsListText,
    '',
    `Did you mean one of the above? Or reply with *${requestedName}*'s GitHub username to invite them and add them to your Friends list.`,
  ].join('\n');

  return {
    status: 'unknown',
    replyPrompt: prompt,
    requestedName,
  };
}

/**
 * Resolves an active pending collaborator verification when the user replies in WhatsApp.
 */
export function resolvePendingCollaborator(groupJid, userReplyText) {
  const state = loadProjectsState();
  const pending = state.pendingCollaborators?.[groupJid];

  if (!pending) return null;

  // Expire after 5 minutes
  if (Date.now() - pending.timestamp > PENDING_TTL_MS) {
    delete state.pendingCollaborators[groupJid];
    saveProjectsState(state);
    return null;
  }

  const cleanReply = String(userReplyText).trim();

  // 1. Check if user answered with one of the registered friends (e.g. "Jai" or "use Jai")
  const matchedFriend = findFriend(cleanReply);
  if (matchedFriend) {
    delete state.pendingCollaborators[groupJid];
    saveProjectsState(state);
    return {
      resolved: true,
      friend: matchedFriend,
      username: matchedFriend.github,
      permission: pending.role || 'write',
      projectDir: pending.projectDir,
      newlyAdded: false,
    };
  }

  // 2. Check if user replied with a GitHub username or URL
  // e.g. "rahul99", "github.com/rahul99", "his github is @rahul99", "it's rahul99"
  let githubUser = null;
  const urlMatch = cleanReply.match(/github\.com\/([A-Za-z0-9_-]{1,39})/i);
  const atMatch = cleanReply.match(/@([A-Za-z0-9_-]{1,39})/);
  const isMatch = cleanReply.match(/(?:github\s+(?:is\s+|handle\s+is\s+|id\s+is\s+)?|it'?s\s+|username\s+is\s+)(?:@)?([A-Za-z0-9_-]{1,39})/i);
  const plainWordMatch = cleanReply.match(/^[A-Za-z0-9_-]{1,39}$/);

  if (urlMatch) {
    githubUser = urlMatch[1];
  } else if (atMatch) {
    githubUser = atMatch[1];
  } else if (isMatch) {
    githubUser = isMatch[1];
  } else if (plainWordMatch) {
    githubUser = plainWordMatch[0];
  }

  if (githubUser) {
    // Automatically save them to Friends list under the requested name
    state.friends = Array.isArray(state.friends) ? state.friends : [];
    const trimmedName = String(pending.requestedName).trim();
    const existingIdx = state.friends.findIndex((f) => f.name.toLowerCase() === trimmedName.toLowerCase());
    const friendObj = {
      id: existingIdx >= 0 ? state.friends[existingIdx].id : `friend_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: trimmedName,
      github: githubUser,
      updatedAt: Date.now(),
    };
    if (existingIdx >= 0) {
      state.friends[existingIdx] = friendObj;
    } else {
      state.friends.push(friendObj);
    }

    delete state.pendingCollaborators[groupJid];
    saveProjectsState(state);

    return {
      resolved: true,
      friend: friendObj,
      username: githubUser,
      permission: pending.role || 'write',
      projectDir: pending.projectDir,
      newlyAdded: true,
    };
  }

  return null;
}

/**
 * Executes the GitHub collaborator invite and returns the result with WhatsApp reply formatting.
 */
export async function executeCollaboratorInvite({ username, permission = 'write', projectDir, repoInput = null }) {
  const res = await addGitHubCollaborator({
    username,
    permission,
    projectDir,
    repoInput,
  });

  const invLink = `https://github.com/${res.owner}/${res.repo}/invitations`;
  const isAlready = res.status === 'already_collaborator';

  return {
    success: true,
    owner: res.owner,
    repo: res.repo,
    username: res.username,
    permission: res.permission,
    isAlready,
    invitationUrl: invLink,
  };
}
