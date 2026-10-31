"use strict";
// WhatsApp simulator. Messages go in through the real WhatsApp queue; replies are read back from the
// message store. Formatting follows WhatsApp: *bold*, _italic_, ~strike~, ```mono```, `code`, links.

const $ = (id) => document.getElementById(id);
const app = $("app"), list = $("chatList"), log = $("log"), scroller = $("scroller");
const text = $("text"), presence = $("presence"), typing = $("typing");
const STORE_KEY = "wa-sim-phone";

let phone = null, lastId = 0, lastDay = null, lastFrom = null, publicBase = "", sitesDomain = "", polling = null;
let seen = new Map();  // message id -> rendered row, so status ticks can update in place

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json();
}

// ---------- formatting ----------
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function localize(url) {
  // Links point at the public site; on this computer the build lives on this server.
  if (publicBase && url.startsWith(publicBase)) return location.origin + url.slice(publicBase.length);
  // A website on <name>.<sites domain> is served here as <name>.localhost.
  const site = sitesDomain && new RegExp(`^https?://([a-z0-9-]+)\\.${sitesDomain.replace(/\./g, "\\.")}(/.*)?$`, "i").exec(url);
  return site ? `${location.protocol}//${site[1]}.localhost:${location.port}${site[2] || "/"}` : url;
}

