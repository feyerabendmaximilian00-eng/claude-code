// Liest FC-27-Spielstände (Karriere "CmMgr…"/"Career…" und Kaderdateien "Squads…") – nur lesend.
// Aufbau: FBCHUNKS-Container → (bei Karriere: zstd-komprimiert) → EA-Datenbank "DB\0\x08" mit bitgepackten Tabellen.
// Die Spalten heißen in der Datei mit 4-Zeichen-Kürzeln; die Zuordnung unten wurde über einen Tabellen-Export ermittelt.
const fs = require("fs");
const path = require("path");
const fzstd = require("./vendor/fzstd.js");

// Kürzel → Spalte (+ Versatz, den das Spiel beim Speichern abzieht)
const P = {
  playerid: ["GEba", 0], overallrating: ["UERs", 1], potential: ["mpuH", 1], birthdate: ["WVIU", 0], preferredfoot: ["MDvm", 1],
  nationality: ["enmm", 0], firstnameid: ["tHlO", 0], lastnameid: ["QCfa", 0], commonnameid: ["HDYx", 0],
  preferredposition1: ["wZQU", 0], preferredposition2: ["NgVS", -1], preferredposition3: ["OblE", -1], preferredposition4: ["YnYz", -1],
  acceleration: ["SPge", 1], sprintspeed: ["NrcP", 1], positioning: ["XsFD", 1], finishing: ["xJZL", 1], shotpower: ["ohpV", 1],
  longshots: ["CsBG", 1], volleys: ["Dydz", 1], penalties: ["AGsE", 1], vision: ["ZoOK", 1], crossing: ["wGOH", 1],
  freekickaccuracy: ["VgKc", 1], shortpassing: ["vObb", 1], longpassing: ["kerE", 1], curve: ["YFaA", 1], agility: ["RRQB", 1],
  balance: ["onkY", 1], reactions: ["YCnI", 1], ballcontrol: ["MgwU", 1], dribbling: ["nEbM", 1], composure: ["jlQJ", 1],
  interceptions: ["wWzG", 1], headingaccuracy: ["aReg", 1], defensiveawareness: ["SJKz", 1], standingtackle: ["CsyD", 1],
  slidingtackle: ["PhuM", 1], jumping: ["URGo", 1], stamina: ["XjDq", 1], strength: ["nmgT", 1], aggression: ["iTce", 1],
};
const POS = {0:"TW",1:"IV",2:"RAV",3:"RV",4:"IV",5:"IV",6:"IV",7:"LV",8:"LAV",9:"ZDM",10:"ZDM",11:"ZDM",12:"RM",13:"ZM",14:"ZM",15:"ZM",16:"LM",
  17:"ZOM",18:"ZOM",19:"ZOM",20:"HS",21:"HS",22:"HS",23:"RF",24:"ST",25:"ST",26:"ST",27:"LF"};
const NATION = {1:"Albanien",2:"Andorra",3:"Armenien",4:"Österreich",5:"Aserbaidschan",6:"Belarus",7:"Belgien",8:"Bosnien und Herzegowina",9:"Bulgarien",
  10:"Kroatien",11:"Zypern",12:"Tschechien",13:"Dänemark",14:"England",15:"Montenegro",16:"Färöer",17:"Finnland",18:"Frankreich",19:"Nordmazedonien",
  20:"Georgien",21:"Deutschland",22:"Griechenland",23:"Ungarn",24:"Island",25:"Irland",26:"Israel",27:"Italien",28:"Lettland",29:"Liechtenstein",
  30:"Litauen",31:"Luxemburg",32:"Malta",33:"Moldau",34:"Niederlande",35:"Nordirland",36:"Norwegen",37:"Polen",38:"Portugal",39:"Rumänien",
  40:"Russland",41:"San Marino",42:"Schottland",43:"Slowakei",44:"Slowenien",45:"Spanien",46:"Schweden",47:"Schweiz",48:"Türkei",49:"Ukraine",
  50:"Wales",51:"Serbien",52:"Argentinien",53:"Bolivien",54:"Brasilien",55:"Chile",56:"Kolumbien",57:"Ecuador",58:"Paraguay",59:"Peru",60:"Uruguay",61:"Venezuela"};
