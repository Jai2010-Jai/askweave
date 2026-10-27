(() => {
  const { api, $ } = window.weave;
  const params = new URLSearchParams(location.search);
  const errors = { google: "Google sign-in didn't work. Try again.", google_off: "Google sign-in isn't set up yet.",
    closed: "That account is closed." };

  // Sign-in and sign-up are both "Continue with Google". A returning account lands on the dashboard straight from
  // Google; a new one comes back here with google_pending set and picks a username to finish.
  async function init() {
    try {
      await api("/api/account/me");
      location.replace("/dashboard");
      return;
    } catch (e) { /* not signed in */ }
    const cfg = await api("/api/account/config").catch(() => ({}));
    $("#domain").textContent = "." + (cfg.domain || "askweave.xyz");
    if (!cfg.google) {
      $("#google-box").hidden = true;
      $("#google-off").hidden = false;
    }
    if (cfg.google_pending) {
      $("#google-box").hidden = true;
      $("#signup-form").hidden = false;
      $("#google-pending").hidden = false;
      $("#google-pending").textContent = `Signed in with Google as ${cfg.google_pending.email}. Pick your username to finish.`;
      const first = (cfg.google_pending.name || "").split(" ")[0];
      if (first && !$("#call-sign").value) $("#call-sign").value = first;
    }
    if (params.get("error")) $("#signup-error").textContent = errors[params.get("error")] || "";
  }

  let timer;
  $("#username").addEventListener("input", () => {
    const input = $("#username");
    input.value = input.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const hint = $("#username-hint");
    clearTimeout(timer);
    if (input.value.length < 3) { hint.className = "hint"; hint.textContent = "3–20 lowercase letters, numbers or hyphens."; return; }
    timer = setTimeout(async () => {
      const r = await api("/api/account/username?name=" + encodeURIComponent(input.value)).catch(() => null);
      if (!r || input.value !== $("#username").value) return;
      hint.className = r.ok ? "hint good" : "hint bad";
      hint.textContent = r.ok ? `${input.value}.askweave.xyz is yours if you want it.` : r.problem;
    }, 300);
  });

  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#signup-btn");
    $("#signup-error").textContent = "";
    btn.disabled = true;
    try {
      await api("/api/account/signup", {
        username: $("#username").value.trim(), call_sign: $("#call-sign").value.trim(),
        invite: $("#invite").value.trim(), terms: $("#terms").checked,
      });
      location.replace("/dashboard?welcome=1");
    } catch (err) {
      $("#signup-error").textContent = err.message;
      btn.disabled = false;
    }
  });

  init();
})();
