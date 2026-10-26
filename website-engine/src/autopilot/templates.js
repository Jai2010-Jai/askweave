/**
 * Standard System Command Templates for Weave Autopilot.
 *
 * Implements Section 2 & Section 9:
 * "The model picks the command and fills in parameters, and the code writes the reply."
 * "The fixed system-command templates also use this casual voice, but their structure
 *  and fields stay the same every time."
 */

export const TEMPLATES = {
  welcome_init: ({ masterDir, activeProject, projects = [] }) => {
    const projList = projects.length > 0
      ? projects.map((p) => `• ${p}${p === activeProject ? ' (active here 🟢)' : ''}`).join('\n')
      : '• (no project folders yet)';

    return [
      `🚀 weave agent initialized!`,
      `📁 master dir: ${masterDir || '(not configured)'}`,
      activeProject ? `🟢 active project: ${activeProject}` : `⚪ active project: none (group is unbound)`,
      ``,
      `📂 available projects:`,
      projList,
      ``,
      `say "create project <name>" or "switch to <name>" to get moving.`,
    ].join('\n');
  },

  list_projects: ({ projects = [], activeProject = null }) => {
    if (projects.length === 0) {
      return `projects in master dir rn:\n• (no projects yet — say "create project <name>" to start one)`;
    }

    const bullets = projects
      .map((p) => `• ${p}${p === activeProject ? ' (active here 🟢)' : ''}`)
      .join('\n');

    return `projects in master dir rn:\n${bullets}`;
  },

  create_project: ({ projectName, folderPath }) => {
    return [
      `bet, created "${projectName}" and locked this group to it 🚀`,
      `folder: ${folderPath}`,
    ].join('\n');
  },

  switch_project: ({ projectName }) => {
    return `switched this group to "${projectName}" aight 👍`;
  },

  current_project: ({ projectName, folderPath }) => {
    if (!projectName) {
      return `no active project in this group rn.\nsay "switch to <name>" or "create project <name>" to set one up.`;
    }
    return [
      `active project here: "${projectName}"`,
      `path: ${folderPath || '(in master dir)'}`,
    ].join('\n');
  },

  unbind_project: ({ previousProject }) => {
    if (previousProject) {
      return `unbound "${previousProject}" from this group. standing by.`;
    }
    return `this group doesn't have an active project right now anyway.`;
  },

  no_active_project: () => {
    return [
      `yo no project is active in this group rn.`,
      `say "create project <name>" or "switch to <name>" first.`,
    ].join('\n');
  },

  project_not_found: ({ projectName, availableProjects = [] }) => {
    const list = availableProjects.length > 0 ? availableProjects.join(', ') : 'none';
    return `couldn't find project "${projectName}" in master dir.\navailable projects: ${list}`;
  },

  missing_project_name: ({ action = 'create' }) => {
    return `need a project name for that. e.g. "${action} project my-app"`;
  },
};
