const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weaveAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('weave:window-minimize'),
  maximize: () => ipcRenderer.send('weave:window-maximize'),
  close: () => ipcRenderer.send('weave:window-close'),

  // Bot & Google Status
  getStatus: () => ipcRenderer.invoke('weave:get-status'),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('weave:status-update', (_event, data) => callback(data));
  },

  // QR Code stream
  onQrUpdate: (callback) => {
    ipcRenderer.on('weave:qr-update', (_event, data) => callback(data));
  },

  // Pairing code alternative
  requestPairingCode: (phoneNumber) => ipcRenderer.invoke('weave:request-pairing-code', phoneNumber),

  // Google OAuth Flow
  startGoogleLogin: () => ipcRenderer.invoke('weave:google-login'),

  // Config & Handle
  updateHandle: (newHandle) => ipcRenderer.invoke('weave:update-handle', newHandle),
  getProjects: () => ipcRenderer.invoke('weave:get-projects'),
  setActiveProject: (alias) => ipcRenderer.invoke('weave:set-active-project', alias),
  openFolder: (folderPath) => ipcRenderer.invoke('weave:open-folder', folderPath),
  addProject: (alias, folderPath) => ipcRenderer.invoke('weave:add-project', { alias, folderPath }),
  bindGroup: (groupJid, alias) => ipcRenderer.invoke('weave:bind-group', { groupJid, alias }),
  toggleAutopilot: (enabled) => ipcRenderer.invoke('weave:toggle-autopilot', enabled),
  pickMasterDir: () => ipcRenderer.invoke('weave:pick-master-dir'),
  setMasterDir: (dirPath) => ipcRenderer.invoke('weave:set-master-dir', dirPath),

  // Friends & Collaborators Directory
  getFriends: () => ipcRenderer.invoke('weave:get-friends'),
  addFriend: (name, github) => ipcRenderer.invoke('weave:add-friend', { name, github }),
  removeFriend: (nameOrId) => ipcRenderer.invoke('weave:remove-friend', nameOrId),

  // Project Permissions
  grantProjectAccess: (projectAlias, phoneOrGroup, maybePhone) =>
    ipcRenderer.invoke('weave:grant-project-access', {
      projectAlias,
      phoneNumber: maybePhone || phoneOrGroup,
    }),
  revokeProjectAccess: (projectAlias, phoneOrGroup, maybePhone) =>
    ipcRenderer.invoke('weave:revoke-project-access', {
      projectAlias,
      phoneNumber: maybePhone || phoneOrGroup,
    }),
  toggleGroupAllowAll: (groupJid, allowed) =>
    ipcRenderer.invoke('weave:toggle-group-allow-all', { groupJid, allowed }),

  // Logs stream
  onLog: (callback) => {
    ipcRenderer.on('weave:log', (_event, log) => callback(log));
  },

  // Task execution
  runPrompt: (prompt, projectAlias) => ipcRenderer.invoke('weave:run-prompt', { prompt, projectAlias }),
  stopTask: () => ipcRenderer.invoke('weave:stop-task'),

  // Live OTA Updates
  getOtaStatus: () => ipcRenderer.invoke('weave:ota-status'),
  checkOtaUpdate: (force = false) => ipcRenderer.invoke('weave:ota-update', force),
  onOtaUpdated: (callback) => {
    ipcRenderer.on('weave:ota-updated', (_event, data) => callback(data));
  },

  // Live State & Projects Update stream
  onProjectsUpdate: (callback) => {
    ipcRenderer.on('weave:projects-update', (_event, data) => callback(data));
  },
});
