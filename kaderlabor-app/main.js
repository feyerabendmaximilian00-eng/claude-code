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

ipcMain.handle("claude:sample", async (_e, payload) => {
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
ipcMain.handle("settings:hasKey", () => !!getApiKey());
ipcMain.handle("settings:setKey", (_e, key) => {
  const k = String(key || "").trim();
  if (k && !/^sk-ant-/.test(k)) return { ok: false, message: "Das sieht nicht wie ein Anthropic-API-Schlüssel aus (beginnt mit sk-ant-)." };
  setApiKey(k || null);
  if (settingsWindow) settingsWindow.close();
  if (mainWindow) mainWindow.reload();
  return { ok: true };
});

/* ---------- Fenster ---------- */
function openExternalSafely(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}
function hardenNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafely(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) { e.preventDefault(); openExternalSafely(url); }
  });
}
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 420, minHeight: 600,
    backgroundColor: "#0b3035",
    title: "Kaderlabor",
    icon: path.join(__dirname, "app", "icon.png"),
    autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  hardenNavigation(mainWindow);
  mainWindow.loadFile(path.join(__dirname, "app", "index.html"));
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

function buildMenu() {
  const template = [
    { label: "Datei", submenu: [
      { label: "Neu laden", accelerator: "F5", click: () => mainWindow && mainWindow.reload() },
      { type: "separator" },
      { label: "Beenden", role: "quit" },
    ] },
    { label: "Ansicht", submenu: [
      { label: "Vergrößern", role: "zoomIn" }, { label: "Verkleinern", role: "zoomOut" }, { label: "Originalgröße", role: "resetZoom" },
      { type: "separator" }, { label: "Vollbild", role: "togglefullscreen" },
    ] },
    { label: "Claude", submenu: [
      { label: "API-Schlüssel festlegen …", click: openSettings },
      { label: "API-Schlüssel entfernen", click: async () => {
        const r = await dialog.showMessageBox(mainWindow, { type: "question", buttons: ["Entfernen", "Abbrechen"], defaultId: 1, cancelId: 1, title: "API-Schlüssel entfernen", message: "Gespeicherten API-Schlüssel wirklich entfernen?" });
        if (r.response === 0) { setApiKey(null); mainWindow && mainWindow.reload(); }
      } },
    ] },
    { label: "Hilfe", submenu: [
      { label: "Über Kaderlabor", click: () => dialog.showMessageBox(mainWindow, { type: "info", title: "Über Kaderlabor", message: `Kaderlabor ${app.getVersion()}`, detail: "Kaderanalyse für den FC-27-Karrieremodus.\nKein offizielles Produkt von EA SPORTS.\n\nDaten werden lokal auf diesem PC gespeichert." }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => { buildMenu(); createMainWindow(); });
  app.on("window-all-closed", () => app.quit());
}
