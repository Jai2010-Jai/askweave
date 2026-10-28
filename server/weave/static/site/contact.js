// The contact form a hosted site's visitors land on.
//
// The site they came from is sandboxed, so its own form could never submit anywhere. It opens this page
// instead, and sends over whatever the visitor had already typed so they don't have to type it twice.
(() => {
  const { api, $ } = window.weave;
  const [, username, slug] = location.pathname.split("/").filter(Boolean).length === 3
    ? location.pathname.split("/")
    : ["", "", ""];
  const target = `/api/leads/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;

  // Whatever the other page called its fields, map it onto ours. Treated as plain text, never as markup.
  const FIELDS = {
    name: ["name", "fullname", "full-name", "your-name", "firstname", "text"],
    contact: ["contact", "email", "e-mail", "mail", "phone", "tel", "mobile", "number"],
    message: ["message", "msg", "enquiry", "inquiry", "comment", "comments", "details", "textarea", "question"],
  };

  function prefill(fields) {
    for (const [id, names] of Object.entries(FIELDS)) {
      const hit = names.find((n) => typeof fields[n] === "string" && fields[n].trim());
      if (hit && !$("#" + id).value) $("#" + id).value = String(fields[hit]).slice(0, 1000);
    }
  }

  // The opener is a sandboxed page, so its origin is "null" and cannot be checked by name; we only accept a
  // message from the exact window that opened us, and only ever use it to fill in text boxes.
  if (window.opener) {
    window.addEventListener("message", (ev) => {
      if (ev.source === window.opener && ev.data && ev.data.weave === "prefill" && ev.data.fields) {
        prefill(ev.data.fields);
      }
    });
    try { window.opener.postMessage("weave-contact-ready", "*"); } catch (e) { /* opener went away */ }
  }

  async function load() {
    try {
      const who = await api(target);
      $("#title").textContent = `Message ${who.owner}`;
      $("#lead").textContent = `Your message goes straight to the person behind ${who.site}.`;
    } catch (e) {
      $("#title").textContent = "This site doesn't exist";
      $("#contact-form").hidden = true;
    }
  }

  $("#contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: $("#name").value.trim(), contact: $("#contact").value.trim(),
      message: $("#message").value.trim(), website: $("#website").value.trim(),
    };
    if (!payload.contact || !payload.message) {
      $("#hint").textContent = "Leave a message and a way to reach you.";
      return;
    }
    $("#send").disabled = true;
    $("#hint").textContent = "Sending…";
    try {
      await api(target, payload);
      $("#contact-form").hidden = true;
      $("#done").hidden = false;
    } catch (err) {
      $("#send").disabled = false;
      $("#hint").textContent = err.message;
    }
  });

  load();
})();
