// Weave runs the engine with API keys only (GEMINI_API_KEY, or GLM through weave/web/bridge.mjs).
// The original Google OAuth sign-in (Gemini CLI / Cloud Code credentials) was removed; this keeps
// gemini-client.js's import working and reports "not signed in", so that path never runs.
export const googleAuth = {
  isAuthenticated: () => false,
  getValidAccessToken: async () => null,
};
