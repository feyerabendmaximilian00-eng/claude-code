// Kaderlabor – Starter mit Selbst-Update.
// Dieser Teil wird nur einmal installiert. Er lädt den Programmcode (Ordner code/) entweder aus der
// Installation oder, falls neuer, aus %APPDATA%\Kaderlabor\code\<Version>, und holt neue Versionen
// beim Start von GitHub. Updates werden per SHA-256 geprüft und erst nach dem Neustart aktiv.
const { app, dialog, net } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const LAUNCHER_VERSION = "1";
const UPDATE_BASE = "https://raw.githubusercontent.com/feyerabendmaximilian00-eng/claude-code/claude/exciting-einstein-r6m80x/kaderlabor-app/";
const BUNDLED_DIR = path.join(__dirname, "code");
const BUNDLED_VERSION = JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, "version.json"), "utf8")).version;

const codeRoot = () => path.join(app.getPath("userData"), "code");
const cmp = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
};

function pickCode() {
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(codeRoot(), "current.json"), "utf8"));
    const dir = path.join(codeRoot(), cur.version);
    if (cmp(cur.version, BUNDLED_VERSION) > 0 && fs.existsSync(path.join(dir, "app-main.js"))) return { dir, version: cur.version };
  } catch { /* keine heruntergeladene Version */ }
  return { dir: BUNDLED_DIR, version: BUNDLED_VERSION };
}

let checking = false;
async function checkForUpdates({ interactive = false, win = null } = {}) {
  if (checking) return;
  checking = true;
  const info = (message, detail) => interactive && dialog.showMessageBox(win, { type: "info", title: "Updates", message, detail });
  try {
    const res = await net.fetch(UPDATE_BASE + "update/latest.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("Update-Server antwortet mit " + res.status);
    const m = await res.json();
    if (!m || !m.version || !Array.isArray(m.files)) throw new Error("Update-Beschreibung ist ungültig");
    if (cmp(m.version, current.version) <= 0) { info(`Kaderlabor ist aktuell (Version ${current.version}).`); return; }
    if (m.minLauncher && cmp(m.minLauncher, LAUNCHER_VERSION) > 0) {
      info(`Version ${m.version} ist verfügbar.`, "Diese Version braucht einmalig einen neuen Download der App.");
      return;
    }
    const tmp = path.join(codeRoot(), m.version + ".tmp"), dest = path.join(codeRoot(), m.version);
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const f of m.files) {
      if (typeof f.path !== "string" || f.path.includes("..") || path.isAbsolute(f.path)) throw new Error("Ungültiger Dateipfad im Update");
      const r = await net.fetch(UPDATE_BASE + "code/" + f.path.split("/").map(encodeURIComponent).join("/") + "?v=" + encodeURIComponent(m.version), { cache: "no-store" });
      if (!r.ok) throw new Error(`Download fehlgeschlagen: ${f.path} (${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      if (hash !== f.sha256) throw new Error(`Prüfsumme stimmt nicht: ${f.path}`);
      const out = path.join(tmp, f.path);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    fs.writeFileSync(path.join(codeRoot(), "current.json"), JSON.stringify({ version: m.version, installed: new Date().toISOString() }));
    // alte Versionen aufräumen (aktuelle und vorherige behalten)
    try {
      for (const d of fs.readdirSync(codeRoot())) {
        if (d !== m.version && d !== current.version && d !== "current.json") fs.rmSync(path.join(codeRoot(), d), { recursive: true, force: true });
      }
    } catch { /* egal */ }
    const r = await dialog.showMessageBox(win, {
      type: "info", buttons: ["Jetzt neu starten", "Später"], defaultId: 0, cancelId: 1, title: "Update installiert",
      message: `Kaderlabor ${m.version} ist installiert.`,
      detail: (m.notes ? m.notes + "\n\n" : "") + "Die neue Version ist nach einem Neustart aktiv. Deine Daten bleiben erhalten.",
    });
    if (r.response === 0) { app.relaunch(); app.exit(0); }
  } catch (err) {
    if (interactive) dialog.showMessageBox(win, { type: "warning", title: "Updates", message: "Update-Suche fehlgeschlagen.", detail: String(err && err.message || err) });
  } finally { checking = false; }
}

let current = pickCode();
let start;
try { start = require(path.join(current.dir, "app-main.js")); }
catch (err) {
  // heruntergeladene Version defekt: mitgelieferte Version verwenden
  current = { dir: BUNDLED_DIR, version: BUNDLED_VERSION };
  start = require(path.join(BUNDLED_DIR, "app-main.js"));
}
start({ codeDir: current.dir, codeVersion: current.version, launcherVersion: LAUNCHER_VERSION, require, checkForUpdates });
