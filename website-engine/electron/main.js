import { app, BrowserWindow, ipcMain, shell, screen, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  syncOtaOnBoot,
  checkAndApplyOtaUpdate,
  getOtaStatus,
  onOtaUpdate,
} from '../src/ota.js';

if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
}

// Ensure single instance lock: prevent two Electron / Weave instances from fighting over the same WhatsApp session
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.warn('⚠️ Another instance of Weave is already running. Quitting secondary instance.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let currentQrData = null;
let activeRuntimeDir = path.resolve(__dirname, '..');

// Dynamically loaded runtime modules (can be refreshed via OTA)
let botMod = null;
let configMod = null;
let authMod = null;
let agentMod = null;

async function loadRuntimeModules(runtimeDir, cacheBust = '') {
  const suffix = cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : '';
  const importFromRuntime = (relPath) =>
    import(`${pathToFileURL(path.join(runtimeDir, relPath)).href}${suffix}`);

  configMod = await importFromRuntime('src/config.js');
  authMod = await importFromRuntime('src/auth.js');
  agentMod = await importFromRuntime('src/agent.js');
  if (!botMod) {
    botMod = await importFromRuntime('src/bot.js');
  }
}

function createWindow(runtimeDir) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const electronDir = path.join(runtimeDir, 'electron');

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#09090b',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: fs.existsSync(path.join(electronDir, 'preload.cjs'))
        ? path.join(electronDir, 'preload.cjs')
        : fs.existsSync(path.join(__dirname, 'preload.cjs'))
        ? path.join(__dirname, 'preload.cjs')
        : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.maximize();
  const rendererHtml = path.join(electronDir, 'renderer', 'index.html');
  mainWindow.loadFile(
    fs.existsSync(rendererHtml)
      ? rendererHtml
      : path.join(__dirname, 'renderer', 'index.html')
  );

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const botStatus = botMod?.getBotStatus?.();
    if (botStatus?.connected || botStatus?.registered) {
      currentQrData = null;
      return;
    }
    if (currentQrData) {
      mainWindow.webContents.send('weave:qr-update', currentQrData);
    }
  });

  try {
    const rendererDir = path.join(electronDir, 'renderer');
    fs.watch(rendererDir, { recursive: true }, (_eventType, filename) => {
      if (mainWindow && !mainWindow.isDestroyed() && filename) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    });
  } catch {}

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// Redirect console logs to renderer for live terminal stream
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function formatLogLine(level, ...args) {
  const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  sendToRenderer('weave:log', { level, text: line, time: new Date().toLocaleTimeString() });
}

console.log = (...args) => {
  originalLog(...args);
  formatLogLine('info', ...args);
};

console.warn = (...args) => {
  originalWarn(...args);
  formatLogLine('warn', ...args);
};

console.error = (...args) => {
  originalError(...args);
  formatLogLine('error', ...args);
};

// --- IPC HANDLERS ---

ipcMain.on('weave:window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('weave:window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('weave:window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('weave:ota-status', async () => {
  return getOtaStatus();
});

