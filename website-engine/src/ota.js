import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INITIAL_ROOT_DIR = path.resolve(__dirname, '..');

const OTA_ENDPOINTS = [
  'https://tryweave.vercel.app/ota',
  'https://raw.githubusercontent.com/darthnihilus01/weave-binaries/main/ota',
];

function getOtaDataDir() {
  if (process.env.WEAVE_DATA_DIR) {
    try {
      fs.mkdirSync(process.env.WEAVE_DATA_DIR, { recursive: true });
      return process.env.WEAVE_DATA_DIR;
    } catch {}
  }
  const userDir = path.join(os.homedir(), '.weave');
  try {
    fs.mkdirSync(userDir, { recursive: true });
  } catch {}
  return userDir;
}

const OTA_CACHE_DIR = path.join(getOtaDataDir(), 'ota-cache');
const CACHED_MANIFEST_PATH = path.join(OTA_CACHE_DIR, 'manifest.json');
const CACHED_BUNDLE_PATH = path.join(OTA_CACHE_DIR, 'bundle.json');

let activeRuntimeDir = INITIAL_ROOT_DIR;
let lastCheckedAt = null;
let updateListeners = [];

export function onOtaUpdate(listener) {
  updateListeners.push(listener);
}

function isDirWritable(dir) {
  if (dir.includes('app.asar')) return false;
  try {
    const testPath = path.join(dir, `.ota_write_test_${process.pid}`);
    fs.writeFileSync(testPath, 'ok');
    fs.unlinkSync(testPath);
    return true;
  } catch {
    return false;
  }
}

function ensureWritableRuntimeDir() {
  if (isDirWritable(INITIAL_ROOT_DIR)) {
    activeRuntimeDir = INITIAL_ROOT_DIR;
    return activeRuntimeDir;
  }

  const runtimeDir = path.join(getOtaDataDir(), 'runtime');
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });

    // Copy base files once if runtimeDir isn't initialized yet
    const runtimePkg = path.join(runtimeDir, 'package.json');
    if (!fs.existsSync(runtimePkg)) {
      for (const rel of ['package.json', '.env.example']) {
        const srcFile = path.join(INITIAL_ROOT_DIR, rel);
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, path.join(runtimeDir, rel));
        }
      }
      for (const folder of ['src', 'electron', 'assets', 'bin']) {
        const srcFolder = path.join(INITIAL_ROOT_DIR, folder);
        const destFolder = path.join(runtimeDir, folder);
        if (fs.existsSync(srcFolder)) {
          fs.cpSync(srcFolder, destFolder, { recursive: true, force: true });
        }
      }
    }

    // Link node_modules from INITIAL_ROOT_DIR so ESM imports resolve seamlessly
    const runtimeNodeModules = path.join(runtimeDir, 'node_modules');
    const sourceNodeModules = path.join(INITIAL_ROOT_DIR, 'node_modules');
    if (!fs.existsSync(runtimeNodeModules) && fs.existsSync(sourceNodeModules)) {
      fs.symlinkSync(
        sourceNodeModules,
        runtimeNodeModules,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    }

    activeRuntimeDir = runtimeDir;
  } catch {
    activeRuntimeDir = INITIAL_ROOT_DIR;
  }
  return activeRuntimeDir;
}

export function getLocalOtaVersion() {
  try {
    if (fs.existsSync(CACHED_MANIFEST_PATH)) {
      return JSON.parse(fs.readFileSync(CACHED_MANIFEST_PATH, 'utf8'));
    }
  } catch {}

  try {
    const bakedPath = path.join(activeRuntimeDir, 'src', 'ota-version.json');
    if (fs.existsSync(bakedPath)) {
      return JSON.parse(fs.readFileSync(bakedPath, 'utf8'));
    }
  } catch {}

  return {
    version: '1.0.0',
    commitHash: 'initial',
    builtAt: 0,
  };
}

export function getOtaStatus() {
  const local = getLocalOtaVersion();
  return {
    version: local.version || '1.0.0',
    commitHash: local.commitHash || 'initial',
    builtAt: local.builtAt || 0,
    lastCheckedAt,
    runtimeDir: activeRuntimeDir,
  };
}

