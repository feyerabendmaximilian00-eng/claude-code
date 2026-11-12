// Kaderlabor – Windows-App (Electron-Hauptprozess)
const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-opus-5-5";
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
let mainWindow = null;
let settingsWindow = null;

/* ---------- Einstellungen: API-Schlüssel verschlüsselt speichern ---------- */
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8")); } catch { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2));
}
function getApiKey() {
  const s = readSettings();
  if (!s.apiKey) return null;
  try {
    if (s.encrypted && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(s.apiKey, "base64"));
    if (!s.encrypted) return s.apiKey;
  } catch { /* Schlüssel nicht lesbar */ }
  return null;
}
function setApiKey(key) {
  const s = readSettings();
  if (!key) { delete s.apiKey; delete s.encrypted; writeSettings(s); return; }
  if (safeStorage.isEncryptionAvailable()) { s.apiKey = safeStorage.encryptString(key).toString("base64"); s.encrypted = true; }
  else { s.apiKey = key; s.encrypted = false; }
  writeSettings(s);
}

/* ---------- Claude-Aufruf für die Seite (window.claude.use("sample")) ---------- */
function toMessages(input, images) {
  const turns = typeof input === "string" ? [{ role: "user", content: input }] : input;
  const msgs = turns.map(t => ({ role: t.role === "assistant" ? "assistant" : "user", content: String(t.content) }));
  if (images && images.length) {
    const last = msgs[msgs.length - 1];
    last.content = [
      ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
      { type: "text", text: last.content },
    ];
  }
  return msgs;
}

const fromLocalPage = (e) => { try { return String(e.senderFrame && e.senderFrame.url || "").startsWith("file://"); } catch { return false; } };
ipcMain.handle("claude:sample", async (_e, payload) => {
  if (!fromLocalPage(_e)) return { ok: false, code: "not_granted", message: "Nicht erlaubt." };
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, code: "not_granted", message: "Kein API-Schlüssel hinterlegt." };
  const client = new Anthropic({ apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      output_config: { effort: payload.effort || "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(payload.json ? { system: "Antworte ausschließlich mit einem gültigen JSON-Wert, ohne Markdown-Codeblock und ohne weiteren Text." } : {}),
      messages: toMessages(payload.input, payload.images),
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") return { ok: false, code: "refused", message: "Claude hat die Anfrage abgelehnt." };
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    if (!text) return { ok: false, code: "empty_completion", message: "Keine Antwort erhalten." };
    return { ok: true, text, truncated: msg.stop_reason === "max_tokens" };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, code: "auth", message: "Der API-Schlüssel ist ungültig. Bitte unter Claude → API-Schlüssel neu eintragen." };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, code: "auth", message: "Der API-Schlüssel hat keinen Zugriff auf dieses Modell." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, code: "rate_limited", message: "Zu viele Anfragen. Bitte kurz warten." };
    if (err instanceof Anthropic.BadRequestError) return { ok: false, code: "invalid_request", message: err.message };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, code: "upstream_error", message: "Keine Verbindung zur Claude-API." };
    if (err instanceof Anthropic.APIError) return { ok: false, code: "upstream_error", message: `API-Fehler ${err.status ?? ""}`.trim() };
    return { ok: false, code: "upstream_error", message: String(err && err.message || err) };
  }
});
/* ---------- Dauerhafte Datei-Speicherung für die lokale Version ---------- */
const DATA_FILE = () => path.join(app.getPath("userData"), "kaderlabor-daten.json");
ipcMain.handle("store:get", (e) => {
  if (!fromLocalPage(e)) return null;
  for (const f of [DATA_FILE(), DATA_FILE() + ".bak"]) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* nächste Datei versuchen */ }
  }
  return null;
});
ipcMain.handle("store:set", (e, data) => {
  if (!fromLocalPage(e)) return { ok: false, message: "Nicht erlaubt." };
  try {
    const file = DATA_FILE(), tmp = file + ".tmp";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data));
    if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) { return { ok: false, message: String(err && err.message || err) }; }
});
ipcMain.handle("settings:hasKey", (e) => fromLocalPage(e) && !!getApiKey());
ipcMain.handle("settings:setKey", (_e, key) => {
  if (!fromLocalPage(_e)) return { ok: false, message: "Nicht erlaubt." };
  const k = String(key || "").trim();
  if (k && !/^sk-ant-/.test(k)) return { ok: false, message: "Das sieht nicht wie ein Anthropic-API-Schlüssel aus (beginnt mit sk-ant-)." };
  setApiKey(k || null);
  if (settingsWindow) settingsWindow.close();
  if (mainWindow) mainWindow.reload();
  return { ok: true };
});