ipcMain.handle('weave:ota-update', async (_event, force = false) => {
  try {
    const res = await checkAndApplyOtaUpdate({ force: Boolean(force) });
    if (res.updated) {
      await loadRuntimeModules(res.runtimeDir || activeRuntimeDir, `${res.commitHash}-${Date.now()}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    }
    return { success: true, ...res };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:get-status', async () => {
  const botStatus = botMod.getBotStatus();
  const state = configMod.loadProjectsState();

  const qrToSend = (botStatus.connected || botStatus.registered) ? null : currentQrData;

  return {
    bot: {
      connected: botStatus.connected,
      user: botStatus.user,
      registered: botStatus.registered,
      activeTask: botStatus.activeTask,
      triggerPrefix: configMod.CONFIG.triggerPrefix,
      qrData: qrToSend,
    },
    google: {
      authenticated: authMod.googleAuth.isAuthenticated(),
      email: authMod.googleAuth.getUserEmail(),
    },
    ota: getOtaStatus(),
    projects: state.projects,
    activeProject: state.activeProject,
    masterDir: state.masterDir || '',
    groupBindings: state.groupBindings,
    initializedGroups: configMod.getAllInitializedGroups(),
    friends: state.friends || [],
    projectAccess: state.projectAccess || {},
    groupNames: state.groupNames || {},
    groupAllowAll: state.groupAllowAll || {},
  };
});

ipcMain.handle('weave:pick-master-dir', async () => {
  if (!mainWindow) return { canceled: true };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Master Projects Directory',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
    return { canceled: true };
  }
  const chosenPath = res.filePaths[0];
  const state = configMod.loadProjectsState();
  state.masterDir = chosenPath;
  configMod.saveProjectsState(state);
  const refreshed = configMod.loadProjectsState();
  return { success: true, masterDir: chosenPath, projects: refreshed.projects };
});

ipcMain.handle('weave:set-master-dir', async (_event, dirPath) => {
  const cleanPath = (dirPath || '').trim();
  const state = configMod.loadProjectsState();
  if (!cleanPath) {
    state.masterDir = '';
    configMod.saveProjectsState(state);
    const refreshed = configMod.loadProjectsState();
    return { success: true, masterDir: '', projects: refreshed.projects };
  }
  const resolved = cleanPath.startsWith('~')
    ? path.join(path.resolve(process.env.HOME || ''), cleanPath.slice(1))
    : path.resolve(cleanPath);
  if (!fs.existsSync(resolved)) {
    return { success: false, error: 'Directory does not exist on disk.' };
  }
  state.masterDir = resolved;
  configMod.saveProjectsState(state);
  const refreshed = configMod.loadProjectsState();
  return { success: true, masterDir: resolved, projects: refreshed.projects };
});

ipcMain.handle('weave:google-login', async () => {
  try {
    const tokens = await authMod.googleAuth.startLoginFlow((authUrl) => {
      shell.openExternal(authUrl);
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }

    return {
      success: true,
      email: tokens.email,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
});

ipcMain.handle('weave:request-pairing-code', async (_event, phoneNumber) => {
  try {
    const code = await botMod.requestPairingCode(phoneNumber);
    return { success: true, code };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:update-handle', async (_event, newHandle) => {
  return configMod.updateTriggerPrefix(newHandle);
});

ipcMain.handle('weave:get-projects', async () => {
  return configMod.loadProjectsState();
});

ipcMain.handle('weave:add-project', async (_event, { alias, folderPath }) => {
  const state = configMod.loadProjectsState();
  const cleanAlias = (alias || '').trim().toLowerCase();
  const resolvedPath = path.resolve(folderPath);

  if (!cleanAlias || !fs.existsSync(resolvedPath)) {
    return { success: false, error: 'Invalid alias or folder does not exist' };
  }

  state.projects[cleanAlias] = resolvedPath;
  configMod.saveProjectsState(state);
  return { success: true, projects: state.projects };
});

ipcMain.handle('weave:set-active-project', async (_event, alias) => {
  const cleanAlias = (alias || '').trim().toLowerCase();
  const state = configMod.loadProjectsState();
  const matchedKey = Object.keys(state.projects || {}).find(
    (k) => k.toLowerCase() === cleanAlias
  );
  if (!matchedKey) {
    return { success: false, error: `Project "${alias}" not found.` };
  }
  state.activeProject = matchedKey;
  configMod.saveProjectsState(state);
  return { success: true, activeProject: matchedKey };
});

ipcMain.handle('weave:open-folder', async (_event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    try {
      await shell.openPath(folderPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Directory does not exist.' };
});

ipcMain.handle('weave:bind-group', async (_event, { groupJid, alias }) => {
  const state = configMod.loadProjectsState();
  if (alias) {
    const cleanAlias = alias.trim().toLowerCase();
    const matched = Object.keys(state.projects || {}).find(
      (k) => k.toLowerCase() === cleanAlias
    );
    if (matched) {
      state.groupBindings[groupJid] = matched;
    }
  } else {
    delete state.groupBindings[groupJid];
  }
  configMod.saveProjectsState(state);
  return { success: true, groupBindings: state.groupBindings };
});

ipcMain.handle('weave:toggle-autopilot', async () => {
  return { success: true, nativeAutonomous: true };
});

ipcMain.handle('weave:reset-state', async (_event, { preserveMasterDir = true } = {}) => {
  try {
    const newState = configMod.resetAllState({ preserveMasterDir });
    return { success: true, state: newState };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:get-friends', async () => {
  const friends = configMod.getFriends();
  return { success: true, friends };
});

ipcMain.handle('weave:add-friend', async (_event, { name, github }) => {
  try {
    const friend = configMod.addFriend(name, github);
    return { success: true, friend, friends: configMod.getFriends() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:remove-friend', async (_event, nameOrId) => {
  try {
    const removed = configMod.removeFriend(nameOrId);
    return { success: removed, friends: configMod.getFriends() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:grant-project-access', async (_event, payload) => {
  try {
    const projectAlias = payload?.projectAlias;
    const phone = payload?.phoneNumber || payload?.userIdentifier;
    const ok = configMod.grantProjectAccess(projectAlias, phone);
    return { success: ok, accessList: configMod.getProjectAccess(projectAlias) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:revoke-project-access', async (_event, payload) => {
  try {
    const projectAlias = payload?.projectAlias;
    const phone = payload?.phoneNumber || payload?.userIdentifier;
    const ok = configMod.revokeProjectAccess(projectAlias, phone);
    return { success: ok, accessList: configMod.getProjectAccess(projectAlias) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:toggle-group-allow-all', async (_event, { groupJid, allowed }) => {
  try {
    const state = configMod.loadProjectsState();
    const nextVal = configMod.setGroupAllowAll(groupJid, allowed);
    return { success: true, groupAllowAll: state.groupAllowAll, allowed: nextVal };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:run-prompt', async (_event, { prompt, projectAlias }) => {
  const state = configMod.loadProjectsState();
  const targetAlias = projectAlias || state.activeProject || 'demo';
  const targetDir = state.projects[targetAlias] || configMod.CONFIG.defaultProjectDir;

  try {
    const result = await agentMod.runAntigravityTask({
      projectAlias: targetAlias,
      projectDir: targetDir,
      taskPrompt: prompt,
    });
    return { success: true, result };
  } catch (err) {
    if (err.cancelled) {
      console.warn(`🛑 Task was cancelled by user: "${prompt}"`);
      return { success: false, cancelled: true, error: 'Task was cancelled by user.' };
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:stop-task', async () => {
  const stopped = agentMod.stopActiveTask();
  if (stopped) {
    console.warn(
      `🛑 Stopped active task on "${stopped.projectAlias || 'default'}": ${stopped.taskPrompt || ''}`
    );
  } else {
    console.log('ℹ️ No active task is currently running.');
  }
  sendToRenderer('weave:status-update', {
    status: 'task_stopped',
    stopped,
    activeTask: null,
  });
  return { success: true, stopped };
});

// Listen for OTA updates (triggered via WhatsApp `/update` or background timer)
onOtaUpdate(async (updateInfo) => {
  try {
    await loadRuntimeModules(
      updateInfo.runtimeDir || activeRuntimeDir,
      `${updateInfo.commitHash}-${Date.now()}`
    );
    sendToRenderer('weave:ota-updated', updateInfo);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  } catch (err) {
    console.warn('OTA hot-reload warning:', err.message);
  }
});

// App Lifecycle
app.whenReady().then(async () => {
  // 1. Sync OTA bundle before loading app modules
  activeRuntimeDir = await syncOtaOnBoot();
  await loadRuntimeModules(activeRuntimeDir);

  // 2. Wire bot events
  botMod.botEvents.on('qr', (data) => {
    currentQrData = data;
    sendToRenderer('weave:qr-update', data);
  });

  botMod.botEvents.on('connection', (data) => {
    if (data.status === 'connected') {
      currentQrData = null;
    }
    sendToRenderer('weave:status-update', data);
  });

  if (configMod?.configEvents) {
    configMod.configEvents.on('projects-updated', (state) => {
      sendToRenderer('weave:projects-update', state);
    });
  }

  // 3. Create window from active runtime directory
  createWindow(activeRuntimeDir);

  // 4. Start WhatsApp bot service
  botMod.startWhatsAppBot().catch((err) => {
    console.error('WhatsApp Bot startup error:', err.message);
  });

  // 5. Poll for live OTA updates every 3 minutes in the background
  setInterval(() => {
    checkAndApplyOtaUpdate({ force: false }).catch(() => {});
  }, 180000).unref?.();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(activeRuntimeDir);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