function applyBundleFilesToDir(bundle, targetDir) {
  if (!bundle || typeof bundle.files !== 'object') return 0;
  let count = 0;
  for (const [relPath, content] of Object.entries(bundle.files)) {
    if (relPath.includes('..')) continue;
    const fullPath = path.join(targetDir, relPath);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
      count += 1;
    } catch {}
  }

  // Also write src/ota-version.json
  try {
    const verPath = path.join(targetDir, 'src', 'ota-version.json');
    fs.mkdirSync(path.dirname(verPath), { recursive: true });
    fs.writeFileSync(
      verPath,
      JSON.stringify(
        {
          version: bundle.version || '1.0.0',
          commitHash: bundle.commitHash,
          builtAt: bundle.builtAt,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {}

  return count;
}

async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, {
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteManifest(timeoutMs = 4500) {
  for (const base of OTA_ENDPOINTS) {
    try {
      const manifest = await fetchJsonWithTimeout(`${base}/manifest.json`, timeoutMs);
      if (manifest && manifest.commitHash) {
        return { base, manifest };
      }
    } catch {
      // try fallback endpoint
    }
  }
  return null;
}

/**
 * Checks for and applies any remote OTA bundle update.
 */
export async function checkAndApplyOtaUpdate({ force = false, timeoutMs = 8000 } = {}) {
  if (process.env.DISABLE_OTA === 'true' || process.env.WEAVE_DISABLE_OTA === 'true') {
    return {
      updated: false,
      message: 'OTA updates are disabled by environment configuration.',
    };
  }

  const targetDir = ensureWritableRuntimeDir();
  const local = getLocalOtaVersion();
  lastCheckedAt = new Date().toISOString();

  const remote = await fetchRemoteManifest(timeoutMs);
  if (!remote) {
    return {
      updated: false,
      commitHash: local.commitHash,
      builtAt: local.builtAt,
      message: 'Offline or OTA endpoint unreachable; running cached version.',
    };
  }

  const { base, manifest } = remote;
  const isNewer =
    force ||
    manifest.commitHash !== local.commitHash ||
    (manifest.builtAt && (!local.builtAt || manifest.builtAt > local.builtAt));

  if (!isNewer) {
    return {
      updated: false,
      commitHash: local.commitHash,
      builtAt: local.builtAt,
      message: `Already up to date (${local.commitHash}).`,
    };
  }

  const bundleUrl = manifest.bundleUrl || `${base}/bundle.json`;
  let bundle = null;
  try {
    bundle = await fetchJsonWithTimeout(bundleUrl, timeoutMs);
  } catch {
    bundle = await fetchJsonWithTimeout(`${base}/bundle.json`, timeoutMs);
  }

  if (!bundle || !bundle.files) {
    throw new Error('Downloaded OTA bundle is invalid.');
  }

  // Persist in ~/.weave/ota-cache so portable .exe launches always keep the latest code
  try {
    fs.mkdirSync(OTA_CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHED_BUNDLE_PATH, JSON.stringify(bundle), 'utf8');
    fs.writeFileSync(
      CACHED_MANIFEST_PATH,
      JSON.stringify(
        {
          version: bundle.version || manifest.version || '1.0.0',
          commitHash: bundle.commitHash || manifest.commitHash,
          builtAt: bundle.builtAt || manifest.builtAt,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {}

  const filesUpdated = applyBundleFilesToDir(bundle, targetDir);
  const result = {
    updated: true,
    version: bundle.version || manifest.version || '1.0.0',
    commitHash: bundle.commitHash || manifest.commitHash,
    builtAt: bundle.builtAt || manifest.builtAt,
    filesUpdated,
    runtimeDir: targetDir,
    message: `Updated ${filesUpdated} files to commit ${bundle.commitHash || manifest.commitHash}.`,
  };

  for (const fn of updateListeners) {
    try {
      fn(result);
    } catch {}
  }

  return result;
}

/**
 * Runs on Electron / CLI startup before loading bot modules:
 * 1. Immediately applies any cached OTA bundle from ~/.weave/ota-cache (takes <10ms, works offline & across Portable Temp folders).
 * 2. Checks remote OTA manifest with a short timeout and applies any new push immediately.
 */
export async function syncOtaOnBoot() {
  const isDevWorkspace = fs.existsSync(path.join(INITIAL_ROOT_DIR, '.git'));
  if (process.env.DISABLE_OTA === 'true' || isDevWorkspace) {
    return INITIAL_ROOT_DIR;
  }

  const targetDir = ensureWritableRuntimeDir();

  // Step 1: Apply cached bundle if newer than baked-in version
  try {
    if (fs.existsSync(CACHED_BUNDLE_PATH)) {
      const cachedBundle = JSON.parse(fs.readFileSync(CACHED_BUNDLE_PATH, 'utf8'));
      const bakedPath = path.join(targetDir, 'src', 'ota-version.json');
      let bakedBuiltAt = 0;
      if (fs.existsSync(bakedPath)) {
        try {
          bakedBuiltAt = JSON.parse(fs.readFileSync(bakedPath, 'utf8')).builtAt || 0;
        } catch {}
      }
      if (!bakedBuiltAt || (cachedBundle.builtAt && cachedBundle.builtAt >= bakedBuiltAt)) {
        applyBundleFilesToDir(cachedBundle, targetDir);
      }
    }
  } catch {}

  // Step 2: Check remote OTA server with fast 3.5s timeout
  try {
    await checkAndApplyOtaUpdate({ force: false, timeoutMs: 3500 });
  } catch {
    // Non-fatal on boot
  }

  return targetDir;
}