const SUBS = {acc:"acceleration",spd:"sprintspeed",posi:"positioning",fin:"finishing",spow:"shotpower",lsho:"longshots",vol:"volleys",pen:"penalties",
  vis:"vision",cro:"crossing",fk:"freekickaccuracy",spas:"shortpassing",lpas:"longpassing",cur:"curve",agi:"agility",bal:"balance",rea:"reactions",
  bc:"ballcontrol",drib:"dribbling",comp:"composure",int:"interceptions",head:"headingaccuracy",awr:"defensiveawareness",stk:"standingtackle",
  sli:"slidingtackle",jum:"jumping",sta:"stamina",str:"strength",agg:"aggression"};
const FACE = {pac:{acceleration:.45,sprintspeed:.55},sho:{positioning:.05,finishing:.45,shotpower:.2,longshots:.2,volleys:.05,penalties:.05},
  pas:{vision:.2,crossing:.2,freekickaccuracy:.05,shortpassing:.35,longpassing:.15,curve:.05},dri:{agility:.1,balance:.05,ballcontrol:.35,dribbling:.5},
  def:{interceptions:.2,headingaccuracy:.1,defensiveawareness:.3,standingtackle:.3,slidingtackle:.1},phy:{jumping:.05,stamina:.25,strength:.5,aggression:.2}};
const GERMAN = {"Germany 1. Bundesliga": "Bundesliga", "Germany 2. Bundesliga": "2. Bundesliga", "Germany 3. Liga": "3. Liga"};

/* ---------- Datenbank lesen ---------- */
function readTable(buf, t) {
  const recsize = buf.readInt32LE(t + 4), nrec = buf.readUInt16LE(t + 16), nvalid = buf.readUInt16LE(t + 18), nf = buf[t + 24];
  if (recsize <= 0 || recsize > 8192 || nvalid > nrec || t + 0x24 + nf * 16 > buf.length) return null;
  const fields = [];
  for (let i = 0; i < nf; i++) {
    const p = t + 0x24 + 16 * i;
    fields.push({ type: buf.readUInt32LE(p), bo: buf.readUInt32LE(p + 4), name: buf.toString("latin1", p + 8, p + 12), depth: buf.readUInt32LE(p + 12) });
  }
  const rec0 = t + 0x24 + nf * 16;
  if (rec0 + nvalid * recsize > buf.length) return null;
  const byName = Object.fromEntries(fields.map(f => [f.name, f]));
  const int = (i, f) => {
    const o = rec0 + i * recsize;
    let v = 0;
    for (let k = 0; k < f.depth; k++) { const b = f.bo + k; if ((buf[o + (b >> 3)] >> (b & 7)) & 1) v += 2 ** k; }
    return v;
  };
  const str = (i, f) => {
    const o = rec0 + i * recsize + (f.bo >> 3), end = o + (f.depth >> 3);
    let e = o; while (e < end && buf[e] !== 0) e++;
    return buf.toString("utf8", o, e);
  };
  return { nvalid, fields, has: n => n in byName, get: (i, n) => { const f = byName[n]; return f.type === 0 ? str(i, f) : int(i, f); } };
}
function readDb(buf, B) {
  const n = buf.readUInt32LE(B + 16);
  if (!n || n > 500) return [];
  let pos = B + 24; const list = [];
  for (let i = 0; i < n; i++) { list.push(buf.readUInt32LE(pos + 4)); pos += 8; }
  const base = pos + 4;
  return list.map(off => { try { return readTable(buf, base + off); } catch { return null; } }).filter(Boolean);
}
function allDbs(buf) {
  const out = []; let i = -1;
  while ((i = buf.indexOf("DB\x00\x08", i + 1, "latin1")) !== -1) out.push(...readDb(buf, i));
  return out;
}
// Länge eines zstd-Rahmens bestimmen, ohne ihn zu entpacken (Rahmenkopf + Blockköpfe ablaufen)
function zstdFrameLength(buf, i) {
  let p = i + 4;
  const fhd = buf[p++];
  const fcsFlag = fhd >> 6, single = (fhd >> 5) & 1, checksum = (fhd >> 2) & 1, dictFlag = fhd & 3;
  if (!single) p++;
  p += [0, 1, 2, 4][dictFlag];
  p += [single ? 1 : 0, 2, 4, 8][fcsFlag];
  for (;;) {
    if (p + 3 > buf.length) return -1;
    const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    p += 3;
    const last = h & 1, type = (h >> 1) & 3, size = h >>> 3;
    if (type === 3) return -1;
    p += type === 1 ? 1 : size;
    if (last) break;
  }
  if (checksum) p += 4;
  return p <= buf.length ? p - i : -1;
}
// Namen, die nur im Spielstand stehen (im Karrieremodus erzeugte oder umbenannte Spieler):
// zusammenhängende Einträge [u32 nameid][0x01][u32 Länge][UTF-8-Text]
function saveNames(buf) {
  let best = [];
  const valid = i => i + 9 <= buf.length && buf[i + 2] === 0 && buf[i + 3] === 0 && buf[i + 4] === 1 && buf[i + 5] > 0 && buf[i + 5] <= 80
    && buf[i + 6] === 0 && buf[i + 7] === 0 && buf[i + 8] === 0 && i + 9 + buf[i + 5] <= buf.length;
  for (let i = 0; i < buf.length - 9; i++) {
    if (buf[i + 4] !== 1 || !valid(i)) continue;
    const run = []; let p = i;
    while (valid(p)) { const len = buf[p + 5]; run.push([buf.readUInt32LE(p), buf.toString("utf8", p + 9, p + 9 + len)]); p += 9 + len; }
    if (run.length > best.length) best = run;
    if (run.length > 20) i = p - 1;
  }
  return best.length >= 50 ? new Map(best.filter(([id, t]) => id > 0 && /^[\p{L}]/u.test(t))) : new Map();
}
function tablesOf(raw) {
  const bufs = [raw];
  let tables = allDbs(raw);
  if (!tables.some(t => t.has("GEba") && t.has("UERs"))) {
    // Karriere-Spielstand: Datenbanken stecken in zstd-Rahmen
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
    let i = -1;
    while ((i = raw.indexOf(magic, i + 1)) !== -1) {
      try {
        const len = zstdFrameLength(raw, i);
        if (len <= 0) continue;
        const out = Buffer.from(fzstd.decompress(raw.subarray(i, i + len)));
        bufs.push(out);
        tables = tables.concat(allDbs(out));
        if (tables.some(t => t.has("GEba") && t.has("UERs"))) break;
      } catch { /* Rahmen mit Wörterbuch o. Ä. überspringen */ }
    }
  }
  return { tables, bufs };
}

