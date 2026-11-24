/* =========================================================
   Chat en vivo multiusuario (cliente)
   Comunica con server.ps1 mediante fetch. Varias personas
   comparten la misma sala y ven los mensajes al instante.
   ========================================================= */

(() => {
  "use strict";

  const NAME_KEY = "livechat:user";
  const THEME_KEY = "livechat:theme";
  const POLL_MS = 1200;

  const EMOJIS = [
    "😀", "😄", "😊", "😍", "🥰", "😎", "🤔", "😅",
    "👍", "👏", "🙌", "🤝", "💪", "🙏", "✌️", "👀",
    "❤️", "💜", "🔥", "✨", "🎉", "💡", "✅", "❌",
    "👋", "🕐", "💲", "📦", "📞", "📧", "🌎", "☕",
  ];

  const COLORS = [
    "#6366f1", "#ec4899", "#0ea5e9", "#f59e0b",
    "#10b981", "#8b5cf6", "#ef4444", "#14b8a6",
  ];

  const el = {
    login: document.getElementById("login"),
    loginForm: document.getElementById("loginForm"),
    nameInput: document.getElementById("nameInput"),
    messages: document.getElementById("messages"),
    form: document.getElementById("chatForm"),
    input: document.getElementById("input"),
    sendBtn: document.getElementById("sendBtn"),
    typing: document.getElementById("typing"),
    typingText: document.getElementById("typingText"),
    onlineBar: document.getElementById("onlineBar"),
    countLabel: document.getElementById("countLabel"),
    emojiBtn: document.getElementById("emojiBtn"),
    emojiPanel: document.getElementById("emojiPanel"),
    counter: document.getElementById("counter"),
    themeBtn: document.getElementById("themeBtn"),
    leaveBtn: document.getElementById("leaveBtn"),
    meLabel: document.getElementById("meLabel"),
    statusLabel: document.getElementById("statusLabel"),
    connectionDot: document.getElementById("connectionDot"),
  };

  let me = "";
  let lastId = 0;
  let users = [];
  let typing = false;
  let typingTimer = null;
  let lastTypingPoll = 0;
  let pollTimer = null;
  let polling = false;
  let connected = false;

  /* ---------- Utilidades ---------- */
  function colorFor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return COLORS[hash % COLORS.length];
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("");
  }

  function formatTime(ms) {
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  }

  function setConnection(value) {
    connected = value;
    el.statusLabel.textContent = value ? "Conectado" : "Desconectado · reintentando";
    el.connectionDot.classList.toggle("dot--off", !value);
    el.connectionDot.classList.toggle("dot--gray", false);
  }

  /* ---------- Acceso ---------- */
  function showLogin() {
    el.login.hidden = false;
    el.nameInput.value = "";
    el.meLabel.textContent = "";
    el.countLabel.textContent = "Esperando conexión…";
    setTimeout(() => el.nameInput.focus(), 50);
  }

  function enterChat() {
    el.login.hidden = true;
    el.meLabel.textContent = `Conectado como ${me}`;
    lastId = 0;
    users = [];
    renderWelcome();
    el.onlineBar.replaceChildren();
    el.typing.hidden = true;
    setConnection(true);
    clearTimeout(pollTimer);
    poll();
  }

  el.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = el.nameInput.value.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!name) return;
    me = name;
    try { localStorage.setItem(NAME_KEY, me); } catch { /* ignorar */ }
    enterChat();
  });

  el.leaveBtn.addEventListener("click", () => leaveChat());

  function leaveChat() {
    const payload = JSON.stringify({ user: me });
    try {
      navigator.sendBeacon("/api/leave", new Blob([payload], { type: "text/plain;charset=utf-8" }));
    } catch { /* ignorar */ }
    try { localStorage.removeItem(NAME_KEY); } catch { /* ignorar */ }
    me = "";
    lastId = 0;
    typing = false;
    users = [];
    clearTimeout(pollTimer);
    clearTimeout(typingTimer);
    setConnection(false);
    showLogin();
  }

  window.addEventListener("beforeunload", () => {
    if (!me) return;
    try {
      navigator.sendBeacon("/api/leave", new Blob([JSON.stringify({ user: me })], { type: "text/plain;charset=utf-8" }));
    } catch { /* ignorar */ }
  });

  /* ---------- Red ---------- */
  async function poll() {
    if (!me || polling) return;
    polling = true;
    try {
      const params = new URLSearchParams({
        after: String(lastId),
        user: me,
        typing: typing ? "1" : "0",
      });
      const response = await fetch(`/api/state?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      setConnection(true);
      users = Array.isArray(data.users) ? data.users : [];
      renderUsers();
      renderTyping();

      const total = data.count ?? users.length;
      el.countLabel.textContent = `${total} persona${total === 1 ? "" : "s"} en línea`;

      const received = Array.isArray(data.messages) ? data.messages : [];
      received.forEach(message => {
        if (Number(message.id) > lastId) {
          appendMessage(message);
          lastId = Number(message.id);
        }
      });
    } catch {
      setConnection(false);
    } finally {
      polling = false;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(poll, connected ? POLL_MS : 2500);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && me) poll();
  });

  async function sendMessage(text) {
    const clean = text.trim().slice(0, 500);
    if (!clean || !me) return;
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: me, text: clean }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      el.input.value = "";
      typing = false;
      autoGrow();
      poll();
    } catch {
      setConnection(false);
    }
  }

  /* ---------- Render ---------- */
  function renderWelcome() {
    const welcome = document.createElement("div");
    welcome.className = "welcome";
    welcome.innerHTML = `
      <div class="welcome__icon" aria-hidden="true">👋</div>
      <h3>¡Bienvenido a la sala!</h3>
      <p>Los mensajes se comparten al instante con todas las personas conectadas.</p>`;
    el.messages.replaceChildren(welcome);
    el.messages.scrollTop = 0;
  }

  function messageNode(message) {
    if (message.kind === "system") {
      const note = document.createElement("div");
      note.className = "system-msg";
      note.textContent = message.text;
      return note;
    }

    const own = message.user === me;
    const color = colorFor(message.user || "?");
    const row = document.createElement("div");
    row.className = `msg ${own ? "msg--own" : "msg--other"}`;
    row.style.setProperty("--user-color", color);

    if (!own) {
      const avatar = document.createElement("div");
      avatar.className = "msg__avatar";
      avatar.textContent = initials(message.user || "?");
      avatar.setAttribute("aria-hidden", "true");
      row.appendChild(avatar);
    }

    const body = document.createElement("div");
    body.className = "msg__body";

    const author = document.createElement("div");
    author.className = "msg__author";
    author.textContent = own ? "Tú" : message.user;

    const bubble = document.createElement("div");
    bubble.className = "msg__bubble";
    bubble.textContent = message.text; // seguro: nunca se interpreta HTML

    const meta = document.createElement("div");
    meta.className = "msg__meta";
    const time = document.createElement("time");
    time.dateTime = new Date(message.time).toISOString();
    time.textContent = formatTime(message.time);
    meta.appendChild(time);

    body.append(author, bubble, meta);
    row.appendChild(body);
    return row;
  }

  function isNearBottom() {
    const rest = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
    return rest < 90;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { el.messages.scrollTop = el.messages.scrollHeight; });
  }

  function appendMessage(message) {
    const welcome = el.messages.querySelector(".welcome");
    if (welcome) welcome.remove();
    const shouldScroll = isNearBottom() || message.user === me;
    el.messages.appendChild(messageNode(message));
    if (shouldScroll) scrollToBottom();
  }

  function renderUsers() {
    const fragment = document.createDocumentFragment();
    users.forEach(person => {
      const chip = document.createElement("span");
      chip.className = `person${person.name === me ? " person--me" : ""}`;
      chip.style.setProperty("--user-color", colorFor(person.name));

      const avatar = document.createElement("span");
      avatar.className = "person__avatar";
      avatar.textContent = initials(person.name);
      avatar.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.textContent = person.name === me ? `${person.name} (tú)` : person.name;

      chip.append(avatar, label);
      fragment.appendChild(chip);
    });
    el.onlineBar.replaceChildren(fragment);
  }

  function renderTyping() {
    const names = users.filter(u => u.typing && u.name !== me).map(u => u.name);
    if (!names.length) {
      el.typing.hidden = true;
      return;
    }
    let label;
    if (names.length === 1) label = `${names[0]} está escribiendo…`;
    else if (names.length === 2) label = `${names[0]} y ${names[1]} están escribiendo…`;
    else label = `${names[0]}, ${names[1]} y ${names.length - 2} más están escribiendo…`;
    el.typingText.textContent = label;
    el.typing.hidden = false;
  }

  /* ---------- Compositor ---------- */
  function autoGrow() {
    el.input.style.height = "auto";
    el.input.style.height = `${Math.min(el.input.scrollHeight, 110)}px`;
    const length = el.input.value.length;
    el.counter.classList.toggle("is-visible", length > 400);
    el.counter.textContent = `${length}/500`;
    el.sendBtn.disabled = el.input.value.trim().length === 0;
  }

  function insertEmoji(emoji) {
    const start = el.input.selectionStart ?? el.input.value.length;
    const end = el.input.selectionEnd ?? el.input.value.length;
    el.input.value = el.input.value.slice(0, start) + emoji + el.input.value.slice(end);
    const caret = start + emoji.length;
    el.input.setSelectionRange(caret, caret);
    el.input.focus();
    el.input.dispatchEvent(new Event("input"));
  }

  function buildEmojiPanel() {
    EMOJIS.forEach(emoji => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = emoji;
      button.setAttribute("aria-label", `Insertar ${emoji}`);
      button.addEventListener("click", () => insertEmoji(emoji));
      el.emojiPanel.appendChild(button);
    });
  }

  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(el.input.value);
  });

  el.input.addEventListener("input", () => {
    autoGrow();
    const active = el.input.value.trim().length > 0;
    if (active !== typing) {
      typing = active;
      lastTypingPoll = 0;
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typing = false; poll(); }, 2000);
    if (typing && Date.now() - lastTypingPoll > 500) {
      lastTypingPoll = Date.now();
      poll();
    }
  });

  el.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      el.form.requestSubmit();
    }
  });

  el.emojiBtn.addEventListener("click", () => {
    const open = el.emojiPanel.hidden;
    el.emojiPanel.hidden = !open;
    el.emojiBtn.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (event) => {
    if (!el.emojiPanel.hidden && !el.emojiPanel.contains(event.target) && event.target !== el.emojiBtn) {
      el.emojiPanel.hidden = true;
      el.emojiBtn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.emojiPanel.hidden) {
      el.emojiPanel.hidden = true;
      el.emojiBtn.setAttribute("aria-expanded", "false");
      el.emojiBtn.focus();
    }
  });

  /* ---------- Tema ---------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignorar */ }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignorar */ }
    const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(theme);
  }

  el.themeBtn.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  /* ---------- Inicio ---------- */
  buildEmojiPanel();
  initTheme();
  autoGrow();

  try { me = localStorage.getItem(NAME_KEY) || ""; } catch { me = ""; }
  if (me) enterChat(); else showLogin();
})();
