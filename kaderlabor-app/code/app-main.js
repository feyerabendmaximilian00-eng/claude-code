// Kaderlabor – Programmcode (wird vom Starter geladen und kann sich selbst aktualisieren)
module.exports = function start(ctx) {
const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const Anthropic = ctx.require("@anthropic-ai/sdk");
const CODE = ctx.codeDir;

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
/* ---------- FC 27: Spielstände automatisch abgleichen (nur lesen) ---------- */
const fcsave = require(path.join(CODE, "fcsave.js"));
const NAMES_FILE = () => path.join(app.getPath("userData"), "playernames.txt");
let fcWatcher = null, fcTimer = null, fcBusy = false, fcLast = null;
function fcDefaultFolder() {
  const local = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
  for (const p of [path.join(local, "EA SPORTS FC 27", "settings"), path.join(local, "FC 27", "settings"),
                   path.join(app.getPath("documents"), "EA SPORTS FC 27", "settings"), path.join(app.getPath("documents"), "FC 27", "settings")]) {
    try { if (fs.statSync(p).isDirectory()) return p; } catch { /* nicht vorhanden */ }
  }
  return null;
}
// Namensliste automatisch finden (Downloads, Desktop, Dokumente, Spielstand-Ordner)
function fcFindNames() {
  const dirs = [app.getPath("downloads"), app.getPath("desktop"), app.getPath("documents"), readSettings().fcFolder].filter(Boolean);
  let best = null;
  for (const dir of dirs) {
    let list = [];
    try { list = fs.readdirSync(dir); } catch { continue; }
    for (const f of list) {
      if (!/playernames.*\.(txt|csv|tsv)$/i.test(f)) continue;
      const full = path.join(dir, f);
      try { const st = fs.statSync(full); if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { full, mtimeMs: st.mtimeMs }; } catch {}
    }
  }
  return best && best.full;
}
function fcInstallNames(file) {
  const names = fcsave.loadNames(file);
  if (names.size < 1000) throw new Error("Die Datei enthält zu wenige Namen (gefunden: " + names.size + ").");
  fs.copyFileSync(file, NAMES_FILE());
  return names.size;
}
let fcNamesPrompted = false;
async function fcEnsureNames() {
  if (fs.existsSync(NAMES_FILE())) return true;
  const found = fcFindNames();
  if (found) { try { fcInstallNames(found); return true; } catch { /* weiter zum Dialog */ } }
  if (fcNamesPrompted || !mainWindow) return false;
  fcNamesPrompted = true;
  const r = await dialog.showMessageBox(mainWindow, { type: "question", buttons: ["Namensliste wählen …", "Später"], defaultId: 0, cancelId: 1, title: "Spielernamen",
    message: "Für die Spielernamen braucht die App einmal deine Namensliste.",
    detail: "Der Spielstand enthält statt Namen nur Nummern. Wähle die Datei playernames.txt (Spalten nameid und name), die du aus dem Spiel exportiert hast. Sie bleibt nur auf diesem PC." });
  if (r.response !== 0) return false;
  const o = await dialog.showOpenDialog(mainWindow, { title: "Namensliste (playernames) wählen", properties: ["openFile"], filters: [{ name: "Text/CSV", extensions: ["txt", "csv", "tsv"] }] });
  if (o.canceled || !o.filePaths[0]) return false;
  try { fcInstallNames(o.filePaths[0]); return true; }
  catch (err) { dialog.showMessageBox(mainWindow, { type: "warning", title: "Namensliste", message: "Die Datei passt nicht.", detail: String(err.message || err) }); return false; }
}
function fcStatus() {
  const s = readSettings();
  return { folder: s.fcFolder || null, hasNames: fs.existsSync(NAMES_FILE()), auto: s.fcAuto !== false, germanOnly: !!s.fcGermanOnly,
    last: fcLast || s.fcLastMeta || null, busy: fcBusy };
}
function fcSend(channel, data) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); }
async function fcSync(reason) {
  const s = readSettings();
  if (!s.fcFolder || fcBusy) return;
  const newest = fcsave.newestSave(s.fcFolder);
  if (!newest) { fcSend("fc:status", { ...fcStatus(), error: "Im Ordner liegt noch kein Karriere-Spielstand (CmMgr… oder Career…)." }); return; }
  const hadNames = fs.existsSync(NAMES_FILE());
  const namesNow = await fcEnsureNames();
  // gleicher Spielstand wird übersprungen – außer die Namen fehlten beim letzten Mal
  const lastNamed = s.fcLastMeta ? s.fcLastMeta.named / Math.max(1, s.fcLastMeta.players) : 1;
  // Nach einem App-Update, das das Auslesen verbessert, denselben Spielstand einmal neu einlesen
  const FC_PARSER = "3";
  const parserChanged = s.fcParser !== FC_PARSER;
  if (reason === "auto" && s.fcLastMtime && newest.mtimeMs <= s.fcLastMtime && !parserChanged && !(namesNow && (!hadNames || lastNamed < 0.5))) return;
  fcBusy = true; fcSend("fc:status", { ...fcStatus(), busy: true });
  try {
    const names = fcsave.loadNames(NAMES_FILE());
    const { rows, meta } = fcsave.readSave(newest.file, names, { germanOnly: !!s.fcGermanOnly });
    fcLast = meta;
    const t = readSettings(); t.fcLastMtime = newest.mtimeMs; t.fcLastMeta = meta; t.fcParser = FC_PARSER; writeSettings(t);
    fcBusy = false;
    fcSend("fc:data", { rows, meta });
    fcSend("fc:status", fcStatus());
  } catch (err) {
    fcBusy = false;
    fcSend("fc:status", { ...fcStatus(), error: String(err && err.message || err) });
  }
}
function fcWatch() {
  if (fcWatcher) { try { fcWatcher.close(); } catch {} fcWatcher = null; }
  const s = readSettings();
  if (!s.fcFolder || s.fcAuto === false) return;
  try {
    fcWatcher = fs.watch(s.fcFolder, (_ev, f) => {
      if (f && !/^(CmMgr|Career)/i.test(String(f))) return;
      clearTimeout(fcTimer);
      fcTimer = setTimeout(() => fcSync("auto"), 6000); // warten, bis das Spiel fertig geschrieben hat
    });
  } catch (err) { fcSend("fc:status", { ...fcStatus(), error: "Ordner kann nicht beobachtet werden: " + err.message }); }
}
ipcMain.handle("fc:status", (e) => fromLocalPage(e) ? fcStatus() : null);
ipcMain.handle("fc:chooseFolder", async (e) => {
  if (!fromLocalPage(e)) return null;
  const r = await dialog.showOpenDialog(mainWindow, { title: "Ordner mit deinen FC-27-Spielständen", defaultPath: readSettings().fcFolder || fcDefaultFolder() || app.getPath("documents"), properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return fcStatus();
  const s = readSettings(); s.fcFolder = r.filePaths[0]; delete s.fcLastMtime; writeSettings(s);
  fcWatch(); setTimeout(() => fcSync("manual"), 200);
  return fcStatus();
});
ipcMain.handle("fc:chooseNames", async (e) => {
  if (!fromLocalPage(e)) return null;
  const r = await dialog.showOpenDialog(mainWindow, { title: "Namensliste (playernames) wählen", properties: ["openFile"], filters: [{ name: "Text/CSV", extensions: ["txt", "csv", "tsv"] }] });
  if (r.canceled || !r.filePaths[0]) return fcStatus();
  try {
    fcInstallNames(r.filePaths[0]);
    const s = readSettings(); delete s.fcLastMtime; writeSettings(s);
    setTimeout(() => fcSync("manual"), 200);
    return fcStatus();
  } catch (err) { return { ...fcStatus(), error: String(err.message || err) }; }
});
ipcMain.handle("fc:syncNow", (e) => { if (fromLocalPage(e)) setTimeout(() => fcSync("manual"), 50); return true; });
ipcMain.handle("fc:setOptions", (e, o) => {
  if (!fromLocalPage(e)) return null;
  const s = readSettings();
  if (typeof o.auto === "boolean") s.fcAuto = o.auto;
  if (typeof o.germanOnly === "boolean") { s.fcGermanOnly = o.germanOnly; delete s.fcLastMtime; }
  writeSettings(s); fcWatch();
  if (typeof o.germanOnly === "boolean") setTimeout(() => fcSync("manual"), 50);
  return fcStatus();
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
function mode() {
  const s = readSettings();
  if (!s.appUiDefault) { s.mode = "local"; s.appUiDefault = true; writeSettings(s); }
  return s.mode === "online" ? "online" : "local";
}
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
  else mainWindow.loadFile(path.join(CODE, "app", "index.html"));
  buildMenu();
}
function createMainWindow() {
  const s = readSettings();
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 420, minHeight: 600, show: false,
    backgroundColor: "#072830",
    title: "Kaderlabor",
    icon: path.join(CODE, "app", "icon.png"),
    autoHideMenuBar: true, // Menü mit Alt einblenden
    webPreferences: { preload: path.join(CODE, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.setMenuBarVisibility(false);
  hardenNavigation(mainWindow);
  mainWindow.once("ready-to-show", () => {
    // immer randlos im Vollbild starten (F11 schaltet nur für diese Sitzung um)
    mainWindow.maximize();
    mainWindow.setFullScreen(true);
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
    mainWindow.loadFile(path.join(CODE, "app", "index.html"));
    dialog.showMessageBox(mainWindow, { type: "warning", title: "Keine Verbindung", message: "claude.ai ist gerade nicht erreichbar.", detail: `Die App nutzt jetzt die lokale Version (${desc}). Sobald du wieder online bist: Verbindung → Mit claude.ai verbinden.` });
  });
  loadContent();
}
function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 560, height: 430, parent: mainWindow, modal: true, resizable: false, minimizable: false, maximizable: false,
    backgroundColor: "#0e3238", title: "Claude-API-Schlüssel",
    icon: path.join(CODE, "app", "icon.png"),
    webPreferences: { preload: path.join(CODE, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWindow.setMenu(null);
  hardenNavigation(settingsWindow);
  settingsWindow.loadFile(path.join(CODE, "app", "settings.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; });
}
/* ---------- Desktop-Verknüpfung (nur Windows) ---------- */
function createShortcuts(interactive) {
  if (process.platform !== "win32") {
    if (interactive) dialog.showMessageBox(mainWindow, { type: "info", title: "Verknüpfung", message: "Verknüpfungen gibt es nur unter Windows." });
    return;
  }
  try {
    // Symbol an einen festen Ort kopieren, damit die Verknüpfung auch nach Updates ein Symbol hat
    const icon = path.join(app.getPath("userData"), "kaderlabor.ico");
    fs.copyFileSync(path.join(CODE, "app", "icon.ico"), icon);
    const opts = { target: process.execPath, cwd: path.dirname(process.execPath), description: "Kaderlabor – Kaderanalyse für den FC-27-Karrieremodus", icon, iconIndex: 0, appUserModelId: "Kaderlabor" };
    const targets = [
      path.join(app.getPath("desktop"), "Kaderlabor.lnk"),
      path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Kaderlabor.lnk"),
    ];
    let ok = 0;
    for (const t of targets) {
      fs.mkdirSync(path.dirname(t), { recursive: true });
      if (shell.writeShortcutLink(t, fs.existsSync(t) ? "replace" : "create", opts)) ok++;
    }
    const st = readSettings(); st.shortcutCreated = true; writeSettings(st);
    if (interactive) dialog.showMessageBox(mainWindow, { type: "info", title: "Verknüpfung", message: ok ? "Desktop-Verknüpfung und Startmenü-Eintrag sind angelegt." : "Die Verknüpfung konnte nicht angelegt werden." });
  } catch (err) {
    if (interactive) dialog.showMessageBox(mainWindow, { type: "warning", title: "Verknüpfung", message: "Die Verknüpfung konnte nicht angelegt werden.", detail: String(err && err.message || err) });
  }
}
function setMode(m) { const s = readSettings(); s.mode = m; writeSettings(s); loadContent(); }

function buildMenu() {
  const online = mode() === "online";
  const fs = !!(mainWindow && mainWindow.isFullScreen());
  const template = [
    { label: "Datei", submenu: [
      { label: "Neu laden", accelerator: "F5", click: () => mainWindow && mainWindow.reload() },
      { label: "Desktop-Verknüpfung erstellen", click: () => createShortcuts(true) },
      { type: "separator" },
      { label: "Beenden", role: "quit" },
    ] },
    { label: "Ansicht", submenu: [
      { label: "Vollbild", type: "checkbox", checked: fs, accelerator: "F11", click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
      { type: "separator" },
      { label: "Vergrößern", role: "zoomIn" }, { label: "Verkleinern", role: "zoomOut" }, { label: "Originalgröße", role: "resetZoom" },
    ] },
    { label: "Verbindung", submenu: [
      { label: "App-Oberfläche (empfohlen)", type: "radio", checked: !online, click: () => setMode("local") },
      { label: "claude.ai-Ansicht (Browser)", type: "radio", checked: online, click: () => setMode("online") },
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
    { label: "FC 27", submenu: [
      { label: "Jetzt mit Spielstand abgleichen", click: () => fcSync("manual") },
      { label: "Spielstand-Ordner wählen …", click: async () => {
        const r = await dialog.showOpenDialog(mainWindow, { title: "Ordner mit deinen FC-27-Spielständen", defaultPath: readSettings().fcFolder || fcDefaultFolder() || app.getPath("documents"), properties: ["openDirectory"] });
        if (!r.canceled && r.filePaths[0]) { const s = readSettings(); s.fcFolder = r.filePaths[0]; delete s.fcLastMtime; writeSettings(s); fcWatch(); fcSync("manual"); }
      } },
      { label: "Automatisch abgleichen", type: "checkbox", checked: readSettings().fcAuto !== false, click: (it) => { const s = readSettings(); s.fcAuto = it.checked; writeSettings(s); fcWatch(); } },
    ] },
    { label: "Hilfe", submenu: [
      { label: "Nach Updates suchen …", click: () => ctx.checkForUpdates({ interactive: true, win: mainWindow }) },
      { type: "separator" },
      { label: "Über Kaderlabor", click: () => dialog.showMessageBox(mainWindow, { type: "info", title: "Über Kaderlabor", message: `Kaderlabor ${ctx.codeVersion}`,
        detail: "Kaderanalyse für den FC-27-Karrieremodus.\nKein offizielles Produkt von EA SPORTS.\n\nDie App läuft mit eigener Oberfläche und spricht im Hintergrund über die Claude-API mit Claude (eigener API-Schlüssel). Deine Daten liegen auf diesem PC.\n\nF11 = Vollbild an/aus, Alt = Menü anzeigen." }) },
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
  app.whenReady().then(() => {
    buildMenu(); createMainWindow();
    if (!readSettings().shortcutCreated) createShortcuts(false);
    // FC 27: Ordner vorbelegen, beobachten und beim Start den neuesten Spielstand prüfen
    { const s = readSettings(); if (!s.fcFolder && fcDefaultFolder()) { s.fcFolder = fcDefaultFolder(); writeSettings(s); } }
    fcWatch();
    mainWindow.webContents.on("did-finish-load", () => { if (mode() === "local") setTimeout(() => fcSync("auto"), 2500); });
    if (mode() === "local" && !getApiKey() && !readSettings().keyPrompted) {
      const st = readSettings(); st.keyPrompted = true; writeSettings(st);
      mainWindow.webContents.once("did-finish-load", () => setTimeout(openSettings, 600));
    }
    setTimeout(() => ctx.checkForUpdates({ interactive: false, win: mainWindow }), 4000);
  });
  app.on("window-all-closed", () => app.quit());
}
};