/* ---------- Spielstand → Datenbank-Zeilen für das Kaderlabor ---------- */
function readSave(file, names, opts = {}) {
  const raw = fs.readFileSync(file);
  if (raw.toString("latin1", 0, 8) !== "FBCHUNKS") throw new Error("Keine FC-Speicherdatei (FBCHUNKS fehlt).");
  const { tables, bufs } = tablesOf(raw);
  const extra = new Map();
  for (const b of bufs) for (const [k, v] of saveNames(b)) if (!extra.has(k)) extra.set(k, v);
  const pick = (test) => tables.filter(test).sort((a, b) => b.nvalid - a.nvalid)[0];
  const players = pick(t => t.has("GEba") && t.has("UERs") && t.has("WVIU"));
  if (!players) throw new Error("Spielertabelle nicht gefunden – unbekanntes Spielstandformat.");
  const teamsT = pick(t => t.has("AUsv") && t.has("mCXg") && t.fields.length > 50);
  const leaguesT = pick(t => t.has("HEQX") && t.has("aQrQ"));
  const ltl = pick(t => t.has("aQrQ") && t.has("mCXg") && t.has("PSlV"));
  const tpl = pick(t => t.has("ykFq") && t.has("mCXg") && t.has("JMld"));
  const dateT = pick(t => t.has("GHrs"));

  const teams = new Map(), leagues = new Map(), teamLeague = new Map(), links = new Map();
  if (teamsT) for (let i = 0; i < teamsT.nvalid; i++) teams.set(teamsT.get(i, "mCXg"), teamsT.get(i, "AUsv"));
  if (leaguesT) for (let i = 0; i < leaguesT.nvalid; i++) leagues.set(leaguesT.get(i, "aQrQ"), leaguesT.get(i, "HEQX"));
  if (ltl) for (let i = 0; i < ltl.nvalid; i++) teamLeague.set(ltl.get(i, "mCXg"), ltl.get(i, "aQrQ"));
  if (tpl) for (let i = 0; i < tpl.nvalid; i++) { const pid = tpl.get(i, "ykFq") - 1; if (!links.has(pid)) links.set(pid, []); links.get(pid).push(tpl.get(i, "mCXg")); }

  // Spieldatum (Karriere) für das Alter, sonst Datum der Datei
  let ref = fs.statSync(file).mtime;
  if (dateT && dateT.nvalid) {
    const v = dateT.get(0, "GHrs");
    if (v > 19000101 && v < 21000101) ref = new Date(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100);
  }
  const epoch = Date.UTC(1582, 9, 14);
  const g = (i, col) => players.get(i, P[col][0]) + P[col][1];
  const nm = id => (id && ((names && names.get(id)) || extra.get(id))) || null;

  const rows = [];
  for (let i = 0; i < players.nvalid; i++) {
    const pid = g(i, "playerid");
    const clubIds = (links.get(pid) || []).filter(t => teamLeague.has(t));
    const club = clubIds.find(t => leagues.has(teamLeague.get(t))) ?? clubIds[0];
    const lgRaw = club != null ? leagues.get(teamLeague.get(club)) : null;
    const lgName = lgRaw ? lgRaw.replace(/ \(\d\)$/, "") : null;
    const league = lgName ? (GERMAN[lgName] || lgName) : "Vereinslos";
    if (opts.germanOnly && !Object.values(GERMAN).includes(league)) continue;
    const pos = [1, 2, 3, 4].map(k => POS[g(i, "preferredposition" + k)]).filter((x, k, a) => x && a.indexOf(x) === k);
    if (!pos.length) continue;
    const common = nm(g(i, "commonnameid"));
    const name = common || [nm(g(i, "firstnameid")), nm(g(i, "lastnameid"))].filter(Boolean).join(" ") || `Spieler ${pid}`;
    const b = new Date(epoch + g(i, "birthdate") * 86400000);
    let age = ref.getFullYear() - b.getUTCFullYear();
    if (ref.getMonth() < b.getUTCMonth() || (ref.getMonth() === b.getUTCMonth() && ref.getDate() < b.getUTCDate())) age--;
    const row = { fcid: pid, name, club: teams.get(club) || "", league, pos: pos[0], alt: pos.slice(1, 4), age,
      ovr: g(i, "overallrating"), pot: g(i, "potential"), foot: g(i, "preferredfoot") === 2 ? "L" : "R",
      nat: NATION[g(i, "nationality")] || `Nation ${g(i, "nationality")}`, sub: {} };
    for (const [k, w] of Object.entries(FACE)) {
      let s = 0, t = 0; for (const [a, x] of Object.entries(w)) { s += g(i, a) * x; t += x; }
      row[k] = Math.round(s / t);
    }
    for (const [k, col] of Object.entries(SUBS)) row.sub[k] = g(i, col);
    rows.push(row);
  }
  // gleichnamige Spieler im selben Verein unterscheidbar machen
  const dup = new Map();
  rows.forEach(r => { const k = r.name + "|" + r.club; dup.set(k, (dup.get(k) || 0) + 1); });
  rows.forEach(r => { if (dup.get(r.name + "|" + r.club) > 1) r.name = `${r.name} (${r.pos}, ${r.age})`; });
  const named = rows.filter(r => !/^Spieler \d+$/.test(r.name)).length;
  return { rows, meta: { file: path.basename(file), saved: fs.statSync(file).mtime.toISOString(), gameDate: ref.toISOString().slice(0, 10), players: rows.length, named } };
}

function loadNames(file) {
  const names = new Map();
  if (!file || !fs.existsSync(file)) return names;
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/);
  const head = lines[0].split("\t");
  const iid = head.indexOf("nameid"), iname = head.indexOf("name");
  if (iid < 0 || iname < 0) throw new Error("Die Namensliste braucht die Spalten nameid und name.");
  for (const l of lines.slice(1)) { const c = l.split("\t"); const id = +c[iid]; if (c[iname]) names.set(id, c[iname].trim()); }
  return names;
}

// Neueste Karriere-Speicherdatei im Ordner
function newestSave(dir) {
  let best = null;
  for (const f of fs.readdirSync(dir)) {
    if (!/^(CmMgr|Career)/i.test(f)) continue;
    const full = path.join(dir, f), st = fs.statSync(full);
    if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { file: full, mtimeMs: st.mtimeMs };
  }
  return best;
}

module.exports = { readSave, loadNames, newestSave };
