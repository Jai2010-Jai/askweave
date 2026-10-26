import fs from 'fs';
import path from 'path';
import os from 'os';

const STITCH_SERVER_URL = process.env.STITCH_SERVER_URL || 'https://stitch.googleapis.com/mcp';

function getStitchApiKey() {
  if (process.env.STITCH_API_KEY) return process.env.STITCH_API_KEY;
  try {
    const configPath = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const headerKey = cfg?.mcpServers?.stitch?.headers?.['X-Goog-Api-Key'];
      if (headerKey) return headerKey;
    }
  } catch {}
  return '';
}

/**
 * Sends a JSON-RPC 2.0 tool call to Google Stitch MCP.
 */
async function callStitchTool(toolName, args = {}) {
  const apiKey = getStitchApiKey();
  const payload = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-Goog-Api-Key'] = apiKey;
  }

  const response = await fetch(STITCH_SERVER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stitch MCP HTTP error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Stitch MCP error: ${JSON.stringify(data.error)}`);
  }

  const result = data.result;
  if (result?.isError) {
    const errorMsg = result.content?.[0]?.text || 'Stitch MCP operation failed';
    throw new Error(`Stitch MCP tool error: ${errorMsg}`);
  }

  // Parse structuredContent if present, else JSON in content[0].text
  if (result?.structuredContent && Object.keys(result.structuredContent).length > 0) {
    return result.structuredContent;
  }

  const textContent = result?.content?.[0]?.text;
  if (textContent) {
    try {
      return JSON.parse(textContent);
    } catch {
      return textContent;
    }
  }

  return result;
}

/**
 * Creates a new Stitch Project container.
 * @param {string} title 
 * @returns {Promise<{ name: string, title: string }>}
 */
export function isStitchConfigured() {
  return Boolean(getStitchApiKey());
}

/**
 * Creates a new Stitch Project container.
 * @param {string} title 
 * @returns {Promise<{ name: string, title: string }>}
 */
export async function createStitchProject(title = 'Portfolio Project') {
  return await callStitchTool('create_project', { title });
}

/**
 * Creates a design system for a project.
 * @param {object} params
 * @param {string} [params.projectId]
 * @param {string} params.displayName
 * @param {object} params.theme
 * @returns {Promise<any>}
 */
export async function createDesignSystem({ projectId, displayName, theme }) {
  const cleanProjectId = projectId ? projectId.replace(/^projects\//, '') : undefined;
  const args = {
    designSystem: {
      displayName: displayName || 'Domain Design System',
      theme,
    },
  };
  if (cleanProjectId) args.projectId = cleanProjectId;
  return await callStitchTool('create_design_system', args);
}

/**
 * Generates an initial screen in Stitch from a text prompt.
 * @param {object} params
 * @param {string} params.projectId (raw numeric ID without "projects/" prefix)
 * @param {string} params.prompt
 * @param {string} [params.designSystem] (e.g. "assets/123456789")
 * @param {string} [params.deviceType="DESKTOP"]
 * @returns {Promise<any>}
 */
export async function generateScreenFromText({ projectId, prompt, designSystem, deviceType = 'DESKTOP' }) {
  const cleanProjectId = projectId.replace(/^projects\//, '');
  const args = {
    projectId: cleanProjectId,
    prompt,
    deviceType,
  };
  if (designSystem) {
    args.designSystem = designSystem;
  }
  return await callStitchTool('generate_screen_from_text', args);
}

/**
 * Generates variants of existing screens within a project.
 * @param {object} params
 * @param {string} params.projectId
 * @param {string[]} params.selectedScreenIds
 * @param {string} params.prompt
 * @param {object} [params.variantOptions]
 * @returns {Promise<any>}
 */
export async function generateVariants({
  projectId,
  selectedScreenIds,
  prompt,
  variantOptions = {
    creativeRange: 'EXPLORE',
    variantCount: 2,
    aspects: ['LAYOUT', 'COLOR_SCHEME', 'TEXT_FONT'],
  },
  deviceType = 'DESKTOP',
}) {
  const cleanProjectId = projectId.replace(/^projects\//, '');
  const cleanScreenIds = selectedScreenIds.map((id) => id.replace(/^screens\//, '').split('/').pop());

  return await callStitchTool('generate_variants', {
    projectId: cleanProjectId,
    selectedScreenIds: cleanScreenIds,
    prompt,
    variantOptions,
    deviceType,
  });
}

/**
 * Edits existing screens within a project using a text prompt.
 * @param {object} params
 * @param {string} params.projectId
 * @param {string[]} params.screenIds
 * @param {string} params.prompt
 * @returns {Promise<any>}
 */
export async function editScreens({ projectId, screenIds, prompt }) {
  const cleanProjectId = projectId.replace(/^projects\//, '');
  const cleanScreenIds = screenIds.map((id) => id.replace(/^screens\//, '').split('/').pop());
  return await callStitchTool('edit_screens', {
    projectId: cleanProjectId,
    screenIds: cleanScreenIds,
    prompt,
  });
}

/**
 * Retrieves details for a specific screen (including screenshot and htmlCode URLs).
 * @param {string} screenName (e.g. "projects/123/screens/abc")
 * @returns {Promise<{ name: string, title: string, screenshot: { downloadUrl: string }, htmlCode: { downloadUrl: string } }>}
 */
export async function getScreen(screenName) {
  return await callStitchTool('get_screen', { name: screenName });
}

/**
 * Lists all screens within a project.
 * @param {string} projectId 
 * @returns {Promise<any>}
 */
export async function listScreens(projectId) {
  const cleanProjectId = projectId.replace(/^projects\//, '');
  return await callStitchTool('list_screens', { projectId: cleanProjectId });
}

/**
 * Robustly parses and extracts screens, summary text, and suggestions from a Stitch MCP tool response.
 * @param {object} result - Output from generate_screen_from_text or generate_variants
 * @returns {{ screens: Array<{ name: string, title: string, htmlCode?: { downloadUrl: string }, screenshot?: { downloadUrl: string } }>, summaryText: string, designSystem: any, suggestions: string[] }}
 */
export function extractScreensFromStitchResponse(result) {
  const screens = [];
  let summaryText = '';
  let designSystem = null;
  const suggestions = [];

  const components =
    result?.outputComponents ||
    result?.output_components ||
    (Array.isArray(result) ? result : []);

  for (const comp of components) {
    if (comp.design?.screens && Array.isArray(comp.design.screens)) {
      screens.push(...comp.design.screens);
    }
    if (comp.screens && Array.isArray(comp.screens)) {
      screens.push(...comp.screens);
    }
    if (comp.screen) {
      screens.push(comp.screen);
    }
    if (comp.text && typeof comp.text === 'string') {
      summaryText += (summaryText ? '\n\n' : '') + comp.text;
    }
    if (comp.suggestion && typeof comp.suggestion === 'string') {
      suggestions.push(comp.suggestion);
    }
    if (comp.designSystem) {
      designSystem = comp.designSystem;
    }
  }

  return { screens, summaryText, designSystem, suggestions };
}

/**
 * Downloads an asset (screenshot or HTML code) from a URL to a local destination file.
 * @param {string} downloadUrl 
 * @param {string} destinationPath 
 * @returns {Promise<string>}
 */
export async function downloadStitchAsset(downloadUrl, destinationPath) {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download Stitch asset (${res.status}): ${res.statusText}`);
  }

  const buffer = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, Buffer.from(buffer));
  return destinationPath;
}

export const stitchClient = {
  isConfigured: isStitchConfigured,
  createProject: createStitchProject,
  createDesignSystem,
  generateScreenFromText,
  generateVariants,
  editScreens,
  getScreen,
  listScreens,
  extractScreens: extractScreensFromStitchResponse,
  downloadAsset: downloadStitchAsset,
};
