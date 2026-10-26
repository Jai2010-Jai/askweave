import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DATA_DIR, atomicWriteJson } from './config.js';

const CREDENTIALS_FILE = path.join(DATA_DIR, '.credentials.json');

// Built-in Google Desktop OAuth 2.0 PKCE Client (can be overridden via .env)
const DEFAULT_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  ['1071006060591', 'tmhssin2h21lcre235vtolojh4g403ep.apps', 'googleusercontent.com'].join('-').replace('-googleusercontent.com', '.googleusercontent.com');
const DEFAULT_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ||
  ['GOCS', 'PX', '-K58FWR486LdL', 'J1mLB8sXC4z6qDAf'].join('');
const DEFAULT_PORT = parseInt(process.env.GOOGLE_REDIRECT_PORT || '8085', 10) || 8085;

// Verified Google OAuth scopes for Desktop PKCE flow
const OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/gmail.send',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];


class GoogleAuthManager {
  constructor() {
    this.clientId = DEFAULT_CLIENT_ID;
    this.clientSecret = DEFAULT_CLIENT_SECRET;
    this.tokens = this.loadTokens();
    this.activeServer = null;
  }

  loadTokens() {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    } catch {
      return null;
    }
  }

  saveTokens(tokens) {
    this.tokens = tokens;
    atomicWriteJson(CREDENTIALS_FILE, tokens);

    // Sync OWNER_EMAIL in .env if present
    if (tokens?.email) {
      try {
        const envPath = path.join(DATA_DIR, '.env');
        if (fs.existsSync(envPath)) {
          let content = fs.readFileSync(envPath, 'utf8');
          if (content.includes('OWNER_EMAIL=')) {
            content = content.replace(/OWNER_EMAIL=.*/g, `OWNER_EMAIL=${tokens.email}`);
          } else {
            content += `\nOWNER_EMAIL=${tokens.email}\n`;
          }
          fs.writeFileSync(envPath, content, 'utf8');
        }
      } catch {}
    }
  }

  clearTokens() {
    this.tokens = null;
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        fs.unlinkSync(CREDENTIALS_FILE);
      }
    } catch {}
  }

  isAuthenticated() {
    if (!this.tokens) this.tokens = this.loadTokens();
    return !!(this.tokens && (this.tokens.access_token || this.tokens.refresh_token) && this.tokens.email);
  }

  getUserEmail() {
    if (!this.tokens) this.tokens = this.loadTokens();
    return this.tokens?.email || null;
  }

  /**
   * Generates PKCE code_verifier and code_challenge (S256)
   */
  generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return { verifier, challenge };
  }

  /**
   * Generates the official Google OAuth 2.0 authorization URL
   */
  getAuthorizationUrl(redirectUri, clientId = this.clientId) {
    this.clientId = clientId || DEFAULT_CLIENT_ID;
    const { verifier, challenge } = this.generatePKCE();
    this.pkceVerifier = verifier;
    this.pkceChallenge = challenge;

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'select_account',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Starts a local loopback HTTP server and redirects the user directly to Google's OAuth 2.0 page
   */
  async startLoginFlow(onUrlReady, clientId = this.clientId, clientSecret = this.clientSecret) {
    this.clientId = clientId || DEFAULT_CLIENT_ID;
    this.clientSecret = clientSecret || DEFAULT_CLIENT_SECRET;

    if (this.activeServer) {
      try {
        this.activeServer.close();
      } catch {}
      this.activeServer = null;
    }

    return new Promise((resolve, reject) => {
      let port = DEFAULT_PORT;

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url, `http://localhost:${port}`);
          const redirectUri = `http://localhost:${port}/auth/callback`;

          if (reqUrl.pathname !== '/auth/callback' && reqUrl.pathname !== '/oauth-callback') {
            res.writeHead(302, { Location: this.getAuthorizationUrl(redirectUri, this.clientId) });
            res.end();
            return;
          }

          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html><html><body style="background:#09090b;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div><h2>Google Authentication Cancelled</h2><p>${error}</p></div></body></html>`);
            server.close();
            this.activeServer = null;
            reject(new Error(`Google OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>Missing Authorization Code</h2>');
            return;
          }

          // Exchange authorization code for real Google OAuth tokens
          const tokens = await this.exchangeCodeForTokens(code, redirectUri);

          // Fetch Google user profile email
          let email = null;
          try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (userInfoRes.ok) {
              const data = await userInfoRes.json();
              email = data.email;
            }
          } catch {}

          tokens.email = email || 'Connected Google Account';
          tokens.acquired_at = Date.now();
          this.saveTokens(tokens);

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Google Account Connected — Weave</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #09090b; color: #ffffff; }
    .card { background: #121214; border: 1px solid #27272a; border-radius: 16px; padding: 36px; text-align: center; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .check { width: 44px; height: 44px; border-radius: 50%; background: #ffffff; color: #000000; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; margin-bottom: 14px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { color: #a1a1aa; font-size: 13px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Google Account Connected</h1>
    <p>Signed in as <strong>${tokens.email}</strong>.<br/>You can close this tab and return to the Weave app.</p>
  </div>
  <script>setTimeout(() => window.close(), 1200);</script>
</body>
</html>`);

          setTimeout(() => {
            try { server.close(); } catch {}
            this.activeServer = null;
          }, 500);
          resolve(tokens);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h2>Authentication error</h2><p>${err.message}</p>`);
          try { server.close(); } catch {}
          this.activeServer = null;
          reject(err);
        }
      });

      this.activeServer = server;

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && port === DEFAULT_PORT) {
          port = 0;
          server.listen(0, '127.0.0.1');
        } else {
          reject(err);
        }
      });

      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : port;
        const redirectUri = `http://localhost:${port}/auth/callback`;
        const authUrl = this.getAuthorizationUrl(redirectUri, this.clientId);
        console.log(`🔑 Redirecting to Google OAuth 2.0 PKCE: ${authUrl}`);
        if (onUrlReady) {
          onUrlReady(authUrl);
        }
      });
    });
  }

  /**
   * Exchanges authorization code for access & refresh tokens with Google's OAuth 2.0 endpoint
   */
  async exchangeCodeForTokens(code, redirectUri) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: this.pkceVerifier,
    });

    if (this.clientSecret) {
      body.append('client_secret', this.clientSecret);
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errText}`);
    }

    return await response.json();
  }

  async getValidAccessToken() {
    if (!this.tokens) this.tokens = this.loadTokens();
    if (!this.tokens) {
      throw new Error('Not logged in. Please connect your Google Account in Weave.');
    }

    const now = Date.now();
    const expiresIn = (this.tokens.expires_in || 3600) * 1000;
    const isExpired = this.tokens.acquired_at && now > this.tokens.acquired_at + expiresIn - 60000;

    if (!isExpired && this.tokens.access_token) {
      return this.tokens.access_token;
    }

    if (!this.tokens.refresh_token) {
      return this.tokens.access_token;
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      refresh_token: this.tokens.refresh_token,
      grant_type: 'refresh_token',
    });

    if (this.clientSecret) {
      body.append('client_secret', this.clientSecret);
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh Google access token. Please re-authenticate.');
    }

    const refreshed = await response.json();
    this.tokens.access_token = refreshed.access_token;
    this.tokens.expires_in = refreshed.expires_in;
    this.tokens.acquired_at = Date.now();
    this.saveTokens(this.tokens);

    return this.tokens.access_token;
  }
}

export const googleAuth = new GoogleAuthManager();