function format(raw) {
  const blocks = [];
  let s = esc(raw).replace(/```([\s\S]+?)```/g, (_, code) => {
    blocks.push(`<pre>${code}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (url) => {
    const href = localize(url.replace(/&amp;/g, "&"));
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  const wrap = (re, tag) => { s = s.replace(re, `$1<${tag}>$2</${tag}>`); };
  wrap(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=$|[\s).,!?:;])/gm, "strong");
  wrap(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=$|[\s).,!?:;])/gm, "em");
  wrap(/(^|[\s(])~(?!\s)([^~\n]+?)~(?=$|[\s).,!?:;])/gm, "del");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

const TICK_ONE = '<svg class="tick" viewBox="0 0 16 11"><path fill="currentColor" d="M11.1.6 4.5 7.3 1.9 4.7.6 6l3.9 3.9L12.4 1.9z"/></svg>';
const TICK_TWO = '<svg class="tick read" viewBox="0 0 16 11"><path fill="currentColor" d="M11.1.6 4.5 7.3 1.9 4.7.6 6l3.9 3.9L12.4 1.9zm4 0-6.6 6.7-.9-.9-1.3 1.3 2.2 2.2L16.4 1.9z"/></svg>';
const TICK_FAIL = '<svg class="tick fail" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.8 10.5H7.2V10h1.6v1.5Zm0-3H7.2V4.5h1.6v4Z"/></svg>';

function ticks(m) {
  if (m.from !== "me") return "";
  // Your message: one tick while it waits, blue ticks once Weave has read (handled) it.
  if (m.status === "failed") return TICK_FAIL;
  return m.status === "received" ? TICK_TWO : TICK_ONE;
}

function clock(at) {
  return new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(at) {
  const d = new Date(at * 1000), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

function pretty(p) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : p;
}

// ---------- conversation ----------
function render(m) {
  const day = dayLabel(m.at);
  if (day !== lastDay) {
    const li = document.createElement("li");
    li.className = "day";
    li.innerHTML = `<span>${day}</span>`;
    log.appendChild(li);
    lastDay = day; lastFrom = null;
  }
  const li = document.createElement("li");
  li.className = `row ${m.from === "me" ? "out" : "in"}${m.from !== lastFrom ? " first" : ""}`;
  li.innerHTML = `<div class="bubble">${format(m.text)}<span class="stamp">${clock(m.at)}<span class="tk">${ticks(m)}</span></span></div>`;
  log.appendChild(li);
  lastFrom = m.from;
  seen.set(m.id, li);
}

function nearBottom() {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
}

async function poll() {
  if (!phone) return;
  const asked = phone;
  try {
    // Re-read the last few so the ticks on your recent messages catch up.
    const data = await api(`/api/wa/messages?phone=${encodeURIComponent(phone)}&after=${Math.max(0, lastId - 20)}`);
    if (asked !== phone) return;
    const stick = nearBottom();
    for (const m of data.messages) {
      const row = seen.get(m.id);
      if (row) {
        const tk = row.querySelector(".tk");
        if (tk && tk.innerHTML !== ticks(m)) tk.innerHTML = ticks(m);
      } else {
        render(m);
        lastId = Math.max(lastId, m.id);
      }
    }
    typing.hidden = !data.typing;
    presence.textContent = data.typing ? "typing…" : "online";
    presence.classList.toggle("typing", data.typing);
    if (stick) scroller.scrollTop = scroller.scrollHeight;
  } catch (e) {
    presence.textContent = "connecting…";
  }
}

function open(p) {
  phone = p;
  try { localStorage.setItem(STORE_KEY, p); } catch (e) { /* private window */ }
  lastId = 0; lastDay = null; lastFrom = null; seen = new Map();
  log.innerHTML = "";
  typing.hidden = true;
  $("placeholder").hidden = true;
  $("thread").hidden = false;
  $("myNumber").textContent = `you: ${pretty(p)}`;
  app.classList.add("in-chat");
  for (const el of list.children) el.classList.toggle("active", el.dataset.phone === p);
  clearInterval(polling);
  poll().then(() => { scroller.scrollTop = scroller.scrollHeight; });
  polling = setInterval(poll, 1000);
  text.focus();
}

async function newChat() {
  const { phone: p } = await api("/api/wa/chats", {});
  open(p);
  refreshChats(p);
}

// ---------- chat list ----------
async function refreshChats(extra = phone) {
  let data;
  try { data = await api("/api/wa/chats"); } catch (e) { return; }
  publicBase = data.public_base_url || "";
  sitesDomain = data.sites_domain || "";
  const chats = data.chats.slice();
  if (extra && !chats.some((c) => c.phone === extra)) chats.unshift({ phone: extra, last: "", at: Date.now() / 1000 });
  list.innerHTML = "";
  for (const c of chats) {
    const li = document.createElement("li");
    li.dataset.phone = c.phone;
    li.className = c.phone === phone ? "active" : "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-item" + (c.phone === phone ? " active" : "");
    const preview = c.last ? (c.from === "me" ? "You: " : "") + c.last.split("\n")[0] : "New chat";
    btn.innerHTML = `<div class="avatar num">${c.phone.slice(-4)}</div><div class="meta"><div class="top">` +
      `<span class="name">${pretty(c.phone)}</span><span class="when">${c.last ? clock(c.at) : ""}</span></div>` +
      `<div class="last">${esc(preview)}</div></div>`;
    btn.addEventListener("click", () => open(c.phone));
    li.appendChild(btn);
    list.appendChild(li);
  }
  return chats;
}

// ---------- composer ----------
function grow() {
  text.style.height = "auto";
  text.style.height = Math.min(text.scrollHeight, 140) + "px";
}

async function send(e) {
  e.preventDefault();
  const body = text.value.trim();
  if (!body || !phone) return;
  text.value = ""; grow();
  try {
    await api("/api/wa/messages", { phone, text: body });
  } catch (err) {
    text.value = body; grow();
    alert(`Not sent: ${err.message}`);
    return;
  }
  await poll();
  scroller.scrollTop = scroller.scrollHeight;
  refreshChats();
}

$("composer").addEventListener("submit", send);
text.addEventListener("input", grow);
text.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) $("composer").requestSubmit();
});
$("newChat").addEventListener("click", newChat);
$("newChat2").addEventListener("click", () => { $("menu").hidden = true; newChat(); });
$("startChat").addEventListener("click", newChat);
$("back").addEventListener("click", () => { app.classList.remove("in-chat"); refreshChats(); });
$("menuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
document.addEventListener("click", (e) => { if (!$("menu").contains(e.target)) $("menu").hidden = true; });
$("signUp").addEventListener("click", async () => {
  $("menu").hidden = true;
  if (!phone) return;
  await api("/api/wa/sign-up", { phone });
  poll();
});
$("openDashboard").addEventListener("click", () => {
  $("menu").hidden = true;
  if (phone) window.open(`/wa/dashboard?phone=${encodeURIComponent(phone)}`, "_blank");
});
$("linkOwner").addEventListener("click", async () => {
  $("menu").hidden = true;
  if (!phone) return;
  await api("/api/wa/link-owner", { phone });
  poll();
});

(async () => {
  const chats = (await refreshChats()) || [];
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch (e) { /* private window */ }
  const pick = chats.find((c) => c.phone === saved) || chats[0];
  // On a phone-width screen start on the chat list, like the app.
  if (pick && window.innerWidth > 760) open(pick.phone);
  setInterval(() => refreshChats(), 4000);
})();
