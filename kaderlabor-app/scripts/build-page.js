// Baut app/index.html aus der Web-Version (web/kaderlabor.html).
// Die Web-Version ist ein Seiteninhalt ohne <html>/<head>; hier bekommt sie ein vollständiges Dokument
// und den Claude-Adapter für die Desktop-App.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "web", "kaderlabor.html"), "utf8");

const doc = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>html,body{background:#072830;min-height:100%}:root{color-scheme:dark;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="claude-shim.js"></script>
</head>
<body>
${src}
</body>
</html>
`;
fs.writeFileSync(path.join(root, "code", "app", "index.html"), doc);
console.log("app/index.html erstellt (" + Math.round(doc.length / 1024) + " KB)");
