// Erstellt update/latest.json aus dem Ordner code/ (Version aus code/version.json).
// Danach committen und pushen: alle installierten Apps holen sich das Update beim nächsten Start.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const codeDir = path.join(root, "code");
const { version } = JSON.parse(fs.readFileSync(path.join(codeDir, "version.json"), "utf8"));
const notes = process.argv.slice(2).join(" ");

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else {
      const buf = fs.readFileSync(full);
      files.push({ path: path.relative(codeDir, full).split(path.sep).join("/"), sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length });
    }
  }
})(codeDir);

const manifest = { version, minLauncher: "1", released: new Date().toISOString(), notes, files };
fs.mkdirSync(path.join(root, "update"), { recursive: true });
fs.writeFileSync(path.join(root, "update", "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`update/latest.json: Version ${version}, ${files.length} Dateien`);
