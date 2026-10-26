import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';
import { saveSwiggyCredentials } from '../src/concierge/swiggy/swiggyAuth.js';

const PORT = 8086;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const AUTH_SERVER = 'https://mcp.swiggy.com/auth';

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient() {
  try {
    const res = await fetch(`${AUTH_SERVER}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Weave WhatsApp Agent',
        redirect_uris: [REDIRECT_URI],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.client_id || 'swiggy-mcp';
    }
  } catch (err) {
    // Fall back to default client_id
  }
  return 'swiggy-mcp';
}

async function startSwiggyAuth() {
  console.log('🍔 Initializing Swiggy MCP OAuth 2.1 PKCE Login...\n');

  const clientId = await registerClient();
  const { verifier, challenge } = generatePKCE();

  const authUrl = `${AUTH_SERVER}/authorize?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'mcp:tools',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()}`;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h2>Swiggy Login Error: ${error}</h2>`);
          console.error(`❌ Authorization failed: ${error}`);
          server.close();
          process.exit(1);
        }

        if (code) {
          console.log('🔑 Exchanging authorization code for Bearer token...');
          const tokenRes = await fetch(`${AUTH_SERVER}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: clientId,
              redirect_uri: REDIRECT_URI,
              code,
              code_verifier: verifier,
            }),
          });

          if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h2>Token Exchange Failed: ${errText}</h2>`);
            console.error('❌ Token exchange failed:', errText);
            server.close();
            process.exit(1);
          }

          const tokenData = await tokenRes.json();
          saveSwiggyCredentials({
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresIn: tokenData.expires_in,
          });

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
              <h1 style="color: #fc8019;">🎉 Swiggy Account Connected!</h1>
              <p>Your session has been saved to <code>.credentials.json</code>.</p>
              <p>You can close this window and return to WhatsApp.</p>
            </div>
          `);

          console.log('✅ Swiggy authentication successful! Credentials saved.');
          setTimeout(() => {
            server.close();
            process.exit(0);
          }, 1000);
        }
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${err.message}`);
    }
  });

  server.listen(PORT, () => {
    console.log(`🌐 Local callback listener ready at: http://localhost:${PORT}/callback\n`);
    console.log('👉 Open this URL in your browser to sign in to Swiggy with your phone + OTP:');
    console.log(`\n\x1b[36m${authUrl}\x1b[0m\n`);

    // Attempt to open in browser automatically
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${authUrl}"`, () => {});
  });
}

startSwiggyAuth().catch((err) => {
  console.error('❌ Error initializing auth:', err);
  process.exit(1);
});
