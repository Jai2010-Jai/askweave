import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { ROOT_DIR, CONFIG, loadProjectsState, saveProjectsState } from './config.js';

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const execFileAsync = promisify(execFile);

/**
 * Probes whether a local port is actively serving HTTP requests.
 */
async function isLocalPortOpen(port, timeoutMs = 400) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://localhost:${port}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WhatsApp-Agent-QA' },
    });
    clearTimeout(timeout);
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Discovers the live deployment URL (Vercel, GitHub Pages, Netlify) or dev server
 * for a project directory by inspecting cached state, GitHub repo homepage, package.json, or .env.
 */
export async function getProjectDeploymentUrl(projectDir, projectAlias = null) {
  if (!projectDir && !projectAlias) return null;

  const state = loadProjectsState();

  // Find alias if not provided
  let alias = projectAlias;
  if (!alias && projectDir) {
    for (const [key, dir] of Object.entries(state.projects || {})) {
      if (path.resolve(dir) === path.resolve(projectDir)) {
        alias = key;
        break;
      }
    }
  }

  // 1. Check cached deployment URL in state
  if (alias && state.deploymentUrls?.[alias]) {
    return state.deploymentUrls[alias];
  }

  // Known hardcoded seed deployment URLs
  const SEED_URLS = {
    wisewallets: 'https://wisewallets.vercel.app',
    rocktoberfest: 'https://rocktober-fest.vercel.app',
    gi_heritage_hub: 'https://gi-heritage-hub.vercel.app',
    tkc: 'https://tkc-raft.vercel.app',
    tkctrial: 'https://tkctrial.vercel.app',
    ascendant: 'https://ascendant-delta.vercel.app',
    personalisedmemory: 'https://latticeai-in.vercel.app/',
    lattice: 'https://latticeai-in.vercel.app/',
    latticemvp: 'https://latticeai-in.vercel.app/',
  };
  if (alias && SEED_URLS[alias]) {
    state.deploymentUrls = state.deploymentUrls || {};
    state.deploymentUrls[alias] = SEED_URLS[alias];
    try {
      saveProjectsState(state);
    } catch {}
    return SEED_URLS[alias];
  }

  if (!projectDir || !fs.existsSync(projectDir)) return null;

  // 2. Check git remote and GitHub API repo homepage (e.g. Vercel deployment link)
  try {
    const gitConfigFile = path.join(projectDir, '.git', 'config');
    if (fs.existsSync(gitConfigFile)) {
      const gitConfig = fs.readFileSync(gitConfigFile, 'utf8');
      const originMatch = gitConfig.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git|\s|$)/);
      if (originMatch) {
        const owner = originMatch[1];
        const repo = originMatch[2];
        const token = CONFIG.githubToken || process.env.GITHUB_TOKEN;
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: {
            'User-Agent': 'WhatsApp-Agent',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (res.ok) {
          const repoData = await res.json();
          if (repoData.homepage && /^https?:\/\//i.test(repoData.homepage.trim())) {
            const foundUrl = repoData.homepage.trim();
            if (alias) {
              state.deploymentUrls = state.deploymentUrls || {};
              state.deploymentUrls[alias] = foundUrl;
              try {
                saveProjectsState(state);
              } catch {}
            }
            return foundUrl;
          }
        }
      }
    }
  } catch (err) {
    // ignore git fetch errors
  }

  // 3. Check package.json for homepage or vercel config
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.homepage && /^https?:\/\//i.test(pkg.homepage.trim())) {
        const foundUrl = pkg.homepage.trim();
        if (alias) {
          state.deploymentUrls = state.deploymentUrls || {};
          state.deploymentUrls[alias] = foundUrl;
          try {
            saveProjectsState(state);
          } catch {}
        }
        return foundUrl;
      }
    }
  } catch {}

  // 4. Check README.md for vercel.app or netlify.app links
  try {
    const readmePath = path.join(projectDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, 'utf8');
      const vercelMatch = readme.match(/https?:\/\/[A-Za-z0-9_.-]+\.(?:vercel\.app|netlify\.app|pages\.dev|github\.io)[^\s)]*/i);
      if (vercelMatch) {
        const foundUrl = vercelMatch[0];
        if (alias) {
          state.deploymentUrls = state.deploymentUrls || {};
          state.deploymentUrls[alias] = foundUrl;
          try {
            saveProjectsState(state);
          } catch {}
        }
        return foundUrl;
      }
    }
  } catch {}

  // 5. Probe common local dev server ports (e.g. Vite 5173, Next/CRA 3000, 8080)
  for (const port of [5173, 3000, 8080, 4321]) {
    if (await isLocalPortOpen(port)) {
      return `http://localhost:${port}`;
    }
  }

  return null;
}

