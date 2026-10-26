import { googleAuth } from './auth.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CLOUDCODE_HOSTS = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.googleapis.com',
];

/**
 * Direct Gemini API Client supporting OAuth Bearer Tokens (Cloud Code Assist & Generative Language)
 * or standard Gemini API Keys (`GEMINI_API_KEY`).
 * Works standalone without requiring local `agy` CLI installation.
 */
export class GeminiClient {
  constructor(options = {}) {
    this.model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
    this.cachedProject = null;
    this.cachedHost = null;
  }

  async resolveCloudCodeProject(accessToken) {
    if (this.cachedProject && this.cachedHost) {
      return { host: this.cachedHost, project: this.cachedProject };
    }

    const cacheFile = '/tmp/weave-gemini-cloudcode.json';
    try {
      const fs = await import('fs');
      if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached?.host && cached?.project) {
          this.cachedHost = cached.host;
          this.cachedProject = cached.project;
          return { host: cached.host, project: cached.project };
        }
      }
    } catch {}

    const metadataPayloads = [
      { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
      { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
    ];

    function extractProjectId(companion) {
      if (!companion) return null;
      if (typeof companion === 'string') return companion.trim() || null;
      if (typeof companion === 'object') {
        const id = companion.id || companion.projectId || companion.name;
        return typeof id === 'string' && id.trim() ? id.trim() : null;
      }
      return null;
    }

    for (const host of CLOUDCODE_HOSTS) {
      for (const metadata of metadataPayloads) {
        try {
          const loadRes = await fetch(`${host}/v1internal:loadCodeAssist`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity/2.0.0',
            },
            body: JSON.stringify({ metadata }),
          });
          if (!loadRes.ok) continue;
          const loadData = await loadRes.json();
          const companionId = extractProjectId(loadData.cloudaicompanionProject);
          if (companionId) {
            this.cachedHost = host;
            this.cachedProject = companionId;
            return { host, project: companionId };
          }

          const tierId =
            loadData.allowedTiers?.find((t) => t.isDefault)?.id ||
            loadData.allowedTiers?.[0]?.id ||
            'free-tier';
          const onboardRes = await fetch(`${host}/v1internal:onboardUser`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity/2.0.0',
            },
            body: JSON.stringify({ tierId, metadata }),
          });
          if (onboardRes.ok) {
            const onboardData = await onboardRes.json();
            const proj = extractProjectId(
              onboardData.response?.cloudaicompanionProject ||
              onboardData.cloudaicompanionProject
            );
            if (proj) {
              this.cachedHost = host;
              this.cachedProject = proj;
              try {
                const fs = await import('fs');
                fs.writeFileSync('/tmp/weave-gemini-cloudcode.json', JSON.stringify({ host, project: proj }));
              } catch {}
              return { host, project: proj };
            }
          }
        } catch {
          // try next
        }
      }
    }
    return { host: CLOUDCODE_HOSTS[0], project: undefined };
  }

  /**
   * Generates content directly from Gemini (via API Key or Google OAuth PKCE token)
   * @param {string} prompt - The user prompt
   * @param {string|null} [systemInstruction] - Optional system prompt
   */
  async generateContent(prompt, systemInstruction = null, generationConfig = null) {
    const apiKey = this.apiKey || process.env.GEMINI_API_KEY || '';

    const contents = [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];

    // 1. Direct Gemini API Key if configured
    if (apiKey) {
      const endpoint = `${GEMINI_API_BASE}/models/${this.model}:generateContent`;
      const body = { contents };
      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }
      if (generationConfig) {
        body.generationConfig = generationConfig;
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${err}`);
      }
      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      return { text, raw: data };
    }

    // 2. Direct Antigravity CLI (agy) - instant, native authenticated session
    try {
      const agyRes = await this.generateViaAgy(prompt, systemInstruction);
      if (agyRes?.text) return agyRes;
    } catch {
      // Fall through to OAuth endpoints
    }

    // 3. Google OAuth 2.0 PKCE Token (Cloud Code Assist / Antigravity endpoint)
    if (googleAuth.isAuthenticated()) {
      const accessToken = await googleAuth.getValidAccessToken();
      const { host, project } = await this.resolveCloudCodeProject(accessToken);

      const requestBody = { contents };
      if (systemInstruction) {
        requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
      }
      if (generationConfig) {
        requestBody.generationConfig = generationConfig;
      }

      const cloudCodePayload = {
        model: this.model,
        ...(project && typeof project === 'string' ? { project } : {}),
        request: requestBody,
      };

      try {
        const ccRes = await fetch(`${host}/v1internal:generateContent`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity/2.0.0',
          },
          body: JSON.stringify(cloudCodePayload),
        });

        if (ccRes.ok) {
          const ccData = await ccRes.json();
          const inner = ccData.response || ccData;
          const text =
            inner.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
          return { text, raw: ccData };
        }

        // Fallback: try generativelanguage.googleapis.com with OAuth Bearer token
        const glRes = await fetch(
          `${GEMINI_API_BASE}/models/${this.model}:generateContent`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (glRes.ok) {
          const glData = await glRes.json();
          const text =
            glData.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
          return { text, raw: glData };
        }
      } catch {
        // Fall through to headless agy CLI
      }
    }

    // 3. Fallback: local Antigravity CLI (agy)
    try {
      const agyRes = await this.generateViaAgy(prompt, systemInstruction);
      if (agyRes?.text) return agyRes;
    } catch {
      // ignore
    }

    throw new Error(
      'Gemini authentication missing. Please sign in with Google (Step 2), provide GEMINI_API_KEY in .env, or install the agy CLI.'
    );
  }

  /**
   * Generates content using local Antigravity CLI as headless fallback.
   */
  async generateViaAgy(prompt, systemInstruction = null) {
    const { spawn } = await import('child_process');
    return new Promise((resolve, reject) => {
      const agyBin = process.env.AGY_BIN || 'agy';
      const child = spawn(
        agyBin,
        [
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--dangerously-skip-permissions',
          '--effort',
          'low',
          '-p=',
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, PAGER: 'cat' },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      let output = '';
      let responseText = '';

      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        const lines = output.split('\n');
        output = lines.pop();
        for (const line of lines) {
          if (!line.trim().startsWith('{')) continue;
          try {
            const evt = JSON.parse(line.trim());
            if (evt.event === 'result') {
              responseText = evt.result?.response || evt.response || '';
            }
          } catch {}
        }
      });

      child.on('close', (code) => {
        if (!responseText && output && output.trim().startsWith('{')) {
          try {
            const evt = JSON.parse(output.trim());
            if (evt.event === 'result') {
              responseText = evt.result?.response || evt.response || '';
            }
          } catch {}
        }
        if (responseText) {
          resolve({ text: responseText.trim(), raw: { source: 'agy' } });
        } else {
          reject(new Error(`agy CLI exited with code ${code}`));
        }
      });

      child.on('error', (err) => reject(err));

      const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
      const payload = JSON.stringify({
        event: 'user',
        message: { role: 'user', content: fullPrompt },
      });
      child.stdin.write(`${payload}\n`);
      child.stdin.end();
    });
  }
}

export const geminiClient = new GeminiClient();