/* ---------- Fenster ---------- */
// Online-Modus: die Web-Version auf claude.ai. Dort meldest du dich mit deinem Claude-Konto an,
// und die Claude-Funktionen laufen über dein Abo – ohne API-Schlüssel.
const DEFAULT_ONLINE_URL = "https://claude.ai/artifact/PiYEDgbLVD4chvUDf6XESH";
const IN_APP_HOSTS = [/(^|\.)claude\.ai$/i, /(^|\.)anthropic\.com$/i, /^accounts\.google\.com$/i, /(^|\.)googleusercontent\.com$/i, /^appleid\.apple\.com$/i, /(^|\.)claudeusercontent\.com$/i];
const hostOf = url => { try { return new URL(url).hostname; } catch { return ""; } };
const isInApp = url => url.startsWith("file://") || (/^https:\/\//i.test(url) && IN_APP_HOSTS.some(r => r.test(hostOf(url))));
function mode() { return readSettings().mode === "local" ? "local" : "online"; }
function onlineUrl() { return readSettings().onlineUrl || DEFAULT_ONLINE_URL; }

function openExternalSafely(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}
function hardenNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Anmeldefenster (z. B. Google) dürfen in der App aufgehen, alles andere öffnet im Standardbrowser
    if (isInApp(url) && !url.startsWith("file://")) return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 720, parent: win, autoHideMenuBar: true, backgroundColor: "#ffffff" } };
    openExternalSafely(url); return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isInApp(url)) { e.preventDefault(); openExternalSafely(url); }
  });
}
function loadContent() {
  if (!mainWindow) return;
  if (mode() === "online") mainWindow.loadURL(onlineUrl());
  else mainWindow.loadFile(path.join(__dirname, "app", "index.html"));
  buildMenu();
}
function createMainWindow() {
  const s = readSettings();
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 420, minHeight: 600, show: false,
    backgroundColor: "#0b3035",
    title: "Kaderlabor",
    icon: path.join(__dirname, "app", "icon.png"),
    autoHideMenuBar: true, // Menü mit Alt einblenden
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.setMenuBarVisibility(false);
  hardenNavigation(mainWindow);
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    if (s.fullscreen !== false) mainWindow.setFullScreen(true);
    mainWindow.show();
  });
  mainWindow.on("enter-full-screen", () => { const t = readSettings(); t.fullscreen = true; writeSettings(t); buildMenu(); });
  mainWindow.on("leave-full-screen", () => { const t = readSettings(); t.fullscreen = false; writeSettings(t); buildMenu(); });
  // Esc verlässt den Vollbildmodus, F11 schaltet ihn um
  mainWindow.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") { e.preventDefault(); mainWindow.setFullScreen(!mainWindow.isFullScreen()); }
  });
  // Ohne Internet: automatisch auf die lokale Version wechseln
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || mode() !== "online" || code === -3) return;
    mainWindow.loadFile(path.join(__dirname, "app", "index.html"));
    dialog.showMessageBox(mainWindow, { type: "warning", title: "Keine Verbindung", message: "claude.ai ist gerade nicht erreichbar.", detail: `Die App nutzt jetzt die lokale Version (${desc}). Sobald du wieder online bist: Verbindung → Mit claude.ai verbinden.` });
  });
  loadContent();
}
function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 560, height: 430, parent: mainWindow, modal: true, resizable: false, minimizable: false, maximizable: false,
    backgroundColor: "#0e3238", title: "Claude-API-Schlüssel",
    icon: path.join(__dirname, "app", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWindow.setMenu(null);
  hardenNavigation(settingsWindow);
  settingsWindow.loadFile(path.join(__dirname, "app", "settings.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; });
}
function setMode(m) { const s = readSettings(); s.mode = m; writeSettings(s); loadContent(); }

function buildMenu() {
  const online = mode() === "online";
  const fs = !!(mainWindow && mainWindow.isFullScreen());
  const template = [
    { label: "Datei", submenu: [
      { label: "Neu laden", accelerator: "F5", click: () => mainWindow && mainWindow.reload() },
      { type: "separator" },
      { label: "Beenden", role: "quit" },
    ] },
    { label: "Ansicht", submenu: [
      { label: "Vollbild", type: "checkbox", checked: fs, accelerator: "F11", click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
      { type: "separator" },
      { label: "Vergrößern", role: "zoomIn" }, { label: "Verkleinern", role: "zoomOut" }, { label: "Originalgröße", role: "resetZoom" },
    ] },
    { label: "Verbindung", submenu: [
      { label: "Mit claude.ai verbinden (empfohlen)", type: "radio", checked: online, click: () => setMode("online") },
      { label: "Lokale Version (eigener API-Schlüssel)", type: "radio", checked: !online, click: () => setMode("local") },
      { type: "separator" },
      { label: "Bei claude.ai anmelden …", enabled: online, click: () => mainWindow && mainWindow.loadURL("https://claude.ai/login") },
      { label: "Zurück zum Kaderlabor", enabled: online, click: () => mainWindow && mainWindow.loadURL(onlineUrl()) },
      { type: "separator" },
      { label: "API-Schlüssel festlegen …", click: openSettings },
      { label: "API-Schlüssel entfernen", click: async () => {
        const r = await dialog.showMessageBox(mainWindow, { type: "question", buttons: ["Entfernen", "Abbrechen"], defaultId: 1, cancelId: 1, title: "API-Schlüssel entfernen", message: "Gespeicherten API-Schlüssel wirklich entfernen?" });
        if (r.response === 0) { setApiKey(null); mainWindow && mainWindow.reload(); }
      } },
    ] },
    { label: "Hilfe", submenu: [
      { label: "Über Kaderlabor", click: () => dialog.showMessageBox(mainWindow, { type: "info", title: "Über Kaderlabor", message: `Kaderlabor ${app.getVersion()}`,
        detail: "Kaderanalyse für den FC-27-Karrieremodus.\nKein offizielles Produkt von EA SPORTS.\n\nMit claude.ai verbunden: Anmeldung mit deinem Claude-Konto, Claude-Funktionen über dein Abo, Daten in deinem Konto-Browserprofil.\nLokale Version: Daten auf diesem PC, Claude über einen eigenen API-Schlüssel.\n\nF11 = Vollbild an/aus, Alt = Menü anzeigen." }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Normaler Chrome-Kennung ohne Electron-Zusatz, damit Anmeldeseiten die App wie einen Browser behandeln
app.userAgentFallback = app.userAgentFallback.replace(/\sElectron\/\S+/i, "").replace(/\sKaderlabor\/\S+/i, "");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => { buildMenu(); createMainWindow(); });
  app.on("window-all-closed", () => app.quit());
}
