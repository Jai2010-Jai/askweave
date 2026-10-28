// Google Stitch, signed in as the website's owner (their own Stitch account and credits).
//
// Stitch's MCP endpoint is plain JSON-RPC over HTTPS: `tools/call` with a tool name and arguments. Weave calls it
// directly with the owner's short-lived Google access token (weave/site/stitch.py swaps their stored refresh
// token for one per build). The engine's own stitchClient.js signs in with one shared API key instead, so it isn't
// used here.

const STITCH_URL = process.env.STITCH_SERVER_URL || 'https://stitch.googleapis.com/mcp';

export async function stitchCall(tool, args, { token, quotaProject, signal }) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  if (quotaProject) headers['x-goog-user-project'] = quotaProject;
  const res = await fetch(STITCH_URL, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Stitch ${tool} failed (${res.status}): ${raw.slice(0, 300)}`);
  const data = parseRpc(raw);
  if (data?.error) throw new Error(`Stitch ${tool} error: ${JSON.stringify(data.error).slice(0, 300)}`);
  const result = data?.result;
  if (result?.isError) throw new Error(`Stitch ${tool} error: ${String(result.content?.[0]?.text || 'failed').slice(0, 300)}`);
  if (result?.structuredContent && Object.keys(result.structuredContent).length) return result.structuredContent;
  const text = result?.content?.[0]?.text;
  if (text) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return result;
}

// A JSON reply, or a server-sent-events stream whose last `data:` line carries the JSON-RPC reply.
function parseRpc(raw) {
  try { return JSON.parse(raw); } catch { /* event stream */ }
  const lines = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  for (const line of lines.reverse()) {
    try { return JSON.parse(line); } catch { /* keep looking */ }
  }
  throw new Error('Stitch sent an unreadable reply');
}

export function screensIn(result) {
  const out = [];
  const visit = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    if (v.htmlCode?.downloadUrl || v.htmlCode?.name || (typeof v.name === 'string' && v.name.includes('/screens/'))) out.push(v);
    for (const k of Object.keys(v)) if (k !== 'htmlCode' && k !== 'screenshot') visit(v[k], depth + 1);
  };
  visit(result, 0);
  return out;
}

function projectIdOf(project) {
  const name = String(project?.name || project?.projectId || project?.id || '');
  return name.replace(/^projects\//, '');
}

// The screen's HTML. Stitch's download_file tool is the supported way: a plain fetch of htmlCode.downloadUrl needs
// credentials and returns a JSON wrapper, so that is only the fallback.
async function designHtml(file, auth) {
  let problem;
  if (file.name) {
    try {
      const got = await stitchCall('download_file', { name: file.name }, auth);
      if (typeof got?.html === 'string' && got.html) return got.html;
      problem = new Error('Stitch download_file returned no HTML');
    } catch (e) {
      problem = e;
    }
  }
  if (!file.downloadUrl) throw problem || new Error('Stitch did not return a design');
  const res = await fetch(file.downloadUrl, { signal: auth.signal, headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) throw problem || new Error(`Stitch design download failed (${res.status})`);
  const raw = await res.text();
  try {
    const wrapped = JSON.parse(raw);
    if (typeof wrapped?.html === 'string') return wrapped.html;
  } catch { /* the file itself */ }
  return raw;
}

// One home page designed in the owner's Stitch account: { html, screenshotUrl, projectId }.
export async function designHomePage({ token, quotaProject, timeoutMs = 240_000, title, prompt }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const auth = { token, quotaProject, signal: controller.signal };
  try {
    const project = await stitchCall('create_project', { title: String(title || 'Weave website').slice(0, 80) }, auth);
    const projectId = projectIdOf(project);
    if (!projectId) throw new Error('Stitch did not return a project');
    const made = await stitchCall('generate_screen_from_text', { projectId, prompt, deviceType: 'DESKTOP' }, auth);
    const hasHtml = (s) => s?.htmlCode?.name || s?.htmlCode?.downloadUrl;
    let screen = screensIn(made).find(hasHtml);
    if (!screen) {
      // Some replies name the new screen without its files: ask for the screen itself.
      const named = screensIn(made)[0] || screensIn(await stitchCall('list_screens', { projectId }, auth))[0];
      if (named?.name) screen = screensIn(await stitchCall('get_screen', { name: named.name }, auth))[0] || named;
    }
    if (!hasHtml(screen)) throw new Error('Stitch did not return a design');
    const html = await designHtml(screen.htmlCode, auth);
    if (!/<(html|body)[\s>]/i.test(html)) {
      throw new Error(`Stitch returned something that is not a page (${String(html).slice(0, 80).replace(/\s+/g, ' ')})`);
    }
    return { html, screenshotUrl: screen.screenshot?.downloadUrl || '', projectId };
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`Stitch took longer than ${Math.round(timeoutMs / 1000)} s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// What Stitch is asked to draw, from the request and the design research Weave already did.
export function stitchPrompt(request, topic = {}, look = {}) {
  const colors = look.colors ? Object.entries(look.colors).map(([k, v]) => `${k} ${v}`).join(', ') : '';
  // The request is a WhatsApp message ("can you make me a website for my cafe ..."): drop the chat lead-in so
  // Stitch never puts it on the page, and say the owner's answers win over everything else.
  const brief = String(request || '').replace(/^\s*(hi|hey|hello|bro|pls|please|yo)?[\s,!.]*(can|could|would|will)?\s*(you|u)?\s*(please|pls)?\s*(make|build|create|design|do|need|want|get)\s*(me|us)?\s*(a|an|my)?\s*(new\s+)?(website|site|web\s*page|landing\s*page)\s*(for|about|of)?\s*/i, '');
  const offerings = (Array.isArray(topic.offerings) ? topic.offerings : [])
    .map((o) => o && `${o.name}${o.price ? ` (${o.price})` : ''}`).filter(Boolean).join(', ');
  return [
    `A complete, polished desktop landing page. About the business (notes from a chat with the owner; use them as ` +
      `facts, never copy their wording onto the page; where the owner's answers say something, follow them over ` +
      `anything else):\n${brief}`,
    topic.brandName && `Brand: ${topic.brandName}. ${topic.tagline || ''}`.trim(),
    topic.headline && `Hero headline: "${topic.headline}"`,
    topic.targetAudience && `Audience: ${topic.targetAudience}`,
    Array.isArray(topic.keyFeatures) && topic.keyFeatures.length &&
      `Show these features: ${topic.keyFeatures.map((f) => f.title).filter(Boolean).join(', ')}`,
    offerings && `Real items and prices to show: ${offerings}`,
    look.name && `Visual direction "${look.name}": ${look.aestheticDescription || ''}`.trim(),
    colors && `Colours: ${colors}`,
    (look.fontHeading || look.fontBody) && `Fonts: ${look.fontHeading || ''} headings, ${look.fontBody || ''} body`,
    Array.isArray(look.components) && look.components.length && `Sections: ${look.components.join(', ')}`,
    'Include a navigation bar, a strong hero, the feature sections, a contact or enquiry section and a footer. ' +
      'No login, sign-up, password or payment forms.',
  ].filter(Boolean).join('\n');
}
