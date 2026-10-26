// Weave Desktop Monochrome Controller
document.addEventListener('DOMContentLoaded', async () => {
  const api = window.weaveAPI;

  // Window Controls (Top-Left & Top-Right)
  const btnClose = document.getElementById('btn-close');
  const btnMinimize = document.getElementById('btn-minimize');
  const btnMaximize = document.getElementById('btn-maximize');
  const btnCloseRight = document.getElementById('btn-close-right');
  const btnMinimizeRight = document.getElementById('btn-minimize-right');
  const btnMaximizeRight = document.getElementById('btn-maximize-right');

  if (btnClose) btnClose.addEventListener('click', () => api?.close());
  if (btnMinimize) btnMinimize.addEventListener('click', () => api?.minimize());
  if (btnMaximize) btnMaximize.addEventListener('click', () => api?.maximize());
  if (btnCloseRight) btnCloseRight.addEventListener('click', () => api?.close());
  if (btnMinimizeRight) btnMinimizeRight.addEventListener('click', () => api?.minimize());
  if (btnMaximizeRight) btnMaximizeRight.addEventListener('click', () => api?.maximize());

  // Navigation Tabs
  const tabOnboarding = document.getElementById('tab-onboarding');
  const tabWorkspace = document.getElementById('tab-workspace');
  const viewOnboarding = document.getElementById('view-onboarding');
  const viewWorkspace = document.getElementById('view-workspace');
  const btnLaunchWorkspace = document.getElementById('btn-launch-workspace');

  let isConnected = false;
  let isGoogleConnected = false;
  const tabWorkspaceIcon = document.getElementById('tab-workspace-icon');

  // Step Indicators
  const stepBtn1 = document.getElementById('step-btn-1');
  const stepIcon1 = document.getElementById('step-icon-1');
  const stepBtn2 = document.getElementById('step-btn-2');
  const stepIcon2 = document.getElementById('step-icon-2');
  const stepBtn3 = document.getElementById('step-btn-3');

  // Step Cards
  const step2Card = document.getElementById('step-2-card');
  const step3Card = document.getElementById('step-3-card');
  const step3Badge = document.getElementById('step-3-badge');

  let hasAutoNavigated = false;

  function showView(view) {
    if (view === 'workspace') {
      viewOnboarding.classList.add('hidden');
      viewWorkspace.classList.remove('hidden');
      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-black bg-white transition-all flex items-center gap-1.5 cursor-pointer';
      tabOnboarding.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-secondary hover:text-white transition-all flex items-center gap-1.5 cursor-pointer';
    } else {
      viewWorkspace.classList.add('hidden');
      viewOnboarding.classList.remove('hidden');
      tabOnboarding.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-black bg-white transition-all flex items-center gap-1.5 cursor-pointer';
      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-secondary hover:text-white transition-all flex items-center gap-1.5 cursor-pointer';
    }
  }

  tabOnboarding.addEventListener('click', () => showView('onboarding'));
  tabWorkspace.addEventListener('click', () => showView('workspace'));
  btnLaunchWorkspace.addEventListener('click', () => showView('workspace'));

  // Header Elements
  const waHeaderDot = document.getElementById('wa-header-dot');
  const waHeaderText = document.getElementById('wa-header-text');
  const googleEmail = document.getElementById('google-email');
  const googleAvatarLetter = document.getElementById('google-avatar-letter');

  // Step 1: QR & WhatsApp
  const qrImage = document.getElementById('qr-image');
  const qrPlaceholder = document.getElementById('qr-placeholder');
  const qrConnectedOverlay = document.getElementById('qr-connected-overlay');
  const qrConnectedNumber = document.getElementById('qr-connected-number');
  const qrLivePulse = document.getElementById('qr-live-pulse');

  // Step 2: Google PKCE
  const btnGoogleLogin = document.getElementById('btn-google-login');
  const googleStatusTitle = document.getElementById('google-status-title');
  const googleStatusDesc = document.getElementById('google-status-desc');
  const googleVerifiedIcon = document.getElementById('google-verified-icon');

  // Step 3: Trigger Handle
  const botTagInput = document.getElementById('bot-tag-input');
  const btnSaveHandle = document.getElementById('btn-save-handle');
  const callsignDisplay = document.getElementById('callsign-display');
  const btnCopyCallsign = document.getElementById('btn-copy-callsign');

  // Master Directory Elements (Onboarding & Workspace)
  const masterDirInputOnboarding = document.getElementById('master-dir-input-onboarding');
  const btnBrowseMasterDirOnboarding = document.getElementById('btn-browse-master-dir-onboarding');
  const btnSaveMasterDirOnboarding = document.getElementById('btn-save-master-dir-onboarding');
  const masterDirBadgeOnboarding = document.getElementById('master-dir-badge-onboarding');

  const masterDirInputWorkspace = document.getElementById('master-dir-input-workspace');
  const btnBrowseMasterDirWorkspace = document.getElementById('btn-browse-master-dir-workspace');
  const btnSaveMasterDirWorkspace = document.getElementById('btn-save-master-dir-workspace');
  const masterDirWorkspaceBadge = document.getElementById('master-dir-workspace-badge');
  const badgeMountedCount = document.getElementById('badge-mounted-count');

  // Workspace Feed & Elements
  const terminalBody = document.getElementById('terminal-body');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const promptInput = document.getElementById('prompt-input');
  const btnRunPrompt = document.getElementById('btn-run-prompt');
  const btnQuickStop = document.getElementById('btn-quick-stop');
  const workspaceBotStatusTag = document.getElementById('workspace-bot-status-tag');
  const activeProjectPath = document.getElementById('active-project-path');
  const projectsListContainer = document.getElementById('projects-list-container');

  // Friends & Collaborators Directory Elements
  const friendsListContainer = document.getElementById('friends-list-container');
  const badgeFriendsCount = document.getElementById('badge-friends-count');
  const inputFriendName = document.getElementById('input-friend-name');
  const inputFriendGithub = document.getElementById('input-friend-github');
  const btnAddFriend = document.getElementById('btn-add-friend');

  // Copy callsign helper
  if (btnCopyCallsign) {
    btnCopyCallsign.addEventListener('click', () => {
      const text = callsignDisplay.textContent || '@weave';
      navigator.clipboard.writeText(text);
      btnCopyCallsign.innerHTML = '<span class="text-white">✓</span><span>Copied</span>';
      setTimeout(() => {
        btnCopyCallsign.innerHTML = '<span class="text-app-tertiary">⌘C</span><span>Copy</span>';
      }, 1500);
    });
  }

  // Terminal logging
  function appendLog(level, text, time = new Date().toLocaleTimeString()) {
    const row = document.createElement('div');
    row.className = 'flex items-start gap-2 leading-relaxed';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-app-dim shrink-0';
    timeSpan.textContent = `[${time}]`;

    const content = document.createElement('span');
    content.className = 'break-all';

    if (level === 'error') {
      content.className += ' text-neutral-300 font-semibold';
    } else if (level === 'warn') {
      content.className += ' text-neutral-400';
    } else if (text.includes('ONLINE') || text.includes('Connected') || text.includes('✅')) {
      content.className += ' text-white font-semibold';
    } else {
      content.className += ' text-app-secondary';
    }

    content.textContent = text;
    row.appendChild(timeSpan);
    row.appendChild(content);

    terminalBody.appendChild(row);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      terminalBody.innerHTML = '<div class="text-app-dim">// Stream cleared.</div>';
    });
  }

  const btnCopyLogs = document.getElementById('btn-copy-logs');
  if (btnCopyLogs) {
    btnCopyLogs.addEventListener('click', async () => {
      if (!terminalBody) return;
      const textToCopy = terminalBody.innerText || '';
      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalHTML = btnCopyLogs.innerHTML;
        btnCopyLogs.innerHTML = '<i class="fa-solid fa-check text-[10px] text-white"></i><span>copied!</span>';
        setTimeout(() => {
          btnCopyLogs.innerHTML = originalHTML;
        }, 1800);
      } catch (err) {
        console.error('Failed to copy stream text:', err);
      }
    });
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderProjectsList(projects, activeProject, groupBindings = {}, groupNames = {}, projectAccess = {}, friends = [], groupAllowAll = {}) {
    if (!projectsListContainer) return;
    const projectEntries = Object.entries(projects || {});
    if (projectEntries.length === 0) {
      projectsListContainer.innerHTML = `
        <div class="p-3 rounded bg-app-canvas border border-app-border text-center text-app-tertiary text-xs font-mono">
          No projects discovered or configured.
        </div>`;
      return;
    }

    // Map: alias (lowercase) -> array of groupJids
    const bindingsByProject = {};
    for (const [groupJid, alias] of Object.entries(groupBindings || {})) {
      if (!alias) continue;
      const lower = alias.toLowerCase();
      if (!bindingsByProject[lower]) {
        bindingsByProject[lower] = [];
      }
      bindingsByProject[lower].push(groupJid);
    }

    projectsListContainer.innerHTML = projectEntries
      .map(([alias, folderPath]) => {
        const isGlobalActive =
          (activeProject || '').toLowerCase() === alias.toLowerCase();
        const boundGroups = bindingsByProject[alias.toLowerCase()] || [];
        const hasGroups = boundGroups.length > 0;

        let groupsHtml = '';
        if (hasGroups) {
          groupsHtml = boundGroups
            .map((jid) => {
              const cleanJid = escapeHtml(jid);
              const shortJid = escapeHtml(jid.replace('@g.us', ''));
              const realGroupName = groupNames[jid] ? escapeHtml(groupNames[jid]) : `Group ${shortJid}`;
              const isAllowAll = Boolean(groupAllowAll[jid]);

              return `
                <div class="flex flex-col gap-1.5 text-[10px] font-mono bg-zinc-900/90 border border-zinc-800 rounded p-2 mt-1.5">
                  <div class="flex items-center justify-between gap-1">
                    <span class="flex items-center gap-1.5 text-emerald-400 truncate" title="${cleanJid}">
                      <i class="fa-brands fa-whatsapp text-[12px] shrink-0 text-emerald-400"></i>
                      <div class="flex flex-col truncate">
                        <span class="text-zinc-200 font-semibold truncate text-[11px]">${realGroupName}</span>
                        <span class="text-[9px] text-zinc-500 tracking-tight select-all"><sub>id: ${shortJid}</sub></span>
                      </div>
                    </span>
                    <div class="flex items-center gap-1 shrink-0">
                      <span class="text-[8px] px-1 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 rounded uppercase font-medium">Bound</span>
                      <button
                        class="btn-unbind-group text-[9px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 px-1.5 py-0.5 rounded border border-zinc-700/60 hover:border-red-500/30 transition cursor-pointer"
                        data-jid="${cleanJid}"
                        data-alias="${escapeHtml(alias)}"
                        title="Unbind this group from project"
                      >
                        Unbind
                      </button>
                    </div>
                  </div>

                  <!-- Permission to All toggle for this group -->
                  <div class="flex items-center justify-between pt-1 border-t border-zinc-800/80 text-[10px]">
                    <div class="flex items-center gap-1.5 text-zinc-300">
                      <i class="fa-solid fa-users text-[10px] ${isAllowAll ? 'text-emerald-400' : 'text-zinc-500'}"></i>
                      <span class="${isAllowAll ? 'text-emerald-300 font-medium' : 'text-zinc-400'}">Give Permission to All</span>
                    </div>
                    <button
                      type="button"
                      class="btn-toggle-group-allow-all px-2 py-0.5 rounded text-[9px] font-mono border transition cursor-pointer flex items-center gap-1.5 ${
                        isAllowAll
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50 hover:bg-emerald-900/60'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200'
                      }"
                      data-jid="${cleanJid}"
                      data-allowed="${isAllowAll ? 'true' : 'false'}"
                      title="${isAllowAll ? 'Click to restrict to specified numbers' : 'Click so anyone in this group can interact with the bot'}"
                    >
                      <span class="w-1.5 h-1.5 rounded-full ${isAllowAll ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-zinc-500'}"></span>
                      <span>${isAllowAll ? 'ALL MEMBERS ON' : 'RESTRICTED'}</span>
                    </button>
                  </div>
                </div>
              `;
            })
            .join('');
        } else {
          groupsHtml = `
            <div class="flex items-center gap-1 text-[10px] font-mono text-zinc-500 mt-1 px-0.5">
              <i class="fa-brands fa-whatsapp text-zinc-600 text-[10px]"></i>
              <span>No group bound</span>
            </div>
          `;
        }

        const safeAlias = escapeHtml(alias);
        const safePath = escapeHtml(folderPath);
        const allowedNumbers = Array.isArray(projectAccess[alias.toLowerCase()])
          ? projectAccess[alias.toLowerCase()]
          : [];

        return `
          <div class="p-2.5 rounded-lg bg-app-canvas border border-app-border hover:border-zinc-600 transition flex flex-col gap-1.5 group">
            <!-- Top Row: Alias, Badges & Actions -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-6 h-6 rounded bg-app-subtle border border-app-border flex items-center justify-center text-white text-xs shrink-0">
                  <i class="fa-solid fa-code text-[10px]"></i>
                </div>
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="text-xs font-semibold text-white font-mono truncate" title="${safeAlias}">${safeAlias}</span>
                  ${
                    hasGroups
                      ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono font-medium flex items-center gap-1 shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>${boundGroups.length} GROUP${boundGroups.length > 1 ? 'S' : ''}</span>`
                      : `<span class="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-500 border border-zinc-700/60 font-mono shrink-0">UNBOUND</span>`
                  }
                </div>
              </div>

              <!-- Action Buttons -->
              <div class="flex items-center gap-1 shrink-0">
                <button
                  class="btn-open-folder text-[10px] font-mono px-2 py-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded border border-zinc-700/60 transition cursor-pointer flex items-center gap-1"
                  data-path="${safePath}"
                  title="Open folder in File Explorer"
                >
                  <i class="fa-regular fa-folder-open text-xs"></i>
                  <span>Open</span>
                </button>
              </div>
            </div>

            <!-- Middle Row: Folder Path -->
            <div class="text-[10px] font-mono text-app-tertiary truncate select-all px-0.5" title="${safePath}">
              ${safePath}
            </div>

            <!-- Bottom Section: WhatsApp Group Bindings -->
            <div class="pt-1 border-t border-app-borderSubtle">
              <div class="text-[9px] font-mono uppercase text-app-tertiary flex items-center justify-between">
                <span>WhatsApp Group Binding</span>
                ${hasGroups ? `<span class="text-emerald-400 font-mono text-[9px]">${boundGroups.length} Active</span>` : ''}
              </div>
              ${groupsHtml}
            </div>

            <!-- Permission Manager (Per Project) -->
            <div class="pt-2 mt-1 border-t border-app-borderSubtle flex flex-col gap-1.5">
              <div class="text-[9px] font-mono uppercase text-app-tertiary flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <i class="fa-solid fa-shield-halved text-[10px] text-zinc-400"></i>
                  <span>Permissions</span>
                </div>
                <span class="text-zinc-500 font-mono text-[9px]">${allowedNumbers.length + 1} Authorized</span>
              </div>

              <!-- Allowed Numbers / Badges -->
              <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
                <!-- Owner Badge (Default Full Access) -->
                <span class="text-[9px] font-mono px-2 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-600/40 flex items-center gap-1 select-none" title="Owner has full access by default">
                  <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  <span>👑 Owner (Full Access)</span>
                </span>

                ${allowedNumbers
                  .map((num) => {
                    const safeNum = escapeHtml(num);
                    return `
                      <span class="text-[9px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700 flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span>${safeNum}</span>
                        <button
                          type="button"
                          class="btn-remove-perm text-zinc-400 hover:text-red-400 transition cursor-pointer ml-0.5 text-[10px] leading-none"
                          data-alias="${safeAlias}"
                          data-phone="${safeNum}"
                          title="Remove ${safeNum}"
                        >✕</button>
                      </span>
                    `;
                  })
                  .join('')}

                ${allowedNumbers.length === 0 ? `<span class="text-[9px] font-mono text-zinc-500 italic py-0.5">(Only owner has access)</span>` : ''}
              </div>

              <!-- Add Number Form -->
              <form class="form-add-perm flex items-center gap-1.5 mt-1" data-alias="${safeAlias}">
                <div class="flex items-center bg-zinc-900 border border-zinc-800 focus-within:border-zinc-600 rounded px-2 py-1 flex-1 text-[11px] font-mono">
                  <span class="text-zinc-500 text-[10px] mr-1 select-none">+91</span>
                  <input
                    type="text"
                    class="input-perm-phone bg-transparent text-zinc-100 placeholder-zinc-600 focus:outline-none w-full text-[11px] font-mono"
                    placeholder="Phone number (e.g. 9876543210)"
                    autocomplete="off"
                  />
                </div>
                <button
                  type="submit"
                  class="text-[10px] font-mono px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white rounded border border-zinc-700 transition cursor-pointer flex items-center gap-1 shrink-0"
                  title="Add phone number"
                >
                  <i class="fa-solid fa-plus text-[9px]"></i>
                  <span>Add</span>
                </button>
              </form>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderFriendsList(friends) {
    if (!friendsListContainer) return;
    const friendList = Array.isArray(friends) ? friends : [];
    if (badgeFriendsCount) {
      badgeFriendsCount.textContent = `${friendList.length} REGISTERED`;
    }
    if (friendList.length === 0) {
      friendsListContainer.innerHTML = `
        <div class="p-2.5 rounded bg-app-canvas border border-app-border text-center text-app-tertiary text-xs font-mono">
          No friends added yet.
        </div>`;
      return;
    }

    friendsListContainer.innerHTML = friendList
      .map((f) => {
        const safeName = escapeHtml(f.name || 'Friend');
        const safeGithub = escapeHtml(f.github || '');
        const safeId = escapeHtml(f.id || f.name);
        const avatarLetter = (f.name?.[0] || 'F').toUpperCase();
        return `
          <div class="flex items-center justify-between p-2 rounded bg-app-canvas border border-app-border">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-6 h-6 rounded-full bg-app-subtle border border-app-border flex items-center justify-center text-white text-[10px] font-mono font-bold shrink-0">
                ${avatarLetter}
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-medium text-white truncate">${safeName}</span>
                <span class="text-[10px] font-mono text-zinc-400 flex items-center gap-1 truncate">
                  <i class="fa-brands fa-github text-[10px] text-zinc-500"></i>
                  <span>@${safeGithub}</span>
                </span>
              </div>
            </div>
            <button
              class="btn-remove-friend text-[10px] text-zinc-500 hover:text-red-400 hover:bg-red-500/10 p-1 rounded border border-transparent hover:border-red-500/30 transition cursor-pointer shrink-0"
              data-id="${safeId}"
              data-name="${safeName}"
              title="Remove friend from directory"
            >
              <span class="material-symbols-outlined text-[13px]">delete</span>
            </button>
          </div>
        `;
      })
      .join('');
  }

  // State Synchronizer
  function renderState(state) {
    if (!state) return;

    function setQrDisplay(dataUrl) {
      if (!dataUrl) return;
      qrImage.src = dataUrl;
      qrImage.style.display = 'block';
      qrImage.classList.remove('hidden');
      qrPlaceholder.style.display = 'none';
      qrPlaceholder.classList.add('hidden');
      qrConnectedOverlay.style.display = 'none';
      qrConnectedOverlay.classList.add('hidden');
      waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse inline-block';
      waHeaderText.textContent = 'Scan QR Code';
      workspaceBotStatusTag.textContent = 'SCAN QR';
    }

    isConnected = Boolean(state.bot?.connected);
    isGoogleConnected = Boolean(state.google?.authenticated && state.google?.email);

    // Automatically transition to workspace view when WhatsApp is online!
    if (isConnected && !hasAutoNavigated) {
      hasAutoNavigated = true;
      showView('workspace');
    }

    // 1. WhatsApp Bot State (Step 1)
    if (isConnected) {
      waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-white inline-block';
      waHeaderText.textContent = 'WhatsApp Connected';
      qrPlaceholder.style.display = 'none';
      qrPlaceholder.classList.add('hidden');
      qrImage.style.display = 'none';
      qrImage.classList.add('hidden');
      qrConnectedOverlay.style.display = 'flex';
      qrConnectedOverlay.classList.remove('hidden');
      qrConnectedNumber.textContent = state.bot.user?.id?.split(':')[0] || 'Active';
      qrLivePulse.className = 'w-1.5 h-1.5 rounded-full bg-white';

      // Step 1 completed
      stepBtn1.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-white font-medium';
      stepIcon1.textContent = 'check_circle';
      stepIcon1.className = 'material-symbols-outlined text-[15px] text-white';

      workspaceBotStatusTag.textContent = 'ONLINE';
    } else {
      stepBtn1.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-white text-black font-semibold shadow-sm';
      stepIcon1.textContent = 'qr_code_scanner';
      stepIcon1.className = 'material-symbols-outlined text-[15px] text-black';

      if (state.bot?.qrData?.dataUrl) {
        setQrDisplay(state.bot.qrData.dataUrl);
      }
    }

    // 2. Google OAuth Status (Step 2 — Strictly Gated Behind Step 1)
    if (!isConnected) {
      // Locked until Step 1 is done
      if (step2Card) {
        step2Card.style.opacity = '0.45';
      }
      googleStatusTitle.textContent = 'Step 2: Connect Google Account (PKCE)';
      googleStatusDesc.textContent = 'Link WhatsApp in Step 1 first to unlock Google PKCE Sign-In';
      googleVerifiedIcon.classList.add('hidden');
      btnGoogleLogin.textContent = '🔒 Locked';
      btnGoogleLogin.className = 'text-xs font-mono font-medium px-3.5 py-1.5 rounded-lg bg-app-subtle text-app-dim border border-app-border transition-all shrink-0 cursor-not-allowed';

      stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-app-dim font-medium';
      stepIcon2.textContent = 'lock';
      stepIcon2.className = 'material-symbols-outlined text-[15px] text-app-dim';
    } else if (!isGoogleConnected) {
      // Step 1 is complete -> Unlock Step 2!
      if (step2Card) {
        step2Card.style.opacity = '1';
      }
      googleStatusTitle.textContent = 'Step 2: Connect Google Account (PKCE)';
      googleStatusDesc.textContent = 'Required for Gemini 2.5/3.8 Flash execution & calendar actions';
      googleVerifiedIcon.classList.add('hidden');
      if (!btnGoogleLogin.innerHTML.includes('fa-spinner')) {
        btnGoogleLogin.textContent = 'Sign In';
      }
      btnGoogleLogin.className = 'text-xs font-mono font-medium px-3.5 py-1.5 rounded-lg bg-white hover:bg-neutral-200 text-black transition-all shrink-0 active:scale-95 shadow cursor-pointer';

      stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-white text-black font-semibold shadow-sm';
      stepIcon2.textContent = 'login';
      stepIcon2.className = 'material-symbols-outlined text-[15px] text-black';
    } else {
      // Both Step 1 & Step 2 completed!
      if (step2Card) {
        step2Card.style.opacity = '1';
      }
      googleEmail.textContent = state.google.email;
      googleAvatarLetter.textContent = (state.google.email[0] || 'G').toUpperCase();
      googleStatusTitle.textContent = `Connected as ${state.google.email}`;
      googleStatusDesc.textContent = 'Gemini 2.5/3.8 Flash, Google Calendar & Gmail active';
      googleVerifiedIcon.classList.remove('hidden');
      btnGoogleLogin.textContent = 'Connected ✓';
      btnGoogleLogin.className = 'text-xs font-mono font-medium px-3.5 py-1.5 rounded-lg bg-app-subtle text-white border border-app-border shrink-0 cursor-pointer hover:border-white';

      stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-white font-medium';
      stepIcon2.textContent = 'check_circle';
      stepIcon2.className = 'material-symbols-outlined text-[15px] text-white';
    }

    // 3. Trigger Handle & Workspace
    const rawTrigger = state.bot?.triggerPrefix || '@weave';
    const trigger = rawTrigger === '@agent' ? '@weave' : rawTrigger;
    if (document.activeElement !== botTagInput) {
      botTagInput.value = trigger.replace(/^@/, '');
    }
    callsignDisplay.textContent = trigger;

    if (isConnected) {
      // Unlock Step 3 & Workspace
      if (step3Card) step3Card.style.opacity = '1';
      botTagInput.disabled = false;
      botTagInput.className = 'bg-transparent border-none text-white font-mono text-xs focus:outline-none w-full px-1 tracking-tight';
      btnSaveHandle.disabled = false;
      if (btnSaveHandle.textContent !== 'Saved') {
        btnSaveHandle.textContent = 'Save';
      }
      btnSaveHandle.className = 'text-xs font-mono px-2.5 py-1 bg-white hover:bg-neutral-200 text-black font-semibold rounded transition-all cursor-pointer';

      if (stepBtn3) {
        stepBtn3.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-white text-black font-semibold shadow-sm';
      }

      // Unlock Launch Workspace Button & Top Tab
      btnLaunchWorkspace.className = 'w-full py-3 px-6 rounded-lg bg-white hover:bg-neutral-200 text-black text-xs font-mono font-semibold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.99] cursor-pointer';
      btnLaunchWorkspace.innerHTML = '<span>Open Desktop Workspace</span><i class="fa-solid fa-arrow-right text-[11px]"></i>';

      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-secondary hover:text-white transition-all flex items-center gap-1.5 cursor-pointer';
      tabWorkspace.removeAttribute('title');
      if (tabWorkspaceIcon) tabWorkspaceIcon.textContent = 'terminal';
    } else {
      if (step3Card) step3Card.style.opacity = '1';
      botTagInput.disabled = false;
      botTagInput.className = 'bg-transparent border-none text-white font-mono text-xs focus:outline-none w-full px-1 tracking-tight';
      btnSaveHandle.disabled = false;
      if (btnSaveHandle.textContent !== 'Saved') {
        btnSaveHandle.textContent = 'Save';
      }
      btnSaveHandle.className = 'text-xs font-mono px-2.5 py-1 bg-white hover:bg-neutral-200 text-black font-semibold rounded transition-all cursor-pointer';

      if (stepBtn3) {
        stepBtn3.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-app-dim font-medium';
      }

      const lockMsg = 'Link WhatsApp in Step 1 to Unlock Workspace';
      btnLaunchWorkspace.className = 'w-full py-3 px-6 rounded-lg bg-app-subtle text-app-dim border border-app-border text-xs font-mono font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-all opacity-50 cursor-not-allowed';
      btnLaunchWorkspace.innerHTML = `<span class="material-symbols-outlined text-[14px]">lock</span><span>${lockMsg}</span>`;

      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-dim opacity-50 cursor-not-allowed transition-all flex items-center gap-1.5';
      tabWorkspace.setAttribute('title', lockMsg);
      if (tabWorkspaceIcon) tabWorkspaceIcon.textContent = 'lock';
    }

    // 4. Projects, Master Directory & Autopilot
    const masterDir = state.masterDir || '';
    if (masterDirInputOnboarding && document.activeElement !== masterDirInputOnboarding) {
      masterDirInputOnboarding.value = masterDir;
    }
    if (masterDirInputWorkspace && document.activeElement !== masterDirInputWorkspace) {
      masterDirInputWorkspace.value = masterDir;
    }
    if (masterDirWorkspaceBadge) {
      masterDirWorkspaceBadge.textContent = masterDir ? 'Active' : 'Not set (defaults to ~/Documents)';
    }

    if (state.projects) {
      const projCount = Object.keys(state.projects).length;
      if (badgeMountedCount) {
        badgeMountedCount.textContent = `${projCount} MOUNTED`;
      }
      renderProjectsList(
        state.projects,
        state.activeProject,
        state.groupBindings || {},
        state.groupNames || {},
        state.projectAccess || {},
        state.friends || [],
        state.groupAllowAll || {}
      );
    }

    if (activeProjectPath && state.activeProject && state.projects?.[state.activeProject]) {
      activeProjectPath.textContent = state.projects[state.activeProject];
    }
    if (state.friends) {
      renderFriendsList(state.friends);
    }
  }

  async function syncStatus() {
    if (!api) return;
    try {
      const state = await api.getStatus();
      renderState(state);
    } catch (err) {
      appendLog('error', `Status sync error: ${err.message}`);
    }
  }

  // IPC Event Streams
  if (api) {
    api.onQrUpdate((qrData) => {
      if (qrData?.dataUrl) {
        qrImage.src = qrData.dataUrl;
        qrImage.style.display = 'block';
        qrImage.classList.remove('hidden');
        qrPlaceholder.style.display = 'none';
        qrPlaceholder.classList.add('hidden');
        qrConnectedOverlay.style.display = 'none';
        qrConnectedOverlay.classList.add('hidden');
        waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse inline-block';
        waHeaderText.textContent = 'Scan QR Code';
        appendLog('info', '📱 Fresh WhatsApp QR generated. Ready to scan.');
      }
    });

    api.onStatusUpdate((update) => {
      if (update.status === 'connected') {
        waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-white inline-block';
        waHeaderText.textContent = 'WhatsApp Connected';
        qrConnectedOverlay.classList.remove('hidden');
        qrImage.classList.add('hidden');
        qrPlaceholder.classList.add('hidden');
        appendLog('info', '✅ WhatsApp connection established and linked.');
        syncStatus();
      } else if (update.status === 'disconnected') {
        waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-neutral-600 inline-block';
        waHeaderText.textContent = 'Disconnected';
        appendLog('warn', '⚠️ WhatsApp connection closed.');
      }
    });

    api.onLog(({ level, text, time }) => {
      appendLog(level, text, time);
    });

    if (api.onProjectsUpdate) {
      api.onProjectsUpdate((updatedState) => {
        if (updatedState) {
          renderState(updatedState);
          appendLog('info', '🔄 Dashboard state updated live.');
        }
      });
    }
  }

  // Pairing Code Alternative Handler
  const btnTogglePairingCode = document.getElementById('btn-toggle-pairing-code');
  const pairingCodeBox = document.getElementById('pairing-code-box');
  const pairingPhoneInput = document.getElementById('pairing-phone-input');
  const btnRequestPairingCode = document.getElementById('btn-request-pairing-code');
  const pairingCodeDisplay = document.getElementById('pairing-code-display');
  const pairingCodeDigits = document.getElementById('pairing-code-digits');

  if (btnTogglePairingCode && pairingCodeBox) {
    btnTogglePairingCode.addEventListener('click', () => {
      pairingCodeBox.classList.toggle('hidden');
    });
  }

  if (btnRequestPairingCode) {
    pairingPhoneInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnRequestPairingCode.click();
      }
    });

    btnRequestPairingCode.addEventListener('click', async () => {
      const phone = pairingPhoneInput.value.trim();
      if (!phone) {
        appendLog('warn', '⚠️ Please enter your phone number with country code (e.g. 15551234567).');
        pairingPhoneInput.focus();
        return;
      }
      btnRequestPairingCode.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      btnRequestPairingCode.disabled = true;

      try {
        appendLog('info', `📡 Requesting WhatsApp pairing code for ${phone}...`);
        const res = await api?.requestPairingCode(phone);
        if (res?.success && res?.code) {
          const rawCode = String(res.code).replace(/[^a-zA-Z0-9]/g, '');
          const formatted = rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : res.code;
          pairingCodeDigits.textContent = formatted;
          pairingCodeDisplay.classList.remove('hidden');
          appendLog('info', `🔑 Pairing Code: ${formatted}. On WhatsApp: Settings -> Linked Devices -> Link with phone number -> Enter this code.`);
        } else {
          appendLog('error', `Pairing code error: ${res?.error || 'Failed to request code'}`);
        }
      } catch (err) {
        appendLog('error', err.message);
      } finally {
        btnRequestPairingCode.textContent = 'Get Code';
        btnRequestPairingCode.disabled = false;
      }
    });
  }

  // Google Login Click (Gated behind Step 1)
  btnGoogleLogin.addEventListener('click', async () => {
    if (!isConnected) {
      appendLog('warn', '⚠️ Complete Step 1 (Link WhatsApp) first before connecting your Google Account.');
      if (stepBtn1) {
        stepBtn1.classList.add('animate-pulse');
        setTimeout(() => stepBtn1.classList.remove('animate-pulse'), 1500);
      }
      return;
    }
    btnGoogleLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Opening...';
    const res = await api?.startGoogleLogin();
    if (res?.success) {
      appendLog('info', `✅ Google OAuth (PKCE) verified: ${res.email}`);
      syncStatus();
    } else {
      appendLog('error', `Google login failed: ${res?.error || 'Unknown error'}`);
      btnGoogleLogin.textContent = isGoogleConnected ? 'Connected ✓' : 'Sign In';
    }
  });

  // Handle Save (Unique Call-Sign)
  btnSaveHandle.addEventListener('click', async () => {
    const handle = botTagInput.value.trim();
    if (!handle) return;
    const res = await api?.updateHandle(handle);
    if (res?.success) {
      callsignDisplay.textContent = res.triggerPrefix;
      botTagInput.value = res.triggerPrefix.replace(/^@/, '');
      if (step3Badge) {
        step3Badge.textContent = `Active: ${res.triggerPrefix}`;
        step3Badge.className = 'text-[11px] text-white font-mono';
      }
      appendLog('info', `✅ Unique call-sign configured: ${res.triggerPrefix}`);
      btnSaveHandle.textContent = 'Saved';
      setTimeout(() => { btnSaveHandle.textContent = 'Save'; }, 1500);
    } else {
      const errMsg = res?.error || 'Invalid call-sign';
      if (step3Badge) {
        step3Badge.textContent = `⚠️ ${errMsg}`;
        step3Badge.className = 'text-[11px] text-neutral-300 font-mono';
      }
      appendLog('warn', `⚠️ ${errMsg}`);
    }
  });

  // Master Directory Handlers (Browse & Save)
  async function handleMasterDirSave(targetPath, source) {
    try {
      const res = await api?.setMasterDir(targetPath);
      if (res?.success) {
        if (masterDirInputOnboarding) masterDirInputOnboarding.value = res.masterDir;
        if (masterDirInputWorkspace) masterDirInputWorkspace.value = res.masterDir;
        if (masterDirBadgeOnboarding) {
          masterDirBadgeOnboarding.textContent = res.masterDir ? 'Saved ✓' : 'Cleared';
          masterDirBadgeOnboarding.className = 'text-[11px] text-emerald-400 font-mono';
        }
        if (masterDirWorkspaceBadge) {
          masterDirWorkspaceBadge.textContent = res.masterDir ? 'Active' : 'Not set';
        }
        if (res.projects && badgeMountedCount) {
          badgeMountedCount.textContent = `${Object.keys(res.projects).length} MOUNTED`;
        }
        appendLog('info', `📁 Master directory set to: ${res.masterDir || '(cleared)'}`);
        await syncStatus();
        const btn = source === 'onboarding' ? btnSaveMasterDirOnboarding : btnSaveMasterDirWorkspace;
        if (btn) {
          btn.textContent = 'Saved ✓';
          setTimeout(() => { btn.textContent = 'Save'; }, 1500);
        }
      } else {
        appendLog('error', `Failed to save master directory: ${res?.error || 'Unknown'}`);
      }
    } catch (err) {
      appendLog('error', err.message);
    }
  }

  async function handleMasterDirBrowse(source) {
    try {
      const res = await api?.pickMasterDir();
      if (res?.success && res.masterDir) {
        if (masterDirInputOnboarding) masterDirInputOnboarding.value = res.masterDir;
        if (masterDirInputWorkspace) masterDirInputWorkspace.value = res.masterDir;
        if (masterDirBadgeOnboarding) {
          masterDirBadgeOnboarding.textContent = 'Saved ✓';
          masterDirBadgeOnboarding.className = 'text-[11px] text-emerald-400 font-mono';
        }
        if (masterDirWorkspaceBadge) {
          masterDirWorkspaceBadge.textContent = 'Active';
        }
        if (res.projects && badgeMountedCount) {
          badgeMountedCount.textContent = `${Object.keys(res.projects).length} MOUNTED`;
        }
        appendLog('info', `📁 Selected master directory: ${res.masterDir}`);
        await syncStatus();
      }
    } catch (err) {
      appendLog('error', `Directory picker error: ${err.message}`);
    }
  }

  if (btnBrowseMasterDirOnboarding) {
    btnBrowseMasterDirOnboarding.addEventListener('click', () => handleMasterDirBrowse('onboarding'));
  }
  if (btnBrowseMasterDirWorkspace) {
    btnBrowseMasterDirWorkspace.addEventListener('click', () => handleMasterDirBrowse('workspace'));
  }

  if (btnSaveMasterDirOnboarding) {
    btnSaveMasterDirOnboarding.addEventListener('click', () => {
      handleMasterDirSave(masterDirInputOnboarding?.value?.trim() || '', 'onboarding');
    });
  }
  if (btnSaveMasterDirWorkspace) {
    btnSaveMasterDirWorkspace.addEventListener('click', () => {
      handleMasterDirSave(masterDirInputWorkspace?.value?.trim() || '', 'workspace');
    });
  }

  // Direct Prompt Runner in Workspace
  async function runPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    appendLog('info', `> ${prompt}`);
    promptInput.value = '';
    btnRunPrompt.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnRunPrompt.disabled = true;

    try {
      const res = await api?.runPrompt(prompt);
      if (res?.success) {
        appendLog('info', `Task completed.`);
      } else {
        appendLog('error', `Task failed: ${res?.error || 'Unknown'}`);
      }
    } catch (err) {
      appendLog('error', err.message);
    } finally {
      btnRunPrompt.innerHTML = 'Run';
      btnRunPrompt.disabled = false;
    }
  }

  btnRunPrompt.addEventListener('click', runPrompt);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runPrompt();
  });

  if (btnQuickStop) {
    btnQuickStop.addEventListener('click', async () => {
      await api?.stopTask();
      appendLog('warn', 'Task abort requested.');
    });
  }

  // OTA Live Sync UI
  const otaVersionLabel = document.getElementById('ota-version-label');
  const btnOtaUpdate = document.getElementById('btn-ota-update');
  const otaSyncText = document.getElementById('ota-sync-text');

  async function refreshOtaBadge() {
    if (!api?.getOtaStatus) return;
    try {
      const ota = await api.getOtaStatus();
      if (ota && otaVersionLabel) {
        const shortCommit =
          ota.commitHash && ota.commitHash !== 'initial'
            ? ` · ${String(ota.commitHash).slice(0, 7)}`
            : '';
        otaVersionLabel.textContent = `v${ota.version || '1.0.0'}${shortCommit}`;
      }
    } catch {}
  }

  if (btnOtaUpdate) {
    btnOtaUpdate.addEventListener('click', async () => {
      if (!api?.checkOtaUpdate) return;
      if (otaSyncText) otaSyncText.textContent = 'Syncing...';
      btnOtaUpdate.disabled = true;
      try {
        const res = await api.checkOtaUpdate(false);
        if (res?.updated) {
          if (otaSyncText) otaSyncText.textContent = `Updated (${String(res.commitHash).slice(0, 7)})`;
          appendLog('info', `⚡ Live OTA Update applied (${res.commitHash})`);
        } else {
          if (otaSyncText) otaSyncText.textContent = 'Up to Date';
          appendLog('info', `✓ ${res?.message || 'Already on latest OTA build.'}`);
          setTimeout(() => {
            if (otaSyncText) otaSyncText.textContent = 'Live Sync';
          }, 2500);
        }
        await refreshOtaBadge();
      } catch (err) {
        if (otaSyncText) otaSyncText.textContent = 'Live Sync';
        appendLog('warn', `OTA check error: ${err.message}`);
      } finally {
        btnOtaUpdate.disabled = false;
      }
    });
  }

  if (api?.onOtaUpdated) {
    api.onOtaUpdated((info) => {
      appendLog('info', `⚡ Live OTA Update applied: ${info.commitHash}`);
      refreshOtaBadge();
    });
  }

  // Projects List Interaction (Set Active, Open Folder, Unbind Group)
  if (projectsListContainer) {
    projectsListContainer.addEventListener('click', async (e) => {
      // 1. Open Folder
      const openFolderBtn = e.target.closest('.btn-open-folder');
      if (openFolderBtn && api?.openFolder) {
        const folderPath = openFolderBtn.dataset.path;
        if (!folderPath) return;
        try {
          const res = await api.openFolder(folderPath);
          if (res && !res.success) {
            appendLog('warn', `⚠️ Could not open folder: ${res.error || folderPath}`);
          }
        } catch (err) {
          appendLog('warn', `⚠️ Could not open folder: ${err.message}`);
        }
        return;
      }

      // 3. Unbind Group
      const unbindBtn = e.target.closest('.btn-unbind-group');
      if (unbindBtn && api?.bindGroup) {
        const jid = unbindBtn.dataset.jid;
        const alias = unbindBtn.dataset.alias;
        if (!jid) return;
        unbindBtn.disabled = true;
        unbindBtn.textContent = '...';
        try {
          const res = await api.bindGroup(jid, null);
          if (res?.success) {
            appendLog('info', `🔓 Unbound group ${jid} from ${alias || 'project'}`);
            await syncStatus();
          } else {
            appendLog('error', `Failed to unbind group: ${res?.error || 'Unknown error'}`);
            unbindBtn.disabled = false;
            unbindBtn.textContent = 'Unbind';
          }
        } catch (err) {
          appendLog('error', `Error unbinding group: ${err.message}`);
          unbindBtn.disabled = false;
          unbindBtn.textContent = 'Unbind';
        }
        return;
      }

      // 3b. Toggle Give Permission to All for Group
      const toggleAllowAllBtn = e.target.closest('.btn-toggle-group-allow-all');
      if (toggleAllowAllBtn && api?.toggleGroupAllowAll) {
        const jid = toggleAllowAllBtn.dataset.jid;
        const currentAllowed = toggleAllowAllBtn.dataset.allowed === 'true';
        if (!jid) return;
        toggleAllowAllBtn.disabled = true;
        try {
          const res = await api.toggleGroupAllowAll(jid, !currentAllowed);
          if (res?.success) {
            appendLog(
              'info',
              res.allowed
                ? `👥 Enabled "Give Permission to All" for group ${jid}`
                : `🔒 Disabled "Give Permission to All" (Restricted) for group ${jid}`
            );
            await syncStatus();
          } else {
            appendLog('error', `Failed to toggle group permissions: ${res?.error || 'Unknown error'}`);
            toggleAllowAllBtn.disabled = false;
          }
        } catch (err) {
          appendLog('error', `Error toggling group permissions: ${err.message}`);
          toggleAllowAllBtn.disabled = false;
        }
        return;
      }

      // 4. Remove Project Permission
      const removePermBtn = e.target.closest('.btn-remove-perm');
      if (removePermBtn) {
        const alias = removePermBtn.dataset.alias;
        const phone = removePermBtn.dataset.phone;
        removePermBtn.disabled = true;
        try {
          if (api?.revokeProjectAccess) {
            await api.revokeProjectAccess(alias, phone);
            appendLog('info', `🔒 Removed permission for ${phone} on project "${alias}"`);
            await syncStatus();
          }
        } catch (err) {
          appendLog('error', `Failed to remove permission: ${err.message}`);
        }
        return;
      }
    });

    // Add Phone Number to Project Permissions
    projectsListContainer.addEventListener('submit', async (e) => {
      const form = e.target.closest('.form-add-perm');
      if (!form) return;
      e.preventDefault();
      const alias = form.dataset.alias;
      const input = form.querySelector('.input-perm-phone');
      const val = input?.value?.trim();
      if (!val) return;

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        if (api?.grantProjectAccess) {
          const res = await api.grantProjectAccess(alias, val);
          if (res?.success) {
            appendLog('info', `🔑 Added permission for ${val} on project "${alias}"`);
            if (input) input.value = '';
            await syncStatus();
          } else {
            appendLog('warn', `⚠️ Could not add phone number (already allowed or invalid).`);
          }
        }
      } catch (err) {
        appendLog('error', `Failed to grant permission: ${err.message}`);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Friends Directory Interaction (Add Friend & Remove Friend)
  if (btnAddFriend) {
    btnAddFriend.addEventListener('click', async () => {
      const name = inputFriendName?.value?.trim();
      const github = inputFriendGithub?.value?.trim();
      if (!name || !github) {
        appendLog('warn', '⚠️ Please provide both a Name and GitHub username.');
        return;
      }
      btnAddFriend.disabled = true;
      btnAddFriend.textContent = 'Saving...';
      try {
        const res = await api?.addFriend(name, github);
        if (res?.success) {
          if (inputFriendName) inputFriendName.value = '';
          if (inputFriendGithub) inputFriendGithub.value = '';
          if (res.friends) renderFriendsList(res.friends);
          appendLog('info', `👥 Added friend: ${res.friend.name} (@${res.friend.github})`);
          btnAddFriend.textContent = 'Saved ✓';
          setTimeout(() => {
            btnAddFriend.disabled = false;
            btnAddFriend.innerHTML = '<span class="material-symbols-outlined text-[13px]">add</span><span>Save Friend</span>';
          }, 1500);
        } else {
          appendLog('error', `Failed to add friend: ${res?.error || 'Unknown'}`);
          btnAddFriend.disabled = false;
          btnAddFriend.innerHTML = '<span class="material-symbols-outlined text-[13px]">add</span><span>Save Friend</span>';
        }
      } catch (err) {
        appendLog('error', `Error adding friend: ${err.message}`);
        btnAddFriend.disabled = false;
        btnAddFriend.innerHTML = '<span class="material-symbols-outlined text-[13px]">add</span><span>Save Friend</span>';
      }
    });
  }

  if (friendsListContainer) {
    friendsListContainer.addEventListener('click', async (e) => {
      const removeBtn = e.target.closest('.btn-remove-friend');
      if (!removeBtn) return;
      const id = removeBtn.dataset.id;
      const name = removeBtn.dataset.name;
      if (!id && !name) return;
      removeBtn.disabled = true;
      try {
        const res = await api?.removeFriend(id || name);
        if (res?.success) {
          appendLog('info', `🗑️ Removed friend: ${name || id}`);
          if (res.friends) renderFriendsList(res.friends);
        } else {
          appendLog('warn', `⚠️ Could not remove friend: ${res?.error || 'Not found'}`);
          removeBtn.disabled = false;
        }
      } catch (err) {
        appendLog('error', `Error removing friend: ${err.message}`);
        removeBtn.disabled = false;
      }
    });
  }

  // Initial Sync
  syncStatus();
  refreshOtaBadge();

  // Periodic status check every 3s to guarantee QR and connection updates
  setInterval(() => {
    if (!isConnected) {
      syncStatus();
    }
  }, 3000);
});