/**
 * Normalizes input URL or port into a valid HTTP/HTTPS URL.
 * Handles:
 * - "3000" -> "http://localhost:3000"
 * - ":5173" -> "http://localhost:5173"
 * - "localhost:8080" -> "http://localhost:8080"
 * - "example.com" -> "https://example.com"
 * - "http://localhost:3000" -> "http://localhost:3000"
 */
export function normalizeTargetUrl(input) {
  let target = (input || '').trim();
  if (!target) return 'http://localhost:3000';

  // Port number only
  if (/^:?\d{2,5}$/.test(target)) {
    const port = target.replace(/^:/, '');
    return `http://localhost:${port}`;
  }

  // Localhost with port
  if (/^localhost:\d+/.test(target)) {
    return `http://${target}`;
  }

  // Already has protocol (http://, https://, file://)
  if (/^(?:https?|file):\/\//i.test(target)) {
    return target;
  }

  // Local filesystem path
  if (target.startsWith('/') && fs.existsSync(target)) {
    return `file://${target}`;
  }

  // Default to https for remote domains, http for localhost
  if (target.startsWith('localhost') || target.startsWith('127.0.0.1')) {
    return `http://${target}`;
  }

  return `https://${target}`;
}

/**
 * Captures a website screenshot using headless Firefox.
 *
 * @param {string} url - Target URL to capture
 * @param {object} options
 * @param {number} [options.width=1280] - Viewport width
 * @param {number} [options.height=800] - Viewport height
 * @param {string} [options.outputPath] - Optional custom output path
 * @param {number} [options.timeoutMs=25000] - Process timeout
 * @returns {Promise<{ filePath: string, url: string, width: number, height: number }>}
 */
export async function captureWebScreenshot(url, options = {}) {
  const targetUrl = normalizeTargetUrl(url);
  const width = Number(options.width) || (options.mobile ? 390 : 1280);
  const height = Number(options.height) || (options.mobile ? 844 : 800);
  const timeoutMs = Number(options.timeoutMs) || 25000;

  const outDir = options.outputPath
    ? path.dirname(options.outputPath)
    : path.join(os.tmpdir(), 'whatsapp-qa-screenshots');

  fs.mkdirSync(outDir, { recursive: true });

  const outputFile =
    options.outputPath ||
    path.join(
      outDir,
      `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`
    );

  try {
    await execFileAsync(
      'firefox',
      [
        '--headless',
        `--window-size=${width},${height}`,
        `--screenshot=${outputFile}`,
        targetUrl,
      ],
      { timeout: timeoutMs }
    );

    if (!fs.existsSync(outputFile)) {
      throw new Error(`Screenshot file was not generated for ${targetUrl}`);
    }

    return {
      filePath: outputFile,
      url: targetUrl,
      width,
      height,
    };
  } catch (err) {
    if (fs.existsSync(outputFile)) {
      try {
        fs.unlinkSync(outputFile);
      } catch {}
    }
    throw new Error(
      `Failed to capture screenshot of ${targetUrl}: ${err.message}`
    );
  }
}
