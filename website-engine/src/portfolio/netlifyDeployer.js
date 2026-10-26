import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

const execFileAsync = util.promisify(execFile);

/**
 * Retrieves an existing Netlify site or creates a new one under the user's account.
 * Ensures the site has public access (sso_login disabled).
 *
 * @param {string} token - Netlify Personal Access Token
 * @param {string} preferredName - Desired site name prefix
 * @returns {Promise<{ siteId: string, siteUrl: string, siteName: string } | null>}
 */
export async function getOrCreateNetlifySite(token, preferredName = 'portfolio-website') {
  if (!token) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Check existing sites for matching name
    const listRes = await fetch('https://api.netlify.com/api/v1/sites', { headers });
    if (listRes.ok) {
      const sites = await listRes.json();
      if (Array.isArray(sites) && sites.length > 0) {
        // Find existing site matching name or pick the most recent one
        const existing = sites.find((s) => s.name === preferredName) || sites[0];
        if (existing) {
          if (existing.sso_login) {
            await fetch(`https://api.netlify.com/api/v1/sites/${existing.id}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ sso_login: false }),
            }).catch(() => {});
          }
          return {
            siteId: existing.id,
            siteUrl: existing.ssl_url || existing.url,
            siteName: existing.name,
          };
        }
      }
    }

    // 2. Resolve account team slug
    let accountSlug = null;
    const accountsRes = await fetch('https://api.netlify.com/api/v1/accounts', { headers });
    if (accountsRes.ok) {
      const accounts = await accountsRes.json();
      if (Array.isArray(accounts) && accounts.length > 0) {
        accountSlug = accounts[0].slug;
      }
    }

    // 3. Create a new site under the resolved account
    const safeName = `${preferredName}-${Date.now().toString(36)}`.slice(0, 36);
    const endpoint = accountSlug
      ? `https://api.netlify.com/api/v1/${accountSlug}/sites`
      : 'https://api.netlify.com/api/v1/sites';

    const createRes = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: safeName,
        sso_login: false,
      }),
    });

    if (createRes.ok) {
      const newSite = await createRes.json();
      if (newSite.sso_login) {
        await fetch(`https://api.netlify.com/api/v1/sites/${newSite.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sso_login: false }),
        }).catch(() => {});
      }
      return {
        siteId: newSite.id,
        siteUrl: newSite.ssl_url || newSite.url,
        siteName: newSite.name,
      };
    }
  } catch (err) {
    console.warn('[NetlifyDeployer] Site resolution warning:', err.message);
  }

  return null;
}

/**
 * Deploys a local directory using isolated Netlify Drop (anonymous, zero credentials required).
 * Uses an isolated config directory to avoid inheriting credit-exhausted user accounts.
 *
 * @param {string} resolvedDir - Absolute path to folder containing index.html
 * @param {object} options
 * @returns {Promise<{ success: boolean, siteUrl: string|null, password: string|null, claimUrl: string|null, siteId: string|null, rawOutput: string, formattedMessage: string }>}
 */
export async function deployAnonymously(resolvedDir, { title = 'portfolio', timeoutMs = 45000 } = {}) {
  const anonHome = path.join(os.tmpdir(), 'weave-netlify-drop');
  try {
    fs.mkdirSync(anonHome, { recursive: true });
  } catch {}

  const cleanEnv = { ...process.env, HOME: anonHome, NETLIFY_CONFIG_DIR: anonHome };
  delete cleanEnv.NETLIFY_AUTH_TOKEN;

  const args = ['deploy', '--dir', resolvedDir, '--prod', '--no-build', '--allow-anonymous'];

  try {
    const { stdout, stderr } = await execFileAsync('netlify', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: cleanEnv,
    });

    const rawOutput = (stdout || '') + '\n' + (stderr || '');

    const siteUrl =
      rawOutput.match(/Site\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i)?.[1]?.trim() ||
      rawOutput.match(/Website\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i)?.[1]?.trim() ||
      rawOutput.match(/(https?:\/\/[A-Za-z0-9_-]+\.netlify\.app)/i)?.[1]?.trim() ||
      null;

    const pwdMatch = rawOutput.match(/Password:\s+([^\s\r\n│]+)/i);
    const password = pwdMatch ? pwdMatch[1].trim() : null;

    const claimMatch = rawOutput.match(/https:\/\/app\.netlify\.com\/drop\/[^\s\r\n]+/i);
    const claimUrl = claimMatch ? claimMatch[0].trim() : null;

    const siteIdMatch = rawOutput.match(/--site\s+([a-f0-9-]+)/i);
    const siteId = siteIdMatch ? siteIdMatch[1].trim() : null;

    if (!siteUrl) {
      console.warn('[NetlifyDeployer] Anonymous deploy completed but URL could not be parsed:', rawOutput.slice(0, 300));
      return {
        success: false,
        siteUrl: null,
        password: null,
        claimUrl: null,
        siteId: null,
        rawOutput,
        formattedMessage: `Website built locally at ${resolvedDir}.`,
      };
    }

    const formattedMessage = password
      ? `The ${title} website has been deployed to Netlify: ${siteUrl} (Preview password: \`${password}\`).`
      : `The ${title} website is live on Netlify: ${siteUrl}`;

    return {
      success: true,
      siteUrl,
      password,
      claimUrl,
      siteId,
      rawOutput,
      formattedMessage,
    };
  } catch (err) {
    const errorText = err.message || '';
    if (errorText.includes('daily limit for anonymous deploys')) {
      console.warn('[NetlifyDeployer] Daily limit for anonymous deploys reached on this IP.');
      return {
        success: false,
        isRateLimited: true,
        siteUrl: null,
        password: null,
        claimUrl: null,
        siteId: null,
        rawOutput: errorText,
        formattedMessage: `The ${title} website is built locally at ${resolvedDir}. Netlify anonymous deploy limit was reached for this IP.`,
      };
    }

    console.warn('[NetlifyDeployer] Anonymous deploy notice:', errorText);
    return {
      success: false,
      siteUrl: null,
      password: null,
      claimUrl: null,
      siteId: null,
      rawOutput: errorText,
      formattedMessage: `Website built locally at ${resolvedDir}.`,
    };
  }
}

/**
 * Deploys a local directory to Netlify.
 * Supports:
 * 1. Authenticated deploy using NETLIFY_AUTH_TOKEN (unlimited)
 * 2. Automatic fallback to isolated anonymous Netlify Drop if token has credit limit or forbidden errors
 * 3. Graceful failure without throwing unhandled exceptions
 *
 * @param {string} projectDir - Directory containing index.html and static assets
 * @param {object} options
 * @param {string} [options.title="portfolio"]
 * @param {string} [options.siteId] - Optional site ID to update an existing deploy
 * @param {number} [options.timeoutMs=45000]
 */
export async function deployToNetlifyDrop(projectDir, { title = 'portfolio', siteId = null, timeoutMs = 45000 } = {}) {
  const resolvedDir = path.resolve(projectDir);
  if (!fs.existsSync(resolvedDir)) {
    console.warn(`[NetlifyDeployer] Directory does not exist: ${resolvedDir}`);
    return {
      success: false,
      siteUrl: null,
      password: null,
      claimUrl: null,
      siteId: null,
      rawOutput: `Directory does not exist: ${resolvedDir}`,
      formattedMessage: `Directory does not exist: ${resolvedDir}`,
    };
  }

  const indexPath = path.join(resolvedDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.warn(`[NetlifyDeployer] index.html not found in deploy directory: ${resolvedDir}`);
    return {
      success: false,
      siteUrl: null,
      password: null,
      claimUrl: null,
      siteId: null,
      rawOutput: `index.html not found in deploy directory: ${resolvedDir}`,
      formattedMessage: `index.html not found in deploy directory: ${resolvedDir}`,
    };
  }

  const token = process.env.NETLIFY_AUTH_TOKEN || '';

  // 1. Try authenticated deployment if token is provided
  if (token) {
    try {
      let activeSiteId = siteId;
      let preResolvedSiteUrl = null;

      if (!activeSiteId) {
        const siteInfo = await getOrCreateNetlifySite(token, `weave-${title.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`);
        if (siteInfo?.siteId) {
          activeSiteId = siteInfo.siteId;
          preResolvedSiteUrl = siteInfo.siteUrl;
        }
      }

      const args = ['deploy', '--dir', resolvedDir, '--prod', '--no-build', '--auth', token, '--json'];
      if (activeSiteId) {
        args.push('--site', activeSiteId);
      }

      const { stdout, stderr } = await execFileAsync('netlify', args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          NETLIFY_AUTH_TOKEN: token,
        },
      });

      const rawOutput = (stdout || '') + '\n' + (stderr || '');
      let parsedJson = null;
      try {
        if (stdout && stdout.trim().startsWith('{')) {
          parsedJson = JSON.parse(stdout.trim());
        }
      } catch {
        parsedJson = null;
      }

      const siteUrl =
        parsedJson?.url ||
        parsedJson?.ssl_url ||
        preResolvedSiteUrl ||
        rawOutput.match(/Site\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i)?.[1]?.trim() ||
        rawOutput.match(/Website\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i)?.[1]?.trim() ||
        rawOutput.match(/(https?:\/\/[A-Za-z0-9_-]+\.netlify\.app)/i)?.[1]?.trim() ||
        null;

      const pwdMatch = rawOutput.match(/Password:\s+([^\s\r\n│]+)/i);
      const password = pwdMatch ? pwdMatch[1].trim() : null;
      const claimMatch = rawOutput.match(/https:\/\/app\.netlify\.com\/drop\/[^\s\r\n]+/i);
      const claimUrl = claimMatch ? claimMatch[0].trim() : null;
      const extractedSiteId = parsedJson?.site_id || activeSiteId;

      if (siteUrl) {
        return {
          success: true,
          siteUrl,
          password,
          claimUrl,
          siteId: extractedSiteId,
          rawOutput,
          formattedMessage: `The ${title} website is live on Netlify: ${siteUrl}`,
        };
      }
    } catch (authErr) {
      const authErrText = authErr.message || '';
      console.warn(`[NetlifyDeployer] Authenticated deploy failed (${authErrText.slice(0, 150)}). Automatically falling back to anonymous Netlify Drop...`);
      // Fall through to anonymous deploy
    }
  }

  // 2. Fallback to isolated anonymous Netlify Drop
  return await deployAnonymously(resolvedDir, { title, timeoutMs });
}

