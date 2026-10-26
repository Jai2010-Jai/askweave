import { CONFIG } from '../config.js';
import { geminiClient } from '../gemini-client.js';

export function stripEmojis(str) {
  if (!str) return str;
  return str
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{200D}\u{FE0F}]/gu, '')
    .trim();
}

const FAST_ROUTER_PROMPT = `You are Weave, a chill dev assistant on WhatsApp. Reply direct and lowkey with NO emojis.
Classify the user's message into intent and output strictly JSON.

Allowed Intents:
- "coding_task": Write, edit, debug, refactor, or build code in active project.
- "portfolio": Create, design, or iterate on a portfolio website, design variants, or personal site.
- "conversational_qa": Greetings, chit-chat, technical questions, banter, opinions.
- "cab_booking": Compare cab fares, check route pricing, or book ride with Uber, Ola, or Namma Yatri.
- "swiggy": Order food or groceries (Instamart), browse menus, manage cart, coupons, track delivery.
- "workspace_management": Switch/list/create project or bind chat.
- "git_github": Push, commit, git status, collaborators.
- "task_control": Stop, cancel, status, clear session.
- "help_guide": What can you do / help.

Rules:
1. If "conversational_qa", provide "directReply" in a chill, direct GenZ tone. Absolutely NO emojis.
2. If "coding_task", set "directReply" to null and fill "instructions" and "targetProject" (if mentioned).
3. Output ONLY a valid JSON object matching this schema:
{
  "intent": "coding_task" | "portfolio" | "conversational_qa" | "cab_booking" | "swiggy" | "workspace_management" | "git_github" | "task_control" | "help_guide",
  "confidence": 0.95,
  "directReply": string | null,
  "instructions": string | null,
  "targetProject": string | null
}`;

/**
 * Queries the Tier 1 Fast Router (OpenRouter or local custom open-weights model).
 * Automatically falls back to Gemini if the router fails or is unconfigured.
 */
export async function queryFastRouter({ text, availableProjects = [], boundProject = null, recentHistory = [] }) {
  const baseUrl = (CONFIG.routerBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const apiKey = CONFIG.routerApiKey;
  const model = CONFIG.routerModel || 'openrouter/free';

  // Build compact context (~80 tokens instead of 2,000)
  const contextNotes = [];
  if (boundProject) contextNotes.push(`Active project: "${boundProject}"`);
  if (availableProjects.length > 0) contextNotes.push(`Known projects: ${JSON.stringify(availableProjects)}`);
  
  const systemContent = contextNotes.length > 0 
    ? `${FAST_ROUTER_PROMPT}\n\nContext:\n${contextNotes.join('\n')}`
    : FAST_ROUTER_PROMPT;

  const messages = [{ role: 'system', content: systemContent }];

  // Add at most last 2 conversation messages for context
  if (recentHistory && recentHistory.length > 0) {
    for (const m of recentHistory.slice(-2)) {
      messages.push({
        role: m.sender === 'User' ? 'user' : 'assistant',
        content: m.text,
      });
    }
  }

  messages.push({ role: 'user', content: text });

  // If no API key configured, fall back to Gemini
  if (!apiKey) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout for free queue

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    if (baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://github.com/darthnihilus01/weave';
      headers['X-Title'] = 'Weave';
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[FastRouter] Request failed (${res.status}): ${errText}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    // Extract JSON from output
    let parsed = null;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    }

    if (parsed && parsed.intent) {
      if (parsed.directReply) {
        parsed.directReply = stripEmojis(parsed.directReply);
      }
      return parsed;
    }
  } catch (err) {
    console.warn(`[FastRouter] Error querying router: ${err.message}`);
  }

  return null;
}

/**
 * Direct conversational call to the custom router / OpenRouter model.
 */
export async function queryCustomRouterChat({ systemPrompt, userMessage, temperature = 0.2 }) {
  const baseUrl = (CONFIG.routerBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const apiKey = CONFIG.routerApiKey;
  const model = CONFIG.routerModel || 'openrouter/free';

  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    if (baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://github.com/darthnihilus01/weave';
      headers['X-Title'] = 'Weave';
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature,
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[FastRouter] Chat request failed (${res.status}): ${errText}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    return stripEmojis(rawContent.trim());
  } catch (err) {
    console.warn(`[FastRouter] Chat error: ${err.message}`);
    return null;
  }
}

/**
 * Takes factual/fallback text and runs it through the custom model (or Gemini fallback)
 * to deliver a chill, lowkey dev response free of corporate jargon and emoji spam.
 */
export async function naturalizeWithCustomModel({ userText, rawReply, links = [] }) {
  if (!rawReply) return rawReply;

  // Extract all URLs and swiggy:// deep links from rawReply if not explicitly provided
  const extractedLinks = new Set(links);
  const urlMatches = rawReply.match(/https?:\/\/[^\s)\]]+/g) || [];
  urlMatches.forEach((u) => extractedLinks.add(u));
  const schemeMatches = rawReply.match(/swiggy:\/\/[^\s)\]`]+/g) || [];
  schemeMatches.forEach((s) => extractedLinks.add(s));

  const systemPrompt =
    'You are Weave, a chill dev assistant on WhatsApp. Reply direct, natural, and lowkey like a dev friend texting. Absolutely NO emojis. Zero emojis. No corporate AI jargon, marketing fluff, or robotic templates. Keep it concise (1-3 sentences). Always include all links and URLs cleanly.';

  const userMessage = `User asked: "${userText || 'order food'}"
Factual info to deliver:
${rawReply}

Reply in your chill dev voice. Include all links exactly as provided.`;

  // 1. Try Custom Router on OpenRouter / local QLoRA model
  let reply = await queryCustomRouterChat({
    systemPrompt,
    userMessage,
    temperature: 0.3,
  });

  // 2. Fallback to Gemini Client if custom router fails
  if (!reply) {
    try {
      const res = await geminiClient.generateContent(userMessage, systemPrompt);
      reply = res.text?.trim() || null;
    } catch (err) {
      console.warn('[FastRouter] Gemini naturalization fallback note:', err.message);
    }
  }

  // 3. If model succeeded, ensure emojis are stripped and essential links are retained
  if (reply) {
    let clean = stripEmojis(reply);
    // Ensure all critical links are present
    for (const link of extractedLinks) {
      if (!clean.includes(link.substring(0, 30))) {
        clean += `\n${link}`;
      }
    }
    return clean.trim();
  }

  // 4. If all AI models are offline/unavailable, return deterministic rawReply stripped of emojis
  return stripEmojis(rawReply);
}

