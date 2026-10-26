import fs from 'fs';
import path from 'path';
import { loadProjectsState, saveProjectsState, isPathWithinMasterDir } from '../config.js';

/**
 * Validates that masterDir is configured and accessible.
 */
export function getValidatedMasterDir() {
  const state = loadProjectsState();
  const masterDir = state.masterDir;
  if (!masterDir || !fs.existsSync(masterDir)) {
    throw new Error('Master Directory is not configured or does not exist. Please set it in the Weave desktop app.');
  }
  return path.resolve(masterDir);
}

/**
 * Creates a new project subfolder strictly under masterDir and binds the group to it.
 */
export function createProjectUnderMaster(rawProjectName, groupJid = null) {
  const masterDir = getValidatedMasterDir();
  if (!rawProjectName) {
    throw new Error('Project name cannot be empty.');
  }

  const rawStr = String(rawProjectName).trim();
  if (rawStr.includes('/') || rawStr.includes('\\') || rawStr.includes('..')) {
    throw new Error('Security Violation: Invalid project name or path traversal attempted.');
  }

  // Sanitize project name to prevent path traversal
  const sanitized = rawStr
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  if (!sanitized) {
    throw new Error('Invalid project name. Please use alphanumeric characters, dashes, or underscores.');
  }

  const targetPath = path.join(masterDir, sanitized);

  // Security Sandboxing check
  if (!isPathWithinMasterDir(targetPath, masterDir)) {
    throw new Error('Security Violation: Target path is outside the Master Directory.');
  }

  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }

  const state = loadProjectsState();
  state.projects = state.projects || {};
  state.projects[sanitized] = targetPath;
  state.activeProject = sanitized;

  if (groupJid) {
    state.groupBindings = state.groupBindings || {};
    state.groupBindings[groupJid] = sanitized;
  }

  saveProjectsState(state);
  return { success: true, alias: sanitized, path: targetPath };
}

/**
 * Switches the active project for a group strictly within masterDir.
 */
export function switchGroupProject(rawProjectName, groupJid) {
  const masterDir = getValidatedMasterDir();
  const state = loadProjectsState();
  const sanitized = String(rawProjectName).trim().toLowerCase();

  // 1. Search in configured projects
  let matchedAlias = null;
  let matchedPath = null;

  for (const [alias, dir] of Object.entries(state.projects || {})) {
    if (alias.toLowerCase() === sanitized || path.basename(dir).toLowerCase() === sanitized) {
      matchedAlias = alias;
      matchedPath = dir;
      break;
    }
  }

  // 2. Search in masterDir subfolders if not in projects map
  if (!matchedAlias) {
    const candidatePath = path.join(masterDir, sanitized);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      matchedAlias = sanitized;
      matchedPath = candidatePath;
      state.projects[matchedAlias] = matchedPath;
    }
  }

  if (!matchedAlias || !matchedPath) {
    throw new Error(`Project "${rawProjectName}" was not found under Master Directory.`);
  }

  // Security Sandboxing check
  if (!isPathWithinMasterDir(matchedPath, masterDir)) {
    throw new Error(`Security Violation: Project "${matchedAlias}" is located outside the Master Directory.`);
  }

  state.groupBindings = state.groupBindings || {};
  state.groupBindings[groupJid] = matchedAlias;
  state.activeProject = matchedAlias;

  saveProjectsState(state);
  return { success: true, alias: matchedAlias, path: matchedPath };
}

/**
 * Unbinds the active project from a group.
 */
export function unbindGroupProject(groupJid) {
  const state = loadProjectsState();
  state.groupBindings = state.groupBindings || {};
  const previous = state.groupBindings[groupJid] || null;
  delete state.groupBindings[groupJid];
  saveProjectsState(state);
  return { success: true, previous };
}

/**
 * Gets current project status for a group.
 */
export function getGroupProjectStatus(groupJid) {
  const state = loadProjectsState();
  const boundAlias = state.groupBindings?.[groupJid] || null;
  const masterDir = state.masterDir || null;

  if (!boundAlias) {
    return {
      bound: false,
      masterDir,
      message: 'No project is currently bound to this group.',
    };
  }

  const projPath = state.projects?.[boundAlias] || (masterDir ? path.join(masterDir, boundAlias) : null);
  const exists = projPath ? fs.existsSync(projPath) : false;

  // Auto-healing: If bound project was deleted, unbind it immediately!
  if (!exists) {
    state.groupBindings = state.groupBindings || {};
    delete state.groupBindings[groupJid];
    if (state.activeProject === boundAlias) {
      state.activeProject = '';
    }
    saveProjectsState(state);
    return {
      bound: false,
      masterDir,
      message: `Previously bound project "${boundAlias}" was deleted and has been unbound.`,
    };
  }

  return {
    bound: true,
    alias: boundAlias,
    path: projPath,
    exists,
    masterDir,
  };
}

/**
 * Lists all projects available under Master Directory and indicates which is active in this group.
 */
export function listProjectsForGroup(groupJid) {
  const masterDir = getValidatedMasterDir();
  const state = loadProjectsState();
  let boundAlias = state.groupBindings?.[groupJid] || (!groupJid?.endsWith('@g.us') ? state.activeProject : null) || null;

  // Scan masterDir subdirectories
  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(masterDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);
  } catch (err) {
    throw new Error(`Failed to read Master Directory: ${err.message}`);
  }

  // Combine with state.projects that are inside masterDir, normalizing case to prevent duplicate entries
  const projectMap = new Map();
  for (const name of dirEntries) {
    projectMap.set(name.toLowerCase(), name);
  }
  for (const [alias, dir] of Object.entries(state.projects || {})) {
    if (isPathWithinMasterDir(dir, masterDir)) {
      const base = path.basename(dir);
      if (!projectMap.has(alias.toLowerCase())) {
        projectMap.set(alias.toLowerCase(), alias);
      }
    }
  }

  const allProjects = Array.from(projectMap.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  // If the bound project was deleted from masterDir, unbind it!
  if (boundAlias && !allProjects.includes(boundAlias)) {
    state.groupBindings = state.groupBindings || {};
    delete state.groupBindings[groupJid];
    if (state.activeProject === boundAlias) {
      state.activeProject = '';
    }
    saveProjectsState(state);
    boundAlias = null;
  }

  return {
    masterDir,
    boundAlias,
    projects: allProjects,
  };
}
