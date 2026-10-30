(() => {
  const { api, el, $ } = window.weave;
  let me = null;
  const STATE = { succeeded: ["ready", "ok"], running: ["building", "busy"], queued: ["queued", "busy"],
    failed: ["failed", "fail"], cancelled: ["cancelled", "fail"] };

  async function load() {
    try {
      me = await api("/api/account/me");
    } catch (e) {
      if (e.status === 401) location.replace("/start");
      return;
    }
    $("#main").hidden = false;
    $("#who").textContent = me.username;
    $("#hello").textContent = `Hi ${me.call_sign}`;
    $("#address").textContent = me.address.replace("https://", "");
    $("#address").href = me.address;
    $("#call-sign").value = me.call_sign;
    const waBase = me.whatsapp ? "https://wa.me/" + me.whatsapp.replace(/\D/g, "") : null;
    $("#connect").hidden = !!me.phone;
    $("#linked").hidden = !me.phone;
    if (me.phone) {
      $("#phone").textContent = me.phone;
      if (waBase) $("#wa-open").href = waBase; else $("#wa-open").hidden = true;
    }
    if (me.invite) { $("#invite-line").hidden = false; $("#invite").textContent = me.invite; }
    renderStitch();
    renderProjects();
    renderStats();
    loadTraffic();
    loadLeads();
    loadSales();
    loadData();
    loadDigest();
  }

  // ---------- sales ----------
  const money = (n, cur) => {
    const sym = { INR: "Rs ", USD: "$", EUR: "EUR ", GBP: "GBP " }[cur] || (cur ? cur + " " : "");
    return sym + Math.round(Math.abs(n)).toLocaleString() ;
  };

  // ---------- products & stock ----------
  let dataTables = [], dataOpen = null;

  async function loadData(open) {
    let f;
    try {
      f = await api("/api/account/data");
    } catch (e) {
      return;
    }
    dataTables = f.tables;
    $("#data-preset").replaceChildren(...f.presets.map((p) => el("option", { value: p.name }, p.label)),
      el("option", { value: "" }, "Something else..."));
    const pick = open || (dataOpen && dataTables.some((t) => t.name === dataOpen) ? dataOpen : dataTables[0]?.name);
    $("#data-tabs").replaceChildren(...dataTables.map((t) => el("button", {
      class: "btn ghost small" + (t.name === pick ? " on" : ""), type: "button", onclick: () => loadData(t.name),
    }, `${t.label || t.name} (${t.rows})`)));
    $("#data-table").hidden = !pick;
    if (pick) openTable(pick);
  }

  async function openTable(name) {
    dataOpen = name;
    const t = await api(`/api/account/data/${encodeURIComponent(name)}`);
    $("#data-public").checked = t.public;
    $("#data-export").href = `/api/account/data/${encodeURIComponent(name)}/export.csv`;
    const head = el("tr", {}, ...t.fields.map((f) => el("th", {}, f.label)), el("th", {}, ""));
    const rows = t.rows.map((r) => dataRow(t, r));
    $("#data-grid").replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
    $("#data-status").textContent = t.rows.length ? "" : "No items yet.";
  }

  function cellValue(f, v) {
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function dataRow(t, r) {
    const inputs = {};
    const save = async () => {
      const data = {};
      for (const f of t.fields) data[f.key] = f.type === "yesno" ? inputs[f.key].checked : inputs[f.key].value;
      try {
        await api(`/api/account/data/${encodeURIComponent(t.name)}/rows/${r.id}`, { data });
        $("#data-status").textContent = "Saved. Your live site has it now.";
        if (inputs.stock) inputs.stock.classList.toggle("low", inputs.stock.value !== "" && Number(inputs.stock.value) <= 5);
      } catch (e) {
        $("#data-status").textContent = e.message;
      }
    };
    const cells = t.fields.map((f) => {
      const v = r.data[f.key];
      const input = f.type === "yesno"
        ? el("input", { type: "checkbox", checked: !!v, onchange: save })
        : el("input", { type: "text", inputmode: f.type === "money" || f.type === "number" ? "decimal" : null,
          class: (f.type === "money" || f.type === "number" ? "num" : "")
            + (f.key === "stock" && v !== null && v !== undefined && v !== "" && Number(v) <= 5 ? " low" : ""),
          placeholder: f.type === "image" ? "https://..." : "", value: cellValue(f, v), onchange: save });
      inputs[f.key] = input;
      return el("td", {}, input);
    });
    const del = el("button", { class: "del", type: "button", title: "Delete", "aria-label": "Delete item",
      onclick: async () => {
        if (!confirm(`Delete ${r.data.name || "this item"}?`)) return;
        await api(`/api/account/data/${encodeURIComponent(t.name)}/rows/${r.id}/delete`, {});
        loadData(t.name);
      } }, "×");
    return el("tr", {}, ...cells, el("td", {}, del));
  }

  $("#data-add").addEventListener("click", async () => {
    if (!dataOpen) return;
    await api(`/api/account/data/${encodeURIComponent(dataOpen)}/rows`, { data: { name: "New item" } });
    loadData(dataOpen);
  });
  $("#data-public").addEventListener("change", async () => {
    await api(`/api/account/data/${encodeURIComponent(dataOpen)}/settings`, { public: $("#data-public").checked });
    $("#data-status").textContent = $("#data-public").checked ? "Shown on your live sites." : "Hidden from your live sites.";
  });
  $("#data-delete").addEventListener("click", async () => {
    if (!dataOpen || !confirm("Delete this whole list? Your sites will go back to the items they were built with.")) return;
    await api(`/api/account/data/${encodeURIComponent(dataOpen)}/delete`, {});
    dataOpen = null;
    loadData();
  });
  $("#data-create").addEventListener("click", async () => {
    const preset = $("#data-preset").value;
    let body = { preset };
    if (!preset) {
      const label = prompt("What's the list called? (e.g. Rooms, Courses)");
      if (!label) return;
      const cols = prompt("Its columns, separated by commas", "name, price, description, image");
      if (!cols) return;
      body = { label, fields: cols.split(",").map((c) => ({ label: c.trim() })).filter((c) => c.label) };
    }
    try {
      const t = await api("/api/account/data", body);
      loadData(t.name);
    } catch (e) {
      $("#data-note").textContent = e.message;
    }
  });
  $("#data-import").addEventListener("click", () => $("#data-file").click());
  $("#data-file").addEventListener("change", async () => {
    const file = $("#data-file").files[0];
    if (!file || !dataOpen) return;
    if (!confirm(`Replace every item in this list with the rows in ${file.name}?`)) { $("#data-file").value = ""; return; }
    const res = await fetch(`/api/account/data/${encodeURIComponent(dataOpen)}/import`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "text/csv", "X-Weave": "1" }, body: file,
    });
    const data = await res.json().catch(() => ({}));
    $("#data-file").value = "";
    $("#data-status").textContent = res.ok ? `${data.rows} items loaded.` : (data.detail || "That file couldn't be read.");
    if (res.ok) loadData(dataOpen);
  });

  async function loadSales() {
    let f;
    try {
      f = await api("/api/account/sales");
    } catch (e) {
      return;
    }
    $("#sales-imports").replaceChildren(...f.imports.map((i) => el("li", { class: "project" },
      el("div", { class: "top" },
        el("span", { class: "name" }, i.filename),
        el("span", { class: "tag" }, `${i.rows} rows`),
        i.skipped ? el("span", { class: "tag fail" }, `${i.skipped} skipped`) : null),
      el("div", { class: "row actions" },
        el("button", { class: "btn danger small", type: "button",
          onclick: () => removeImport(i) }, "Remove")))));

    if (!f.has_sales) {
      $("#sales-stats").hidden = true;
      $("#sales-chart").replaceChildren();
      return;
    }
    const w = f.this_week, cur = f.currency;
    const stat = (value, label) => el("div", { class: "stat" }, el("b", {}, value), el("span", {}, label));
    const tiles = [stat(money(w.revenue, cur), "revenue last week")];
    // No cost column means profit is unknowable, so we show nothing rather than a misleading zero.
    if (f.has_cost) tiles.push(stat(money(w.profit, cur), f.losing_money ? "LOSS last week" : "profit last week"));
    if (f.delta_pct !== null) tiles.push(stat(`${f.delta_pct >= 0 ? "+" : ""}${f.delta_pct}%`, "vs week before"));
    if (f.top_products.length) tiles.push(stat(f.top_products[0].product, "best seller"));
    $("#sales-stats").replaceChildren(...tiles);
    $("#sales-stats").hidden = false;
    $("#sales-chart").replaceChildren(window.weaveChart.bars(
      f.weeks.map((x) => ({ key: x.week_start, value: Math.max(0, x.revenue) })),
      { label: (d) => new Date(d * 86400000).toLocaleDateString() }));
    $("#sales-note").textContent = f.projection === null ? `${f.rows} rows of sales.`
      : `Next week looks like about ${money(f.projection, cur)}`
        + (f.low_confidence ? " — a rough guess, there aren't many weeks yet." : ", if things carry on as they are.");
  }

  async function removeImport(i) {
    if (!confirm(`Remove ${i.filename} and its ${i.rows} rows?`)) return;
    await api(`/api/account/sales/${i.id}/delete`, {});
    loadSales();
  }

  async function upload(confirmIt) {
    const file = $("#sales-file").files[0];
    if (!file) { $("#sales-note").textContent = "Pick a .csv file first."; return; }
    const qs = new URLSearchParams({ filename: file.name });
    if (confirmIt) { qs.set("confirm", "1"); qs.set("dayfirst", $("#sales-dayfirst").value); }
    $("#sales-note").textContent = confirmIt ? "Saving…" : "Reading…";
    let res;
    try {
      res = await fetch(`/api/account/sales/import?${qs}`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "text/csv", "X-Weave": "1" }, body: file,
      });
    } catch (e) {
      $("#sales-note").textContent = "Upload failed. Try again."; return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $("#sales-preview").hidden = true;
      $("#sales-note").textContent = data.detail || "That file couldn't be read.";
      return;
    }
    if (data.stored) {
      $("#sales-preview").hidden = true;
      $("#sales-file").value = "";
      loadSales();
      return;
    }
    const cols = Object.entries(data.columns).filter(([, v]) => v).map(([k, v]) => `${k} → "${v}"`).join(", ");
    $("#sales-found").textContent = `${data.rows} rows read${data.skipped ? `, ${data.skipped} skipped` : ""}. ${cols}`;
    $("#sales-problems").replaceChildren(...data.problems.map((t) => el("li", {}, t)));
    $("#sales-dayfirst-box").hidden = !data.date_ambiguous;
    $("#sales-dayfirst").value = String(data.dayfirst);
    $("#sales-preview").hidden = false;
    $("#sales-note").textContent = "Check this looks right before saving.";
  }

  $("#sales-upload").addEventListener("click", () => upload(false));
  $("#sales-confirm").addEventListener("click", () => upload(true));
  $("#sales-cancel").addEventListener("click", () => { $("#sales-preview").hidden = true; });

  async function loadLeads() {
    let data;
    try {
      data = await api("/api/account/leads");
    } catch (e) {
      return;
    }
    $("#leads-box").hidden = !data.leads.length;
    if (!data.leads.length) return;
    $("#leads-unread").hidden = !data.unread;
    $("#leads-unread").textContent = `${data.unread} new`;
    $("#leads").replaceChildren(...data.leads.map((l) => el("li", { class: "project" },
      el("div", { class: "top" },
        el("span", { class: "name" }, l.name || l.contact),
        el("span", { class: "tag" }, l.site),
        l.read ? null : el("span", { class: "tag ok" }, "new")),
      el("div", { class: "small muted" }, `${l.contact} · ${new Date(l.at * 1000).toLocaleDateString()}`),
      el("div", {}, l.message))));
  }

  $("#leads-read").addEventListener("click", async () => {
    await api("/api/account/leads/read", {});
    loadLeads();
  });

  const DAYS = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];  // day 0 of the epoch was a Thursday

  async function loadTraffic() {
    // Its own request, and not part of the 20s poll: visitor numbers don't change by the second.
    let t;
    try {
      t = await api("/api/account/analytics?days=7");
    } catch (e) {
      return;  // switched off on this server, or not signed in: the section just stays hidden
    }
    $("#traffic-box").hidden = false;
    const stat = (value, label) => el("div", { class: "stat" }, el("b", {}, String(value)), el("span", {}, label));
    const tiles = [
      stat(t.views, t.views === 1 ? "visit this week" : "visits this week"),
      stat(t.visitors, t.visitors === 1 ? "person" : "people"),
    ];
    if (t.top_pages.length) tiles.push(stat(t.top_pages[0].views, `top page: ${t.top_pages[0].label}`));
    if (t.top_refs.length) tiles.push(stat(t.top_refs[0].views, `from ${t.top_refs[0].host}`));
    else if (t.busiest_day) tiles.push(stat(t.busiest_views, `busiest day: ${t.busiest_day}`));
    $("#traffic-stats").replaceChildren(...tiles);

    const items = t.series.map(([day, value]) => ({ key: day, value }));
    $("#traffic-chart").replaceChildren(
      window.weaveChart.bars(items, { label: (d) => DAYS[((d % 7) + 7) % 7] }));
    $("#traffic-note").textContent = !t.counting
      ? "Counting is off for your sites. Visits aren't being recorded."
      : t.views === 0
        ? "No visits yet. Share your link and check back in a few days."
        : t.low_data
          ? "Early days — these numbers will mean more after a week or two."
          : `Last 14 days. ${t.mobile_pct === null ? "" : `${t.mobile_pct}% on a phone.`}`;
  }

  async function loadDigest() {
    let d;
    try {
      d = await api("/api/account/digest");
    } catch (e) {
      return;
    }
    if (!d || !d.has_digest) {
      $("#digest-box").hidden = true;
      return;
    }
    $("#digest-box").hidden = false;
    $("#digest-body").textContent = d.body;
  }

  $("#digest-refresh").addEventListener("click", async () => {
    $("#digest-refresh").disabled = true;
    try {
      const res = await api("/api/account/digest/generate", {});
      if (res && res.has_digest) {
        $("#digest-body").textContent = res.body;
        $("#digest-box").hidden = false;
      }
    } finally {
      $("#digest-refresh").disabled = false;
    }
  });

  const STITCH_RESULT = { connected: "Google Stitch is connected.", cancelled: "Stitch wasn't connected (you cancelled).",
    missing: "Google didn't grant Stitch access. Tick the permission and try again.",
    failed: "Connecting Stitch didn't work. Try again.", off: "Stitch isn't available right now." };

  function renderStitch() {
    const st = me.stitch || {};
    $("#stitch").hidden = !st.available && !st.connected;
    $("#stitch-state").textContent = st.connected ? (st.problem ? "needs reconnecting" : "connected") : "not connected";
    $("#stitch-connect").hidden = st.connected && !st.problem;
    $("#stitch-connect").textContent = st.connected ? "Reconnect" : "Connect Stitch";
    $("#stitch-disconnect").hidden = !st.connected;
    const result = new URLSearchParams(location.search).get("stitch");
    $("#stitch-text").textContent = STITCH_RESULT[result] || (st.problem ? st.problem
      : st.connected ? `Weave designs your websites in Stitch as ${st.email || "you"}, using your own Stitch credits.`
      : "One click: Weave then designs your websites in your own Google Stitch account.");
  }

  function project(p, deleted) {
    const [label, cls] = STATE[p.status] || [p.ready ? "ready" : "—", p.ready ? "ok" : ""];
    const files = el("div", { class: "files", hidden: true });
    const actions = deleted
      ? [el("button", { class: "btn ghost small", type: "button", onclick: () => act(p, "restore") }, "Restore")]
      : [
        p.ready ? el("button", { class: "btn ghost small", type: "button", onclick: () => showFiles(p, files) }, "Files") : null,
        el("button", { class: "btn ghost small", type: "button", onclick: () => rename(p) }, "Rename"),
        el("button", { class: "btn danger small", type: "button", onclick: () => remove(p) }, "Delete"),
      ];
    return el("li", { class: "project" },
      el("div", { class: "top" },
        el("span", { class: "name" }, `${p.number}. ${p.name}`),
        el("span", { class: "tag" }, p.kind === "website" ? "website" : "Android app"),
        deleted ? null : el("span", { class: "tag " + cls }, label)),
      p.url && !deleted ? el("a", { class: "url", href: p.url, target: "_blank", rel: "noopener" }, p.url) : null,
      p.prompt ? el("div", { class: "small muted" }, p.prompt.length > 160 ? p.prompt.slice(0, 160) + "…" : p.prompt) : null,
      el("div", { class: "row actions" }, actions), files);
  }

  function renderProjects() {
    const list = $("#projects");
    list.replaceChildren(...me.projects.map((p) => project(p, false)));
    if (!me.projects.length) {
      list.append(el("li", { class: "muted" }, me.phone ? "Nothing yet. Describe something above or text Weave on WhatsApp."
        : "Connect WhatsApp first, then your projects show up here."));
    }
    $("#trash-box").hidden = !me.trash.length;
    $("#trash-note").textContent = `Deleted projects can be restored for ${me.limits.trash_days} days.`;
    $("#trash").replaceChildren(...me.trash.map((p) => project(p, true)));
  }

  function renderStats() {
    const u = me.usage, l = me.limits;
    const stat = (value, label) => el("div", { class: "stat" }, el("b", {}, String(value)), el("span", {}, label));
    $("#stats").replaceChildren(
      stat(`${u.today.builds} / ${l.builds_per_day}`, "builds today"),
      stat(u.month.builds, "builds this month"),
      stat(`${me.projects.length} / ${l.projects}`, "projects"),
      stat(`${u.storage_mb} / ${l.storage_mb} MB`, "storage"),
    );
  }

  async function showFiles(p, box) {
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.replaceChildren("Loading…");
    try {
      const r = await api(`/api/account/projects/${p.id}/files`);
      const items = [];
      if (r.preview) items.push(el("div", {}, el("a", { href: r.preview, target: "_blank", rel: "noopener" }, "Open private preview")));
      if (r.apk) items.push(el("div", {}, el("a", { href: r.apk }, "Download the Android app (APK)")));
      for (const f of r.files) {
        items.push(el("div", {}, el("a", { href: `/api/account/projects/${p.id}/files/${encodeURIComponent(f.name)}` }, f.name),
          ` · ${(f.bytes / 1024).toFixed(1)} KB`));
      }
      box.replaceChildren(...(items.length ? items : ["No files yet."]));
    } catch (e) {
      box.replaceChildren(e.message);
    }
  }

  async function act(p, verb) {
    try { await api(`/api/account/projects/${p.id}/${verb}`, {}); await load(); } catch (e) { alert(e.message); }
  }

  async function rename(p) {
    const name = prompt("New name", p.name);
    if (!name || name === p.name) return;
    try { await api(`/api/account/projects/${p.id}/rename`, { name }); await load(); } catch (e) { alert(e.message); }
  }

  function remove(p) {
    const live = p.url ? " Its website goes offline." : "";
    if (confirm(`Delete "${p.name}"?${live} You can restore it for ${me.limits.trash_days} days.`)) act(p, "delete");
  }

  async function getCode() {
    try {
      const r = await api("/api/account/phone-code", {});
      $("#code-box").hidden = false;
      $("#code").textContent = r.code;
      $("#code-msg").textContent = "LINK " + r.code;
      if (r.whatsapp_link) { $("#wa").hidden = false; $("#wa").href = r.whatsapp_link; }
      $("#get-code").textContent = "New code";
      $("#recheck").hidden = false;
      return r;
    } catch (e) { alert(e.message); }
  }

  $("#get-code").addEventListener("click", getCode);
  $("#recheck").addEventListener("click", load);
  $("#change-number").addEventListener("click", async () => {
    $("#connect").hidden = false;
    $("#connect-text").textContent = "Send this from your new WhatsApp number. Your projects move with you.";
    await getCode();
  });
  $("#new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const idea = $("#idea").value.trim();
    if (!idea) return;
    $("#new-hint").textContent = "Sending…";
    try {
      const r = await api("/api/account/projects", { idea });
      $("#new-hint").textContent = r.ok ? "Got it. Weave is messaging you on WhatsApp." :
        "Weave replied on WhatsApp (you may be at a limit or a build is still running).";
      $("#idea").value = "";
      setTimeout(load, 1500);
    } catch (err) { $("#new-hint").textContent = err.message; }
  });
  $("#call-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/account/call-sign", { call_sign: $("#call-sign").value });
      $("#call-hint").className = "hint good";
      $("#call-hint").textContent = `Saved. Weave will call you ${r.call_sign}.`;
      $("#hello").textContent = `Hi ${r.call_sign}`;
    } catch (err) { $("#call-hint").className = "hint bad"; $("#call-hint").textContent = err.message; }
  });
  $("#stitch-disconnect").addEventListener("click", async () => {
    if (!confirm("Disconnect Google Stitch? Weave will design websites with its own AI instead.")) return;
    await api("/api/account/stitch/disconnect", {}).catch(() => null);
    history.replaceState(null, "", "/dashboard");
    load();
  });
  $("#logout").addEventListener("click", async () => {
    await api("/api/account/logout", {}).catch(() => {});
    location.replace("/start");
  });
  $("#delete-account").addEventListener("click", async () => {
    const typed = prompt(`This deletes your account and takes all your sites offline. Your username stays retired.\n` +
      `Type your username (${me.username}) to confirm.`);
    if (typed === null) return;
    try { await api("/api/account/delete", { confirm: typed }); location.replace("/start"); } catch (e) { alert(e.message); }
  });

  load();
  setInterval(() => { if (!document.hidden) load(); }, 20000);
})();
